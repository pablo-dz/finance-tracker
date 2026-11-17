import json
import unittest

from fastapi.testclient import TestClient

from backend.app import app, get_store
from backend.auth import hash_password, token_hash, verify_password


NODE_HASH = (
    "scrypt$01010101010101010101010101010101$"
    "2c99e2846902ff39f50e2ece09cb806623d0d63bcc0b43b34c69de1bb53d14e9"
    "ff98910dda6890310a27bf886fc3226fc86e9d23dd9aee31b3243888f385bca9"
)


class FakeStore:
    def __init__(self):
        self.users = {}
        self.sessions = {}

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


if __name__ == "__main__":
    unittest.main()
