import psycopg

from .store import connect


class PlanningStore:
    def __init__(self, connection_factory=connect):
        self.connection_factory = connection_factory

    def categories(self, household_id):
        with self.connection_factory() as conn:
            return conn.execute(
                """SELECT category_id AS id, name, is_active AS active
                   FROM finance.category WHERE household_id = %s AND kind = 'expense'
                   ORDER BY is_active DESC, name, category_id""",
                (household_id,),
            ).fetchall()

    def write_category(self, member, body, method):
        params = {
            "household": member["household_id"], "member": member["member_id"],
            "id": body.get("id"), "name": body["name"].strip() if method != "PATCH" else None,
            "active": body.get("active"),
        }
        common = """h.household_id = %(household)s AND h.base_currency = 'CLP'
                    AND h.name <> '[DEMO] Hogar de prueba'
                    AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1"""
        if method == "POST":
            query = f"""INSERT INTO finance.category (household_id, name, kind)
                        SELECT h.household_id, %(name)s, 'expense'
                        FROM finance.household h
                        JOIN finance.member m ON m.household_id = h.household_id
                          AND m.member_id = %(member)s AND m.is_active
                        WHERE {common}
                        ON CONFLICT (household_id, name) DO NOTHING RETURNING category_id"""
        elif method == "PUT":
            query = f"""UPDATE finance.category c SET name = %(name)s
                        FROM finance.household h
                        JOIN finance.member m ON m.household_id = h.household_id
                          AND m.member_id = %(member)s AND m.is_active
                        WHERE {common} AND c.household_id = h.household_id AND c.category_id = %(id)s
                          AND c.kind = 'expense' AND c.is_active
                          AND NOT EXISTS (SELECT 1 FROM finance.category other
                            WHERE other.household_id = h.household_id AND other.name = %(name)s
                              AND other.category_id <> c.category_id)
                        RETURNING c.category_id"""
        else:
            query = f"""UPDATE finance.category c SET is_active = %(active)s
                        FROM finance.household h
                        JOIN finance.member m ON m.household_id = h.household_id
                          AND m.member_id = %(member)s AND m.is_active
                        WHERE {common} AND c.household_id = h.household_id
                          AND c.category_id = %(id)s AND c.kind = 'expense'
                        RETURNING c.category_id"""
        with self.connection_factory() as conn:
            try:
                return conn.execute(query, params).fetchone() is not None
            except psycopg.errors.UniqueViolation:
                if method != "PUT":
                    raise
                return None

    def budgets(self, member, month):
        with self.connection_factory() as conn:
            rows = conn.execute(
                """WITH spent AS (
                     SELECT t.category_id, SUM(t.amount) AS amount
                     FROM finance.transactions t
                     JOIN finance.account a ON a.account_id = t.account_id
                       AND a.household_id = t.household_id AND a.currency = 'CLP'
                     WHERE t.household_id = %(household)s AND t.member_id = %(member)s AND t.type = 'expense'
                       AND t.tx_date >= (%(month)s || '-01')::date
                       AND t.tx_date < ((%(month)s || '-01')::date + interval '1 month')
                     GROUP BY t.category_id
                   )
                   SELECT c.category_id AS "categoryId", c.name AS category, c.is_active AS "isActive",
                          b.amount::text AS budget, COALESCE(s.amount, 0)::text AS spent,
                          ABS(b.amount - COALESCE(s.amount, 0))::text AS difference,
                          b.amount < COALESCE(s.amount, 0) AS exceeded
                   FROM finance.category c
                   LEFT JOIN finance.budget b ON b.household_id = c.household_id AND b.member_id = %(member)s
                     AND b.category_id = c.category_id AND b.month_start = (%(month)s || '-01')::date
                   LEFT JOIN spent s ON s.category_id = c.category_id
                   WHERE c.household_id = %(household)s AND c.kind = 'expense'
                     AND (c.is_active OR b.budget_id IS NOT NULL OR s.category_id IS NOT NULL)
                   ORDER BY c.name, c.category_id""",
                {"household": member["household_id"], "member": member["member_id"], "month": month},
            ).fetchall()
        return rows

    def write_budget(self, member, body, method):
        params = {"household": member["household_id"], "member": member["member_id"],
                  "category": body["categoryId"], "month": body["month"], "amount": body["amount"],
                  "expected": body.get("expectedAmount")}
        common = """h.household_id = %(household)s AND h.base_currency = 'CLP'
                    AND h.name <> '[DEMO] Hogar de prueba'
                    AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1"""
        if method == "POST":
            query = f"""INSERT INTO finance.budget (household_id, member_id, category_id, month_start, amount)
                        SELECT h.household_id, m.member_id, c.category_id,
                               (%(month)s || '-01')::date, %(amount)s::numeric
                        FROM finance.household h
                        JOIN finance.member m ON m.household_id = h.household_id
                          AND m.member_id = %(member)s AND m.is_active
                        JOIN finance.category c ON c.household_id = h.household_id AND c.category_id = %(category)s
                          AND c.kind = 'expense' AND c.is_active
                        WHERE {common}
                        ON CONFLICT (household_id, (COALESCE(member_id, 0)), category_id, month_start) DO NOTHING
                        RETURNING budget_id"""
        else:
            query = f"""UPDATE finance.budget b SET amount = %(amount)s::numeric
                        FROM finance.household h, finance.member m, finance.category c
                        WHERE {common} AND m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                          AND c.household_id = h.household_id AND c.category_id = %(category)s
                          AND c.kind = 'expense' AND c.is_active
                          AND b.household_id = h.household_id AND b.member_id = m.member_id AND b.category_id = c.category_id
                          AND b.month_start = (%(month)s || '-01')::date AND b.amount = %(expected)s::numeric
                        RETURNING b.budget_id"""
        with self.connection_factory() as conn:
            return conn.execute(query, params).fetchone() is not None
