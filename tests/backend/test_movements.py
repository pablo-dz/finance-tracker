import unittest

from fastapi.testclient import TestClient

from backend.app import app, get_store
from backend.movements import get_movement_store


class SessionStore:
    def session_user(self, token):
        return {"household_id": 7} if token == "a" * 64 else None


class UnusedMovementStore:
    def personal_member(self, household_id):
        raise AssertionError("No debe consultar movimientos con datos inválidos")


class MovementValidationTest(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[get_store] = SessionStore
        app.dependency_overrides[get_movement_store] = UnusedMovementStore
        self.client = TestClient(app, base_url="http://127.0.0.1:8000")
        self.client.cookies.set("finance_session", "a" * 64)
        self.headers = {"Origin": "http://127.0.0.1:8000"}

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()

    def test_requires_session_and_rejects_invalid_months_and_origins(self):
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/api/gastos?mes=2020-06").status_code, 401)
        self.client.cookies.set("finance_session", "a" * 64)
        for path in ("/api/gastos", "/api/movimientos"):
            for query in ("", "?mes=2020-13", "?mes=2020-06&mes=2020-06"):
                self.assertEqual(self.client.get(path + query).status_code, 400)
        for query in ("?todos=0", "?todos=1&todos=1", "?todos=1&mes=2020-06"):
            self.assertEqual(self.client.get("/api/movimientos" + query).status_code, 400)
        response = self.client.post("/api/ingresos", headers={"Origin": "https://other.example"}, json={})
        self.assertEqual(response.status_code, 403)

    def test_rejects_invalid_identifiers_amounts_and_dates(self):
        income = {"id": "1", "merchant": "Sueldo", "amount": "1500", "date": "2020-06-02",
                  "accountId": 4, "categoryId": 6}
        transfer = {"id": "1", "amount": "50.25", "date": "2020-06-02",
                    "sourceAccountId": 4, "destinationAccountId": 8}
        cases = [
            ("/api/ingresos", {**income, "id": 1}),
            ("/api/ingresos", {**income, "id": "9223372036854775808"}),
            ("/api/ingresos", {**income, "amount": "1.25"}),
            ("/api/ingresos", {**income, "date": "2023-02-29"}),
            ("/api/ingresos", {**income, "accountId": True}),
            ("/api/transferencias", {**transfer, "destinationAccountId": 4}),
            ("/api/transferencias", {**transfer, "amount": "0.00"}),
            ("/api/transferencias", {**transfer, "note": None}),
        ]
        for path, body in cases:
            with self.subTest(path=path, body=body):
                self.assertEqual(self.client.put(path, headers=self.headers, json=body).status_code, 400)
        response = self.client.put(
            "/api/ingresos",
            headers={**self.headers, "Content-Type": "application/json"},
            content='{"id":"1","merchant":"Sueldo","amount":"1","date":"2020-06-02","accountId":1e999,"categoryId":1}',
        )
        self.assertEqual(response.status_code, 400)

    def test_planning_requires_authentication_and_validates_before_database_access(self):
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/api/categorias").status_code, 401)
        self.assertEqual(self.client.get("/api/presupuestos?mes=2020-06").status_code, 401)
        self.client.cookies.set("finance_session", "a" * 64)
        for query in ("", "?mes=2020-13", "?mes=2020-06&mes=2020-06"):
            self.assertEqual(self.client.get("/api/presupuestos" + query).status_code, 400)
        invalid_categories = [
            ("POST", {"name": " "}), ("PUT", {"id": True, "name": "Viajes"}),
            ("PATCH", {"id": 1, "active": 1}), ("PUT", {"id": 1, "name": "a" * 101}),
        ]
        for method, body in invalid_categories:
            with self.subTest(method=method, body=body):
                self.assertEqual(self.client.request(method, "/api/categorias", headers=self.headers, json=body).status_code, 400)
        budget = {"month": "2020-06", "categoryId": 1, "amount": "10"}
        invalid_budgets = [
            ("POST", {**budget, "amount": "1.25"}),
            ("POST", {**budget, "categoryId": True}),
            ("PUT", {**budget, "expectedAmount": "-1"}),
            ("PUT", {**budget, "expectedAmount": "1.999"}),
        ]
        for method, body in invalid_budgets:
            with self.subTest(method=method, body=body):
                self.assertEqual(self.client.request(method, "/api/presupuestos", headers=self.headers, json=body).status_code, 400)
        category = {"name": "Viajes", "active": True, "fixed": False}
        batch_budget = {"month": "2020-06", "amount": "10", "expectedAmount": None}
        invalid_batch = [
            {**batch_budget, "month": "2020-13"},
            {**batch_budget, "amount": "1.25"},
            {**batch_budget, "expectedAmount": "10.00"},
            {"month": "2020-06", "amount": "10"},
            {**batch_budget, "amount": None},
        ]
        for invalid in invalid_batch:
            with self.subTest(budget=invalid):
                self.assertEqual(self.client.post("/api/categorias/lote", headers=self.headers,
                                                  json={"changes": [{**category, "budget": invalid}]}).status_code, 400)
        self.assertEqual(self.client.post("/api/categorias/lote", headers=self.headers,
                                          json={"changes": [{**category, "active": False,
                                                             "budget": batch_budget}]}).status_code, 400)
        self.assertEqual(self.client.post("/api/categorias", headers={"Origin": "https://other.example"},
                                          json={"name": "Viajes"}).status_code, 403)

    def test_financial_operations_reject_bad_inputs_and_other_origins(self):
        cases = [
            ("POST", "/api/metas", {"name": "Viaje", "targetAmount": "0"}),
            ("POST", "/api/metas", {"name": "Viaje", "targetAmount": "100", "dueDate": "2023-02-29"}),
            ("POST", "/api/metas/aportes", {"goalId": 1, "amount": "1.5", "date": "2020-01-01"}),
            ("DELETE", "/api/metas/aportes", {"id": 1}),
            ("POST", "/api/cuentas", {"name": " ", "type": "savings", "amount": "0", "date": "2020-01-01"}),
            ("POST", "/api/cuentas", {"name": "Ahorro", "type": "otro", "amount": "0", "date": "2020-01-01"}),
            ("PUT", "/api/cuentas/saldo-inicial", {"accountId": 1, "amount": "10", "date": "2023-02-29"}),
            ("POST", "/api/cuentas/ajustes", {"accountId": 1, "amount": "0", "date": "2020-01-01", "reason": "Corrección"}),
            ("POST", "/api/cuentas/ajustes", {"accountId": 1, "amount": "1", "date": "2020-01-01", "reason": " "}),
        ]
        for method, path, body in cases:
            with self.subTest(path=path, body=body):
                self.assertEqual(self.client.request(method, path, headers=self.headers, json=body).status_code, 400)
        self.assertEqual(self.client.get("/api/reportes?mes=2020-06&meses=4").status_code, 400)
        self.assertEqual(self.client.post("/api/metas", headers={"Origin": "https://other.example"},
                                          json={"name": "Viaje", "targetAmount": "1"}).status_code, 403)

    def test_write_requests_require_local_host_origin_and_json(self):
        body = {"name": "Viaje", "targetAmount": "100"}
        cases = [
            {"Origin": "http://127.0.0.1:8000", "Host": "example.com"},
            {"Origin": "http://localhost:8000"},
            {},
        ]
        for headers in cases:
            with self.subTest(headers=headers):
                self.assertEqual(self.client.post("/api/metas", headers=headers, json=body).status_code, 403)
        self.assertEqual(self.client.post("/api/metas", headers=self.headers, content="{}").status_code, 403)

    def test_unsupported_methods_are_rejected(self):
        for method, path in (("POST", "/api/opciones"), ("PATCH", "/api/metas"),
                             ("DELETE", "/api/reportes"), ("GET", "/api/metas/aportes")):
            with self.subTest(method=method, path=path):
                self.assertEqual(self.client.request(method, path).status_code, 405)


class DashboardTest(unittest.TestCase):
    def test_dashboard_and_explicit_assets_are_served(self):
        with TestClient(app) as client:
            for path, content_type in (("/", "text/html"), ("/dashboard.js", "text/javascript"),
                                       ("/chart.js", "text/javascript"), ("/styles.css", "text/css"),
                                       *[(f"/modules/{name}.js", "text/javascript") for name in
                                         ("auth", "common", "expenses", "movements", "planning", "savings", "analytics", "visualizations")]):
                response = client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.headers["content-type"].startswith(content_type))
                self.assertEqual(response.headers["cache-control"], "no-cache")
            self.assertEqual(client.get("/styles.css?v=24").status_code, 200)
            self.assertEqual(client.get("/dashboard.js?v=27").status_code, 200)
            self.assertEqual(client.get("/modules/planning.js?v=27").status_code, 200)
            self.assertEqual(client.get("/modules/reports.js").status_code, 404)
            self.assertEqual(client.get("/server.js").status_code, 404)
            self.assertEqual(client.get("/modules/unknown.js").status_code, 404)


if __name__ == "__main__":
    unittest.main()
