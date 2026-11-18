import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import token_hash
from backend.migrate_neon import apply_migrations
from backend.store import AuthStore
from tests.backend.test_auth import NODE_HASH


@unittest.skipUnless(os.environ.get("FINANCE_TEST_ADMIN_DATABASE"), "Set FINANCE_TEST_ADMIN_DATABASE to run PostgreSQL integration tests")
class AuthenticationIntegrationTest(unittest.TestCase):
    def test_remote_throttling_is_shared_and_expires(self):
        admin = psycopg.connect(dbname=os.environ["FINANCE_TEST_ADMIN_DATABASE"], autocommit=True)
        self.addCleanup(admin.close)
        database = "finance_test_" + uuid4().hex
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        self.addCleanup(lambda: admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database))))
        with psycopg.connect(dbname=database) as conn:
            for migration in ("001_schema.sql", "012_auth_throttling.sql"):
                conn.execute((Path("db/migrations") / migration).read_text())
        store = AuthStore(lambda: psycopg.connect(dbname=database, row_factory=dict_row))
        for _ in range(10):
            self.assertIsNone(store.auth_retry_after("person@example.com"))
        self.assertGreater(store.auth_retry_after("person@example.com"), 0)
        self.assertIsNone(store.auth_retry_after("other@example.com"))
        with psycopg.connect(dbname=database) as conn:
            conn.execute("UPDATE finance.auth_throttle SET expires_at = now() - interval '1 second'")
        self.assertIsNone(store.auth_retry_after("person@example.com"))
        for i in range(59):
            self.assertIsNone(store.auth_retry_after(f"user{i}@example.com"))
        self.assertGreater(store.auth_retry_after("last@example.com"), 0)
        with psycopg.connect(dbname=database) as conn:
            buckets = conn.execute("SELECT bucket FROM finance.auth_throttle").fetchall()
            self.assertTrue(all("@" not in row[0] for row in buckets))
            conn.execute("DELETE FROM finance.auth_throttle")
        with ThreadPoolExecutor(max_workers=12) as executor:
            results = list(executor.map(store.auth_retry_after, ["parallel@example.test"] * 20))
        self.assertEqual(sum(result is None for result in results), 10)
        self.assertEqual(sum(result is not None for result in results), 10)

    def test_new_database_supports_remote_accounts_and_isolates_movements(self):
        admin = psycopg.connect(dbname=os.environ["FINANCE_TEST_ADMIN_DATABASE"], autocommit=True)
        self.addCleanup(admin.close)
        database = "finance_test_" + uuid4().hex
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        self.addCleanup(lambda: admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database))))
        with psycopg.connect(dbname=database, autocommit=True) as conn:
            apply_migrations(conn)
            with self.assertRaisesRegex(ValueError, "ya contiene el esquema finance"):
                apply_migrations(conn)
        origin = "https://tracker.example.com"
        with patch.dict(os.environ, {"PGDATABASE": database}), patch("backend.config.PUBLIC_ORIGIN", origin):
            os.environ.pop("DATABASE_URL", None)
            with TestClient(app, base_url=origin) as first, TestClient(app, base_url=origin) as second:
                for client, email in ((first, "first@example.test"), (second, "second@example.test")):
                    response = client.post("/api/auth/register", headers={"Origin": origin},
                                           json={"email": email, "password": "correct horse battery"})
                    self.assertEqual(response.status_code, 201)
                    self.assertIn("Secure", response.headers["set-cookie"])
                with psycopg.connect(dbname=database) as conn:
                    conn.execute("UPDATE finance.account SET opening_configured = true")
                options = first.get("/api/opciones").json()
                income = {"merchant": "Ingreso privado", "amount": "1000", "date": "2020-06-03",
                          "accountId": options["accounts"][0]["id"],
                          "categoryId": options["incomeCategories"][0]["id"]}
                self.assertEqual(first.post("/api/ingresos", headers={"Origin": origin}, json=income).status_code, 201)
                self.assertIn("Ingreso privado", first.get("/api/movimientos?todos=1").text)
                self.assertNotIn("Ingreso privado", second.get("/api/movimientos?todos=1").text)
                self.assertNotEqual(second.post("/api/ingresos", headers={"Origin": origin}, json=income).status_code, 201)

    def test_existing_node_accounts_and_sessions_remain_usable(self):
        admin = psycopg.connect(dbname=os.environ["FINANCE_TEST_ADMIN_DATABASE"], autocommit=True)
        self.addCleanup(admin.close)
        database = "finance_test_" + uuid4().hex
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        self.addCleanup(lambda: admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database))))

        with psycopg.connect(dbname=database) as conn:
            for migration in ("001_schema.sql", "007_user_accounts.sql"):
                conn.execute((Path("db/migrations") / migration).read_text())
            user_id = conn.execute(
                "INSERT INTO finance.app_user (email, password_hash) VALUES (%s, %s) RETURNING user_id",
                ("node@example.test", NODE_HASH),
            ).fetchone()[0]
            conn.execute(
                "INSERT INTO finance.household (name, owner_user_id) VALUES (%s, %s)",
                ("Perfil existente", user_id),
            )
            conn.execute(
                "INSERT INTO finance.app_session (token_hash, user_id, expires_at) VALUES (%s, %s, now() + interval '1 day')",
                (token_hash("a" * 64), user_id),
            )

        with patch.dict(os.environ, {"PGDATABASE": database}):
            os.environ.pop("DATABASE_URL", None)
            origin = "http://127.0.0.1:8000"
            headers = {"Origin": origin}
            credentials = {"email": "python@example.test", "password": "correct horse battery"}
            with TestClient(app, base_url=origin) as client:
                self.assertEqual(client.post("/api/auth/register", headers=headers, json=credentials).status_code, 201)
                self.assertEqual(client.post("/api/auth/register", headers=headers, json=credentials).status_code, 409)
                self.assertEqual(client.get("/api/auth/session").json(), {"user": {"email": "python@example.test"}})

                self.assertEqual(
                    client.get("/api/auth/session", headers={"Cookie": "finance_session=" + "a" * 64}).json(),
                    {"user": {"email": "node@example.test"}},
                )
                credentials["email"] = "node@example.test"
                self.assertEqual(client.post("/api/auth/login", headers=headers, json=credentials).status_code, 200)
                self.assertEqual(client.post("/api/auth/logout", headers=headers, json={}).status_code, 200)
                self.assertEqual(client.get("/api/auth/session").json(), {"user": None})

            with psycopg.connect(dbname=database) as conn:
                self.assertEqual(conn.execute("SELECT count(*) FROM finance.app_user").fetchone()[0], 2)
                self.assertEqual(conn.execute("SELECT count(*) FROM finance.household WHERE owner_user_id IS NOT NULL").fetchone()[0], 2)
                self.assertEqual(conn.execute("SELECT count(*) FROM finance.category").fetchone()[0], 10)
                self.assertEqual(conn.execute("SELECT count(*) FROM finance.account").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
