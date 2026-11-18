import os
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

import psycopg
from psycopg import sql
from fastapi.testclient import TestClient

from backend.app import app


@unittest.skipUnless(os.environ.get("FINANCE_TEST_ADMIN_DATABASE"), "Set FINANCE_TEST_ADMIN_DATABASE to run PostgreSQL integration tests")
class MovementIntegrationTest(unittest.TestCase):
    def setUp(self):
        admin = psycopg.connect(dbname=os.environ["FINANCE_TEST_ADMIN_DATABASE"], autocommit=True)
        self.addCleanup(admin.close)
        self.database = "finance_test_" + uuid4().hex
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(self.database)))
        self.addCleanup(lambda: admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(self.database))))
        with psycopg.connect(dbname=self.database) as conn:
            for migration in ("001_schema.sql", "004_account_balances_and_transfers.sql",
                              "005_savings_goal_contributions.sql", "006_personal_category_archiving.sql",
                              "007_user_accounts.sql", "008_recurring_payments.sql"):
                conn.execute((Path("db/migrations") / migration).read_text())
        env_patch = patch.dict(os.environ, {"PGDATABASE": self.database})
        env_patch.start()
        self.addCleanup(env_patch.stop)
        os.environ.pop("DATABASE_URL", None)
        self.origin = "http://127.0.0.1:8000"
        self.headers = {"Origin": self.origin}
        self.client = TestClient(app, base_url=self.origin)
        self.addCleanup(self.client.close)
        self.other = TestClient(app, base_url=self.origin)
        self.addCleanup(self.other.close)
        for client, email in ((self.client, "person@example.test"), (self.other, "other@example.test")):
            response = client.post("/api/auth/register", headers=self.headers,
                                   json={"email": email, "password": "correct horse battery"})
            self.assertEqual(response.status_code, 201)
        with psycopg.connect(dbname=self.database) as conn:
            household, member = conn.execute(
                """SELECT h.household_id, m.member_id FROM finance.household h
                   JOIN finance.app_user u ON u.user_id = h.owner_user_id
                   JOIN finance.member m ON m.household_id = h.household_id WHERE u.email = %s""",
                ("person@example.test",),
            ).fetchone()
            self.second_account = conn.execute(
                """INSERT INTO finance.account (household_id, member_id, name, type, currency)
                   VALUES (%s, %s, 'Ahorro', 'savings', 'CLP') RETURNING account_id""",
                (household, member),
            ).fetchone()[0]

    def write(self, client, method, path, body, origin=None):
        return client.request(method, path, headers={"Origin": origin or self.origin}, json=body)

    def test_dashboard_analytics_and_personal_recurring_payments(self):
        options = self.client.get("/api/opciones").json()
        other_options = self.other.get("/api/opciones").json()
        account = next(a["id"] for a in options["accounts"] if a["name"] == "Cuenta principal")
        category = options["categories"][0]["id"]
        income_category = options["incomeCategories"][0]["id"]
        expense = {"merchant": "Mercado", "amount": "1500", "date": "2020-06-02",
                   "accountId": account, "categoryId": category}
        income = {"merchant": "Sueldo", "amount": "3000", "date": "2020-06-03",
                  "accountId": account, "categoryId": income_category}
        self.assertEqual(self.write(self.client, "POST", "/api/gastos", expense).status_code, 201)
        self.assertEqual(self.write(self.client, "POST", "/api/ingresos", income).status_code, 201)
        self.assertEqual(self.write(self.client, "POST", "/api/ingresos",
                                    {**income, "date": "2020-05-01", "amount": "1000"}).status_code, 201)
        self.assertEqual(self.write(self.client, "POST", "/api/presupuestos",
                                    {"month": "2020-06", "categoryId": category, "amount": "2000"}).status_code, 201)
        self.assertEqual(self.write(self.client, "PATCH", "/api/dashboard/categorias",
                                    {"id": category, "fixed": True}).status_code, 200)
        self.assertEqual(self.write(self.other, "PATCH", "/api/dashboard/categorias",
                                    {"id": category, "fixed": False}).status_code, 404)
        self.assertEqual(self.write(self.other, "POST", "/api/gastos",
                                    {**expense, "accountId": other_options["accounts"][0]["id"],
                                     "categoryId": other_options["categories"][0]["id"]}).status_code, 201)
        payment = {"name": "Suscripción", "amount": "12000.00", "frequency": "yearly"}
        self.assertEqual(self.write(self.client, "POST", "/api/recurrentes", payment).status_code, 201)
        item = self.client.get("/api/recurrentes").json()["payments"][0]
        self.assertEqual(self.other.get("/api/recurrentes").json()["payments"], [])
        self.assertEqual(self.write(self.other, "DELETE", "/api/recurrentes", {"id": item["id"]}).status_code, 404)
        self.assertEqual(self.write(self.client, "PUT", "/api/recurrentes",
                                    {**payment, "id": item["id"], "amount": "0"}).status_code, 400)
        self.assertEqual(self.write(self.client, "PUT", "/api/recurrentes",
                                    {**payment, "id": item["id"], "amount": "24000"}).status_code, 200)

        response = self.client.get("/api/dashboard?mes=2020-06")
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["current"],
                         {"month": "2020-06", "income": "3000.00", "expenses": "1500.00",
                          "saving": "1500.00", "savingRate": "50.00"})
        self.assertEqual(result["previous"]["income"], "1000.00")
        self.assertEqual(result["categories"][-1],
                         {"month": "2020-06", "id": category, "name": options["categories"][0]["name"],
                          "fixed": True, "amount": "1500.00"})
        self.assertEqual(result["daily"], [{"day": 2, "budgeted": "1500.00", "unbudgeted": "0"}])
        self.assertEqual(result["topExpenses"][0]["name"], "Mercado")
        self.assertEqual(result["merchants"][0]["amount"], "1500.00")
        self.assertEqual(result["balances"][-1]["balance"], "2500.00")
        transfer = {"amount": "500.25", "date": "2020-06-04", "sourceAccountId": account,
                    "destinationAccountId": self.second_account, "note": "Ahorro"}
        self.assertEqual(self.write(self.client, "POST", "/api/transferencias", transfer).status_code, 201)
        other_category = options["categories"][1]["id"]
        self.assertEqual(self.write(self.client, "POST", "/api/gastos",
                                    {**expense, "categoryId": other_category, "amount": "200",
                                     "date": "2020-06-05"}).status_code, 201)
        result = self.client.get("/api/dashboard?mes=2020-06").json()
        self.assertEqual(result["current"]["saving"], "1300.00")
        self.assertEqual(result["balances"][-1]["balance"], "2300.00")
        self.assertEqual(result["daily"][-1], {"day": 5, "budgeted": "0", "unbudgeted": "200.00"})
        self.assertIsNone(next(row for row in result["budgets"] if row["categoryId"] == other_category)["budget"])
        self.assertEqual(self.write(self.client, "DELETE", "/api/recurrentes", {"id": item["id"]}).status_code, 200)
        self.assertEqual(self.client.get("/api/recurrentes").json()["payments"], [])
        self.assertEqual(self.client.get("/api/dashboard?mes=2020-06&mes=2020-06").status_code, 400)

    def test_isolation_fractional_history_and_month_boundaries(self):
        options = self.client.get("/api/opciones").json()
        other_options = self.other.get("/api/opciones").json()
        account = options["accounts"][0]["id"]
        category = options["categories"][0]["id"]
        foreign_account = other_options["accounts"][0]["id"]
        foreign_category = other_options["categories"][0]["id"]
        own = {"merchant": "Compra", "amount": "100", "date": "2020-06-30",
               "accountId": account, "categoryId": category}
        other = {**own, "accountId": foreign_account, "categoryId": foreign_category, "amount": "200"}
        self.assertEqual(self.write(self.client, "POST", "/api/gastos", own).status_code, 201)
        self.assertEqual(self.write(self.other, "POST", "/api/gastos", other).status_code, 201)
        self.assertEqual(self.write(self.client, "POST", "/api/gastos", {**own, "date": "2020-07-01"}).status_code, 201)
        budget = {"month": "2020-06", "categoryId": category, "amount": "0"}
        self.assertEqual(self.write(self.client, "POST", "/api/presupuestos", budget).status_code, 201)
        with psycopg.connect(dbname=self.database) as conn:
            conn.execute(
                """UPDATE finance.transactions SET amount = 100.50
                   WHERE account_id = %s AND tx_date = '2020-06-30' AND type = 'expense'""",
                (account,),
            )
        expenses = self.client.get("/api/gastos?mes=2020-06").json()
        self.assertEqual(expenses["total"], "100.50")
        self.assertEqual(len(expenses["expenses"]), 1)
        self.assertEqual(expenses["categories"][0]["grand_total"], "100.50")
        row = next(item for item in self.client.get("/api/presupuestos?mes=2020-06").json()["categories"]
                   if item["categoryId"] == category)
        self.assertEqual((row["budget"], row["spent"], row["difference"], row["exceeded"]),
                         ("0.00", "100.50", "100.50", True))
        self.assertEqual(self.write(self.client, "PUT", "/api/gastos",
                                    {**own, "id": expenses["expenses"][0]["id"]}).status_code, 400)
        report = self.client.get("/api/reportes?mes=2020-06&meses=3").json()
        self.assertEqual((report["total"], report["average"]), ("100.50", "33.50"))
        self.assertEqual(self.client.get("/api/gastos?mes=2020-05").json()["total"], "0")
        self.assertEqual(self.other.get("/api/gastos?mes=2020-06").json()["total"], "200.00")

    def test_requires_exactly_one_active_personal_member(self):
        with psycopg.connect(dbname=self.database) as conn:
            household = conn.execute(
                """SELECT h.household_id FROM finance.household h
                   JOIN finance.app_user u ON u.user_id = h.owner_user_id WHERE u.email = %s""",
                ("person@example.test",),
            ).fetchone()[0]
            conn.execute("INSERT INTO finance.member (household_id, name) VALUES (%s, 'Adicional')", (household,))
        self.assertEqual(self.client.get("/api/gastos?mes=2020-06").status_code, 409)
        self.assertEqual(self.client.get("/api/reportes?mes=2020-06&meses=3").status_code, 409)
        self.assertEqual(self.client.get("/api/categorias").status_code, 409)
        self.assertEqual(self.write(self.client, "POST", "/api/metas",
                                    {"name": "Viaje", "targetAmount": "100"}).status_code, 409)
        with psycopg.connect(dbname=self.database) as conn:
            conn.execute("UPDATE finance.member SET is_active = false WHERE household_id = %s", (household,))
        self.assertEqual(self.client.get("/api/opciones").status_code, 409)

    def test_savings_reports_and_opening_balance(self):
        options = self.client.get("/api/opciones").json()
        account = next(a["id"] for a in options["accounts"] if a["name"] == "Cuenta principal")
        foreign = self.other.get("/api/opciones").json()["accounts"][0]["id"]
        expense = {"merchant": "Compra", "amount": "1500", "date": "2020-06-02",
                   "accountId": account, "categoryId": options["categories"][0]["id"]}
        self.assertEqual(self.write(self.client, "POST", "/api/gastos", expense).status_code, 201)
        balance = {"accountId": account, "amount": "2000.50", "expectedAmount": "0.00"}
        self.assertEqual(self.write(self.client, "PUT", "/api/cuentas/saldo-inicial", balance).status_code, 200)
        self.assertEqual(self.write(self.client, "PUT", "/api/cuentas/saldo-inicial", balance).status_code, 409)
        self.assertEqual(self.write(self.client, "PUT", "/api/cuentas/saldo-inicial",
                                    {**balance, "accountId": foreign}).status_code, 409)
        self.assertEqual(self.write(self.client, "POST", "/api/metas",
                                    {"name": " Viaje ", "targetAmount": "10000", "dueDate": "2021-01-01"}).status_code, 201)
        goal = self.client.get("/api/metas").json()["goals"][0]["id"]
        contribution = {"goalId": goal, "date": "2020-06-03", "amount": "500", "note": " Junio "}
        self.assertEqual(self.write(self.other, "POST", "/api/metas/aportes", contribution).status_code, 404)
        self.assertEqual(self.write(self.client, "POST", "/api/metas/aportes", contribution).status_code, 201)
        goal_data = self.client.get("/api/metas").json()["goals"][0]
        contribution_id = goal_data["contributions"][0]["id"]
        self.assertEqual(goal_data, {"id": goal, "name": "Viaje", "targetAmount": "10000.00",
                                     "dueDate": "2021-01-01", "saved": "500.00",
                                     "contributions": [{"id": contribution_id, "date": "2020-06-03",
                                                        "amount": "500.00", "note": "Junio", "editable": True}]})
        report = self.client.get("/api/reportes?mes=2020-06&meses=3").json()
        self.assertEqual([m["total"] for m in report["monthly"]], ["0", "0", "1500.00"])
        self.assertEqual(report["average"], "500.00")
        self.assertEqual(self.client.get("/api/reportes?mes=2020-06&meses=4").status_code, 400)
        self.assertEqual(self.client.get("/api/reportes?mes=2020-06&mes=2020-06&meses=3").status_code, 400)

        account_after = next(a for a in self.client.get("/api/opciones").json()["accounts"] if a["id"] == account)
        self.assertEqual(account_after["openingBalance"], "2000.50")
        self.assertEqual(account_after["balance"], "500.50")
        self.assertEqual(self.write(self.other, "DELETE", "/api/metas/aportes", {"id": contribution_id}).status_code, 404)
        self.assertEqual(self.write(self.client, "DELETE", "/api/metas/aportes", {"id": contribution_id}).status_code, 200)
        self.assertEqual(self.write(self.client, "DELETE", "/api/metas/aportes", {"id": contribution_id}).status_code, 404)
        self.assertEqual(self.client.get("/api/metas").json()["goals"][0]["saved"], "0")

    def test_future_movements_do_not_affect_current_balances(self):
        options = self.client.get("/api/opciones").json()
        account = next(a["id"] for a in options["accounts"] if a["name"] == "Cuenta principal")
        income = {"merchant": "Futuro", "amount": "1000", "date": "2999-06-01",
                  "accountId": account, "categoryId": options["incomeCategories"][0]["id"]}
        transfer = {"amount": "500", "date": "2999-06-02", "sourceAccountId": account,
                    "destinationAccountId": self.second_account}
        self.assertEqual(self.write(self.client, "POST", "/api/ingresos", income).status_code, 201)
        self.assertEqual(self.write(self.client, "POST", "/api/transferencias", transfer).status_code, 201)
        balances = {a["id"]: a["balance"] for a in self.client.get("/api/opciones").json()["accounts"]}
        self.assertEqual(balances[account], "0.00")
        self.assertEqual(balances[self.second_account], "0.00")
        movements = self.client.get("/api/movimientos?mes=2999-06").json()
        self.assertEqual(movements["incomeTotal"], "1000.00")
        self.assertEqual({m["type"] for m in movements["movements"]}, {"income", "transfer"})

    def test_category_batch_is_atomic_and_checks_previous_values(self):
        categories = self.client.get("/api/dashboard/categorias").json()["categories"]
        first, second = categories[:2]
        def edit(category, **values):
            return {"id": category["id"], "name": values.get("name", category["name"]),
                    "active": values.get("active", category["active"]), "fixed": values.get("fixed", category["fixed"]),
                    "expected": {key: category[key] for key in ("name", "active", "fixed")}}
        changes = [edit(first, name="Categoría de prueba", fixed=not first["fixed"]),
                   edit(second, active=False),
                   {"name": "Nueva categoría", "active": True, "fixed": True}]
        response = self.write(self.client, "POST", "/api/categorias/lote", {"changes": changes})
        self.assertEqual(response.status_code, 200)
        updated = response.json()["categories"]
        row = next(item for item in updated if item["id"] == first["id"])
        self.assertEqual((row["name"], row["fixed"]), ("Categoría de prueba", not first["fixed"]))
        self.assertFalse(next(item for item in updated if item["id"] == second["id"])["active"])
        self.assertTrue(next(item for item in updated if item["name"] == "Nueva categoría")["fixed"])

        rejected = [edit(row, name="No debe guardarse"),
                    {"name": "Nueva categoría", "active": True, "fixed": False}]
        self.assertEqual(self.write(self.client, "POST", "/api/categorias/lote", {"changes": rejected}).status_code, 409)
        self.assertEqual(next(item for item in self.client.get("/api/dashboard/categorias").json()["categories"]
                              if item["id"] == first["id"])["name"], "Categoría de prueba")
        self.assertEqual(self.write(self.client, "POST", "/api/categorias/lote", {"changes": [edit(first)]}).status_code, 409)
        self.assertEqual(self.write(self.other, "POST", "/api/categorias/lote", {"changes": [edit(row)]}).status_code, 409)
        self.assertEqual(self.write(self.client, "POST", "/api/categorias/lote",
                                    {"changes": [edit(row), edit(row)]}).status_code, 400)

    def test_category_batch_saves_budgets_atomically_and_detects_conflicts(self):
        first = self.client.get("/api/dashboard/categorias").json()["categories"][0]
        def edit(category, **values):
            return {"id": category["id"], "name": values.get("name", category["name"]),
                    "active": values.get("active", category["active"]), "fixed": category["fixed"],
                    "expected": {key: category[key] for key in ("name", "active", "fixed")}}
        def budget(amount, expected):
            return {"month": "2020-06", "amount": amount, "expectedAmount": expected}
        changes = [{**edit(first, name="Actualizada"), "budget": budget("1000", None)},
                   {"name": "Nueva", "active": True, "fixed": False, "budget": budget("500", None)}]
        response = self.write(self.client, "POST", "/api/categorias/lote", {"changes": changes})
        self.assertEqual(response.status_code, 200)
        first = next(row for row in response.json()["categories"] if row["id"] == first["id"])
        new = next(row for row in response.json()["categories"] if row["name"] == "Nueva")
        rows = self.client.get("/api/presupuestos?mes=2020-06").json()["categories"]
        self.assertEqual(next(row["budget"] for row in rows if row["categoryId"] == first["id"]), "1000.00")
        self.assertEqual(next(row["budget"] for row in rows if row["categoryId"] == new["id"]), "500.00")
        self.assertEqual(self.write(self.other, "POST", "/api/categorias/lote",
                                    {"changes": [{**edit(first), "budget": budget("5", "1000.00")}]}).status_code, 409)

        rejected = [{**edit(first, name="No guardar"), "budget": budget("2000", "1000.00")},
                    {**edit(new), "budget": budget(None, "999.00")}]
        self.assertEqual(self.write(self.client, "POST", "/api/categorias/lote", {"changes": rejected}).status_code, 409)
        rows = self.client.get("/api/presupuestos?mes=2020-06").json()["categories"]
        self.assertEqual(next(row["budget"] for row in rows if row["categoryId"] == first["id"]), "1000.00")
        self.assertEqual(next(row["name"] for row in self.client.get("/api/dashboard/categorias").json()["categories"]
                              if row["id"] == first["id"]), "Actualizada")
        changes = [{**edit(first), "budget": budget("0", "1000.00")},
                   {**edit(new), "budget": budget(None, "500.00")}]
        self.assertEqual(self.write(self.client, "POST", "/api/categorias/lote", {"changes": changes}).status_code, 200)
        rows = self.client.get("/api/presupuestos?mes=2020-06").json()["categories"]
        self.assertEqual(next(row["budget"] for row in rows if row["categoryId"] == first["id"]), "0.00")
        self.assertIsNone(next(row["budget"] for row in rows if row["categoryId"] == new["id"]))
        self.assertEqual(self.write(self.client, "POST", "/api/categorias/lote",
                                    {"changes": [{**edit(first), "budget": budget("8", None)}]}).status_code, 409)
        self.assertEqual(self.write(self.client, "POST", "/api/categorias/lote",
                                    {"changes": [{**edit(first, active=False), "budget": budget("8", "0.00")}]}).status_code, 400)
        with psycopg.connect(dbname=self.database) as conn:
            conn.execute("UPDATE finance.budget SET amount = 12.34 WHERE category_id = %s AND month_start = '2020-06-01'",
                         (first["id"],))
        self.assertEqual(self.write(self.client, "POST", "/api/categorias/lote",
                                    {"changes": [{**edit(first), "budget": budget(None, "12.34")}]}).status_code, 200)
        rows = self.client.get("/api/presupuestos?mes=2020-06").json()["categories"]
        self.assertIsNone(next(row["budget"] for row in rows if row["categoryId"] == first["id"]))

    def test_categories_and_budgets_preserve_history(self):
        categories = self.client.get("/api/categorias").json()["categories"]
        other_category = self.other.get("/api/categorias").json()["categories"][0]["id"]
        account = self.client.get("/api/opciones").json()["accounts"][0]["id"]
        self.assertEqual(self.write(self.client, "POST", "/api/categorias", {"name": " Viajes "}).status_code, 201)
        self.assertEqual(self.write(self.client, "POST", "/api/categorias", {"name": "Viajes"}).status_code, 409)
        category = next(c["id"] for c in self.client.get("/api/categorias").json()["categories"] if c["name"] == "Viajes")
        self.assertEqual(self.write(self.client, "PUT", "/api/categorias", {"id": other_category, "name": "Ajena"}).status_code, 409)
        self.assertEqual(self.write(self.client, "PUT", "/api/categorias", {"id": category, "name": categories[0]["name"]}).status_code, 409)
        self.assertEqual(self.write(self.client, "PUT", "/api/categorias", {"id": category, "name": " Vacaciones "}).status_code, 200)

        budget = {"month": "2020-06", "categoryId": category, "amount": "0"}
        self.assertEqual(self.write(self.client, "POST", "/api/presupuestos", budget).status_code, 201)
        self.assertEqual(self.write(self.client, "POST", "/api/presupuestos", budget).status_code, 409)
        self.assertEqual(self.write(self.other, "POST", "/api/presupuestos", budget).status_code, 409)
        self.assertEqual(self.write(self.client, "PUT", "/api/presupuestos", {**budget, "amount": "1000", "expectedAmount": "1.00"}).status_code, 409)
        self.assertEqual(self.write(self.client, "PUT", "/api/presupuestos", {**budget, "amount": "1000", "expectedAmount": "0.00"}).status_code, 200)
        expense = {"merchant": "Pasaje", "amount": "1500", "date": "2020-06-02",
                   "accountId": account, "categoryId": category}
        self.assertEqual(self.write(self.client, "POST", "/api/gastos", expense).status_code, 201)
        self.assertEqual(self.write(self.client, "PATCH", "/api/categorias", {"id": category, "active": False, "name": None}).status_code, 200)
        self.assertEqual(self.write(self.other, "PATCH", "/api/categorias", {"id": category, "active": True}).status_code, 409)
        self.assertEqual(self.write(self.client, "POST", "/api/categorias", {"name": "Vacaciones"}).status_code, 409)
        self.assertEqual(self.write(self.client, "PUT", "/api/presupuestos", {**budget, "amount": "2000", "expectedAmount": "1000.00"}).status_code, 409)
        self.assertEqual(self.write(self.client, "POST", "/api/gastos", expense).status_code, 400)
        self.assertEqual(self.write(self.client, "PUT", "/api/categorias", {"id": category, "name": "Otra"}).status_code, 409)
        row = next(c for c in self.client.get("/api/presupuestos?mes=2020-06").json()["categories"] if c["categoryId"] == category)
        self.assertEqual(row, {"categoryId": category, "category": "Vacaciones", "isActive": False,
                               "budget": "1000.00", "spent": "1500.00", "difference": "500.00", "exceeded": True})
        archived = next(c for c in self.client.get("/api/categorias").json()["categories"] if c["id"] == category)
        self.assertEqual(archived, {"id": category, "name": "Vacaciones", "active": False})
        self.assertEqual(self.write(self.client, "PATCH", "/api/categorias", {"id": category, "active": True}).status_code, 200)
        self.assertEqual(self.write(self.client, "PUT", "/api/presupuestos", {**budget, "amount": "2000", "expectedAmount": "1000.00"}).status_code, 200)
        self.assertEqual(self.client.get("/api/presupuestos?mes=2020-06&mes=2020-06").status_code, 400)

    def test_movements_and_user_boundaries(self):
        options = self.client.get("/api/opciones").json()
        other_options = self.other.get("/api/opciones").json()
        principal = next(account["id"] for account in options["accounts"] if account["name"] == "Cuenta principal")
        foreign = other_options["accounts"][0]["id"]
        expense_category = options["categories"][0]["id"]
        income_category = options["incomeCategories"][0]["id"]
        foreign_category = other_options["incomeCategories"][0]["id"]

        expense = {"merchant": " Café ", "amount": "1500", "date": "2020-06-02",
                   "accountId": principal, "categoryId": expense_category}
        income = {"merchant": " Sueldo ", "amount": "3000", "date": "2020-06-03",
                  "accountId": principal, "categoryId": income_category}
        transfer = {"amount": "0.25", "date": "2020-06-04", "sourceAccountId": principal,
                    "destinationAccountId": self.second_account, "note": " Ahorro "}
        for path, body in (("/api/gastos", expense), ("/api/ingresos", income), ("/api/transferencias", transfer)):
            self.assertEqual(self.write(self.client, "POST", path, body).status_code, 201)
        self.assertEqual(self.write(self.client, "POST", "/api/gastos", expense, "https://other.example").status_code, 403)
        self.assertEqual(self.write(self.client, "POST", "/api/ingresos", {**income, "accountId": foreign}).status_code, 400)
        self.assertEqual(self.write(self.client, "POST", "/api/ingresos", {**income, "categoryId": foreign_category}).status_code, 400)
        self.assertEqual(self.write(self.client, "POST", "/api/transferencias", {**transfer, "destinationAccountId": foreign}).status_code, 400)
        self.assertEqual(self.write(self.client, "POST", "/api/transferencias", {**transfer, "amount": "0.00"}).status_code, 400)
        self.assertEqual(self.client.get("/api/movimientos?mes=2020-06&mes=2020-06").status_code, 400)

        data = self.client.get("/api/movimientos?mes=2020-06").json()
        entries = {item["type"]: item for item in data["movements"]}
        expense_id = entries["expense"]["id"].removeprefix("transaction-")
        income_id = entries["income"]["id"].removeprefix("transaction-")
        transfer_id = entries["transfer"]["id"].removeprefix("transfer-")
        self.assertEqual(self.write(self.other, "PUT", "/api/ingresos", {**income, "id": income_id}).status_code, 400)
        self.assertEqual(self.write(self.other, "DELETE", "/api/gastos", {"id": expense_id}).status_code, 404)
        self.assertEqual(self.write(self.other, "DELETE", "/api/transferencias", {"id": transfer_id}).status_code, 404)
        self.assertEqual(self.write(self.client, "PUT", "/api/gastos", {**expense, "id": expense_id, "amount": "1000"}).status_code, 200)
        self.assertEqual(self.write(self.client, "PUT", "/api/ingresos", {**income, "id": income_id, "amount": "4000"}).status_code, 200)
        self.assertEqual(self.write(self.client, "PUT", "/api/transferencias", {**transfer, "id": transfer_id, "amount": "500.50"}).status_code, 200)

        paths = ("/api/opciones", "/api/gastos?mes=2020-06", "/api/movimientos?mes=2020-06")
        python_data = [self.client.get(path).json() for path in paths]
        balances = {account["id"]: account["balance"] for account in python_data[0]["accounts"]}
        self.assertEqual(balances[principal], "2499.50")
        self.assertEqual(balances[self.second_account], "500.50")
        self.assertEqual(python_data[1]["total"], "1000.00")
        self.assertEqual(python_data[2]["incomeTotal"], "4000.00")
        self.assertEqual(python_data[1]["expenses"][0]["merchant"], "Café")
        self.assertEqual({movement["id"] for movement in python_data[2]["movements"]},
                         {"transaction-" + expense_id, "transaction-" + income_id, "transfer-" + transfer_id})

        with psycopg.connect(dbname=self.database) as conn:
            conn.execute(
                """INSERT INTO finance.transactions
                   (transaction_id, household_id, member_id, account_id, category_id, tx_date, amount, type, merchant)
                   SELECT 9007199254740993, household_id, member_id, account_id, category_id,
                          '2020-06-01', 1.25, type, 'Centavos'
                   FROM finance.transactions WHERE transaction_id = %s""",
                (income_id,),
            )
        self.assertEqual(self.write(self.client, "PUT", "/api/ingresos",
                                    {**income, "id": "9007199254740993"}).status_code, 400)
        legacy = self.client.get("/api/movimientos?mes=2020-06").json()["movements"]
        self.assertTrue(any(item["id"] == "transaction-9007199254740993" and item["amount"] == "1.25" for item in legacy))
        self.assertEqual(self.write(self.client, "DELETE", "/api/ingresos", {"id": "9007199254740993"}).status_code, 200)

        for path, identifier in (("/api/gastos", expense_id), ("/api/ingresos", income_id),
                                 ("/api/transferencias", transfer_id)):
            self.assertEqual(self.write(self.client, "DELETE", path, {"id": identifier}).status_code, 200)
            self.assertEqual(self.write(self.client, "DELETE", path, {"id": identifier}).status_code, 404)
        self.assertEqual(self.client.get("/api/gastos?mes=2020-06").json()["total"], "0")
        self.assertEqual(self.client.get("/api/movimientos?mes=2020-06").json()["movements"], [])
        with TestClient(app, base_url=self.origin) as unauthenticated:
            self.assertEqual(unauthenticated.get("/api/movimientos?mes=2020-06").status_code, 401)

    def test_all_movement_history_is_ordered_and_isolated(self):
        options = self.client.get("/api/opciones").json()
        other = self.other.get("/api/opciones").json()
        principal = next(account["id"] for account in options["accounts"] if account["name"] == "Cuenta principal")
        expense = {"merchant": "Compra", "amount": "100", "date": "2020-06-02",
                   "accountId": principal, "categoryId": options["categories"][0]["id"]}
        income = {"merchant": "Sueldo", "amount": "300", "date": "2021-02-03",
                  "accountId": principal, "categoryId": options["incomeCategories"][0]["id"]}
        self.assertEqual(self.write(self.client, "POST", "/api/gastos", expense).status_code, 201)
        self.assertEqual(self.write(self.client, "POST", "/api/ingresos", income).status_code, 201)
        transfer = {"amount": "25.50", "date": "2022-01-01", "sourceAccountId": expense["accountId"],
                    "destinationAccountId": self.second_account, "note": "Ahorro"}
        self.assertEqual(self.write(self.client, "POST", "/api/transferencias", transfer).status_code, 201)
        self.assertEqual(self.write(self.other, "POST", "/api/gastos",
                                    {**expense, "accountId": other["accounts"][0]["id"],
                                     "categoryId": other["categories"][0]["id"]}).status_code, 201)
        with psycopg.connect(dbname=self.database) as conn:
            historical_member = conn.execute(
                """INSERT INTO finance.member (household_id, name, is_active)
                   SELECT household_id, 'Histórico', false FROM finance.account WHERE account_id = %s
                   RETURNING member_id""", (expense["accountId"],),
            ).fetchone()[0]
            conn.execute(
                """INSERT INTO finance.transactions (household_id, member_id, account_id, category_id, tx_date, amount, type, merchant)
                   SELECT household_id, %s, account_id, category_id, '2019-01-01', 12.50, 'expense', 'Histórico'
                   FROM finance.transactions WHERE account_id = %s AND type = 'expense'""",
                (historical_member, expense["accountId"]),
            )
        history = self.client.get("/api/movimientos?todos=1")
        self.assertEqual(history.status_code, 200)
        rows = history.json()["movements"]
        self.assertEqual([row["description"] for row in rows], ["Ahorro", "Sueldo", "Compra", "Histórico"])
        self.assertEqual([row["editable"] for row in rows[1:]], [True, True, False])
        self.assertEqual(rows[-1]["amount"], "12.50")
        self.assertEqual(len(self.other.get("/api/movimientos?todos=1").json()["movements"]), 1)
        self.assertEqual(len(self.client.get("/api/movimientos?mes=2020-06").json()["movements"]), 1)


if __name__ == "__main__":
    unittest.main()
