import os
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

import psycopg
from psycopg import sql
from fastapi.testclient import TestClient

from backend.app import app
from backend.auth import token_hash
from tests.backend.test_auth import NODE_HASH


@unittest.skipUnless(os.environ.get("FINANCE_TEST_ADMIN_DATABASE"), "Set FINANCE_TEST_ADMIN_DATABASE to run PostgreSQL integration tests")
class AuthenticationIntegrationTest(unittest.TestCase):
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
