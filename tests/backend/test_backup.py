import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import psycopg
from psycopg import sql

from backend.backup_neon import connection_environment, create_backup
from backend.verify_backup_neon import verify_backup


class BackupConfigurationTest(unittest.TestCase):
    def test_requires_direct_neon_host_and_verified_tls(self):
        env = connection_environment("postgresql://test:secret@ep-example.neon.tech/db?sslmode=require")
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertEqual(env["PGHOST"], "ep-example.neon.tech")
        for url in ("postgresql://test@localhost/db", "postgresql://test@ep-example-pooler.neon.tech/db",
                    "postgresql://test@ep-example.neon.tech/db?hostaddr=127.0.0.1"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                connection_environment(url)

    def test_failed_dump_removes_incomplete_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
            env.update({"PGHOST": "127.0.0.1", "PGPORT": "1", "PGCONNECT_TIMEOUT": "1", "PGDATABASE": "unused"})
            with patch("backend.backup_neon.connection_environment", return_value=env), \
                    self.assertRaises(RuntimeError):
                create_backup("unused", "test passphrase", Path(temp))
            self.assertEqual(list(Path(temp).iterdir()), [])


@unittest.skipUnless(os.environ.get("FINANCE_TEST_ADMIN_DATABASE") and shutil.which("gpg"),
                     "PostgreSQL and gpg required for backup integration test")
class BackupIntegrationTest(unittest.TestCase):
    def test_encrypted_backup_can_be_restored_into_a_separate_database(self):
        admin = psycopg.connect(dbname=os.environ["FINANCE_TEST_ADMIN_DATABASE"], autocommit=True)
        self.addCleanup(admin.close)
        source = "finance_test_" + uuid4().hex
        destination = "finance_test_" + uuid4().hex
        for database in (source, destination):
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
            self.addCleanup(lambda name=database: admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(name))))
        with psycopg.connect(dbname=source) as conn:
            conn.execute("CREATE TABLE sample (value text)")
            conn.execute("INSERT INTO sample VALUES ('datos ficticios')")
            conn.execute("CREATE SCHEMA finance")
            conn.execute("CREATE TABLE finance.app_user (id integer)")
            conn.execute("CREATE TABLE finance.transactions (id integer)")
        with tempfile.TemporaryDirectory() as temp:
            gpg_home = Path(temp) / "gpg"
            gpg_home.mkdir(mode=0o700)
            env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
            env.update({"PGDATABASE": source, "GNUPGHOME": str(gpg_home)})
            with patch("backend.backup_neon.connection_environment", return_value=env), \
                    patch.dict(os.environ, {"GNUPGHOME": str(gpg_home)}):
                path = create_backup("unused", "test passphrase", Path(temp) / "backups")
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertNotIn(b"datos ficticios", path.read_bytes())
                decrypted = subprocess.run(
                    ["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase-fd", "0",
                     "--decrypt", str(path)], input=b"test passphrase\n", capture_output=True, check=True,
                )
                restore_env = {**env, "PGDATABASE": destination}
                subprocess.run(["pg_restore", "--dbname", destination, "--no-owner", "--no-acl"], input=decrypted.stdout,
                               env=restore_env, capture_output=True, check=True)
                before = admin.execute(
                    "SELECT datname FROM pg_database WHERE datname LIKE 'finance_restore_test_%' ORDER BY datname"
                ).fetchall()
                verify_backup(path, "test passphrase")
                with self.assertRaises(RuntimeError):
                    verify_backup(path, "wrong passphrase")
                after = admin.execute(
                    "SELECT datname FROM pg_database WHERE datname LIKE 'finance_restore_test_%' ORDER BY datname"
                ).fetchall()
                self.assertEqual(after, before)
            with psycopg.connect(dbname=destination) as conn:
                self.assertEqual(conn.execute("SELECT value FROM sample").fetchone()[0], "datos ficticios")


if __name__ == "__main__":
    unittest.main()
