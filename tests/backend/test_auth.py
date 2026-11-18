import json
import os
import subprocess
import sys
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import app, get_store
from backend.auth import hash_password, token_hash, verify_password
from backend.config import parse_public_origin


NODE_HASH = (
    "scrypt$01010101010101010101010101010101$"
    "2c99e2846902ff39f50e2ece09cb806623d0d63bcc0b43b34c69de1bb53d14e9"
    "ff98910dda6890310a27bf886fc3226fc86e9d23dd9aee31b3243888f385bca9"
)


class FakeStore:
    def __init__(self):
        self.users = {}
        self.sessions = {}
        self.retry_after = None

    def auth_retry_after(self, email):
        return self.retry_after

    def register(self, email, password):
        self.users[email] = {"user_id": 1, "email": email, "password_hash": hash_password(password)}
        return self.create_session(1)

    def find_user(self, email):
        return self.users.get(email)

    def create_session(self, user_id):
        token = f"{len(self.sessions) + 1:064x}"
        self.sessions[token] = next(user for user in self.users.values() if user["user_id"] == user_id)
        return token

    def session_user(self, token):
        return self.sessions.get(token)

    def delete_session(self, token):
        self.sessions.pop(token, None)


class AuthenticationTest(unittest.TestCase):
    def setUp(self):
        self.store = FakeStore()
        app.dependency_overrides[get_store] = lambda: self.store
        self.client = TestClient(app, base_url="http://127.0.0.1:8000")
        self.headers = {"Origin": "http://127.0.0.1:8000"}

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()

    def test_password_hashes_are_compatible_with_node(self):
        self.assertTrue(verify_password("correct horse battery", NODE_HASH))
        self.assertFalse(verify_password("incorrect password", NODE_HASH))
        self.assertFalse(verify_password("correct horse battery", NODE_HASH + "$extra"))
        self.assertTrue(verify_password("correct horse battery", hash_password("correct horse battery")))
        self.assertEqual(len(token_hash("a" * 64)), 64)

    def test_register_login_session_and_logout(self):
        credentials = {"email": " Person@Example.com ", "password": "correct horse battery"}
        response = self.client.post("/api/auth/register", headers=self.headers, json=credentials)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"user": {"email": "person@example.com"}})
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertIn("SameSite=strict", response.headers["set-cookie"])
        self.assertEqual(self.client.get("/api/auth/session").json(), {"user": {"email": "person@example.com"}})

        response = self.client.post("/api/auth/logout", headers=self.headers, json={})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Max-Age=0", response.headers["set-cookie"])
        self.assertEqual(self.client.get("/api/auth/session").json(), {"user": None})

        bad = self.client.post("/api/auth/login", headers=self.headers, json={**credentials, "password": "incorrect password"})
        unknown = self.client.post("/api/auth/login", headers=self.headers, json={**credentials, "email": "missing@example.com"})
        self.assertEqual(bad.status_code, 401)
        self.assertEqual(bad.json(), unknown.json())
        login = self.client.post("/api/auth/login", headers=self.headers, json=credentials)
        self.assertEqual(login.status_code, 200)
        self.assertEqual(self.client.get("/api/auth/session").json(), {"user": {"email": "person@example.com"}})

    def test_rejects_invalid_input_and_other_origins(self):
        credentials = {"email": "person@example.com", "password": "correct horse battery"}
        response = self.client.post("/api/auth/register", headers={"Origin": "https://other.example"}, json=credentials)
        self.assertEqual(response.status_code, 403)
        for value in [None, [], {}, {**credentials, "email": "invalid"}, {**credentials, "password": "short"}]:
            response = self.client.post(
                "/api/auth/register", headers={**self.headers, "Content-Type": "application/json"},
                content=json.dumps(value),
            )
            self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/auth/register", headers={**self.headers, "Content-Type": "application/json"}, content=b"{")
        self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/auth/logout", headers={**self.headers, "Content-Type": "application/json"}, content=b"NaN")
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            "/api/auth/register", headers={**self.headers, "Content-Type": "application/json"},
            content=b"x" * 8193,
        )
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.store.users, {})

    def test_https_origin_requires_exact_host_and_sets_secure_cookie(self):
        credentials = {"email": "person@example.com", "password": "correct horse battery"}
        with patch("backend.config.PUBLIC_ORIGIN", "https://tracker.example.com"):
            with TestClient(app, base_url="https://tracker.example.com") as client:
                for headers in (
                    {"Origin": "https://evil.example.com"},
                    {"Origin": "https://tracker.example.com", "Host": "evil.example.com"},
                    {"Origin": "http://tracker.example.com"},
                    {"Origin": "https://evil.example.com", "X-Forwarded-Host": "tracker.example.com"},
                    {},
                ):
                    self.assertEqual(client.post("/api/auth/register", headers=headers, json=credentials).status_code, 403)
                response = client.post("/api/auth/register", headers={"Origin": "https://tracker.example.com"}, json=credentials)
                self.assertEqual(response.status_code, 201)
                self.assertIn("Secure", response.headers["set-cookie"])
                self.assertIn("HttpOnly", response.headers["set-cookie"])
                self.assertIn("SameSite=strict", response.headers["set-cookie"])
                logout = client.post("/api/auth/logout", headers={"Origin": "https://tracker.example.com"}, json={})
                self.assertIn("Secure", logout.headers["set-cookie"])

    def test_public_origin_configuration_rejects_unsafe_values(self):
        self.assertIsNone(parse_public_origin(None))
        self.assertEqual(parse_public_origin("https://tracker.onrender.com"), "https://tracker.onrender.com")
        for value in ("http://tracker.example.com", "https://tracker.example.com/", "https://a.example/path",
                      "https://user:pass@example.com", "https://a.example?x=1", "https://a.example:8080",
                      "https://a..example", "https://localhost", "https://a.example:", "https://a.example#fragment"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_public_origin(value)

    def test_remote_mode_without_database_url_fails_at_startup(self):
        env = os.environ.copy()
        env["PUBLIC_ORIGIN"] = "https://tracker.example.com"
        env.pop("DATABASE_URL", None)
        result = subprocess.run([sys.executable, "-c", "import backend.config"], env=env,
                                capture_output=True, text=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DATABASE_URL es obligatoria", result.stderr)

    def test_remote_authentication_rejects_limited_attempts_before_accessing_accounts(self):
        self.store.retry_after = 42
        credentials = {"email": "person@example.com", "password": "correct horse battery"}
        with patch("backend.config.PUBLIC_ORIGIN", "https://tracker.example.com"):
            with TestClient(app, base_url="https://tracker.example.com") as client:
                for action in ("register", "login"):
                    response = client.post(f"/api/auth/{action}",
                                           headers={"Origin": "https://tracker.example.com"}, json=credentials)
                    self.assertEqual(response.status_code, 429)
                    self.assertEqual(response.headers["retry-after"], "42")
                self.assertEqual(self.store.users, {})


if __name__ == "__main__":
    unittest.main()
