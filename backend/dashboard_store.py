import calendar
from datetime import date
from decimal import Decimal, ROUND_CEILING

from .planning_store import PlanningStore
from .store import connect


def estimate_goal(target, saved, recent, today):
    remaining = Decimal(target) - Decimal(saved)
    if remaining <= 0:
        return {"status": "achieved", "date": None}
    recent = Decimal(recent)
    if recent <= 0:
        return {"status": "insufficient", "date": None}
    months = int((remaining * 3 / recent).to_integral_value(rounding=ROUND_CEILING))
    year, month = divmod(today.year * 12 + today.month - 1 + months, 12)
    month += 1
    if year > 9999:
        return {"status": "out_of_range", "date": None}
    day = min(today.day, calendar.monthrange(year, month)[1])
    return {"status": "estimated", "date": date(year, month, day).isoformat()}


class DashboardStore:
    def __init__(self, connection_factory=connect):
        self.connection_factory = connection_factory

    def categories(self, member):
        with self.connection_factory() as conn:
            return conn.execute(
                """SELECT category_id AS id, name, is_fixed AS fixed, is_active AS active
                   FROM finance.category
                   WHERE household_id = %s AND kind = 'expense'
                   ORDER BY is_active DESC, name, category_id""",
                (member["household_id"],),
            ).fetchall()

    def set_category_fixed(self, member, body):
        with self.connection_factory() as conn:
            return conn.execute(
                """UPDATE finance.category c SET is_fixed = %(fixed)s
                   WHERE c.category_id = %(id)s AND c.household_id = %(household)s AND c.kind = 'expense'
                     AND EXISTS (SELECT 1 FROM finance.member m
                       WHERE m.member_id = %(member)s AND m.household_id = c.household_id AND m.is_active)
                     AND (SELECT count(*) FROM finance.member m
                       WHERE m.household_id = c.household_id AND m.is_active) = 1
                   RETURNING c.category_id""",
                {"household": member["household_id"], "member": member["member_id"],
                 "id": body["id"], "fixed": body["fixed"]},
            ).fetchone() is not None

    def recurring(self, member):
        with self.connection_factory() as conn:
            return conn.execute(
                """SELECT recurring_payment_id::text AS id, name, amount::text AS amount, frequency
                   FROM finance.recurring_payment WHERE household_id = %s AND member_id = %s
                   ORDER BY name, recurring_payment_id""",
                (member["household_id"], member["member_id"]),
            ).fetchall()

    def write_recurring(self, member, body, method):
        params = {"household": member["household_id"], "member": member["member_id"],
                  "id": body.get("id"), "name": body.get("name", "").strip(),
                  "amount": body.get("amount"), "frequency": body.get("frequency")}
        personal = """EXISTS (SELECT 1 FROM finance.member m
                            JOIN finance.household h ON h.household_id = m.household_id
                            WHERE h.household_id = %(household)s AND h.base_currency = 'CLP'
                              AND h.name <> '[DEMO] Hogar de prueba'
                              AND m.member_id = %(member)s AND m.is_active
                              AND (SELECT count(*) FROM finance.member active
                                   WHERE active.household_id = h.household_id AND active.is_active) = 1)"""
        if method == "POST":
            query = f"""INSERT INTO finance.recurring_payment (household_id, member_id, name, amount, frequency)
                        SELECT %(household)s, %(member)s, %(name)s, %(amount)s::numeric, %(frequency)s
                        WHERE {personal} RETURNING recurring_payment_id"""
        elif method == "PUT":
            query = f"""UPDATE finance.recurring_payment SET name = %(name)s, amount = %(amount)s::numeric,
                          frequency = %(frequency)s WHERE household_id = %(household)s
                          AND member_id = %(member)s AND recurring_payment_id = %(id)s::bigint
                          AND {personal} RETURNING recurring_payment_id"""
        else:
            query = f"""DELETE FROM finance.recurring_payment WHERE household_id = %(household)s
                          AND member_id = %(member)s AND recurring_payment_id = %(id)s::bigint
                          AND {personal} RETURNING recurring_payment_id"""
        with self.connection_factory() as conn:
            return conn.execute(query, params).fetchone() is not None

    def analytics(self, member, month):
        params = {"household": member["household_id"], "member": member["member_id"], "month": month}
        with self.connection_factory() as conn:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            budgets = PlanningStore(self.connection_factory).budgets(member, month, conn)
            monthly = conn.execute(
                """WITH months AS (
                     SELECT generate_series((%(month)s || '-01')::date - interval '12 months',
                                            (%(month)s || '-01')::date, interval '1 month')::date AS start
                   ), totals AS (
                     SELECT date_trunc('month', t.tx_date)::date AS start,
                            sum(t.amount) FILTER (WHERE t.type = 'income') AS income,
                            sum(t.amount) FILTER (WHERE t.type = 'expense') AS expense
                     FROM finance.transactions t JOIN finance.account a
                       ON a.account_id = t.account_id AND a.household_id = t.household_id AND a.currency = 'CLP'
                     WHERE t.household_id = %(household)s AND t.member_id = %(member)s
                       AND t.type IN ('income', 'expense')
                       AND t.tx_date >= (%(month)s || '-01')::date - interval '12 months'
                       AND t.tx_date < (%(month)s || '-01')::date + interval '1 month'
                     GROUP BY 1
                   )
                   SELECT to_char(m.start, 'YYYY-MM') AS month, coalesce(t.income, 0)::text AS income,
                          coalesce(t.expense, 0)::text AS expenses
                   FROM months m LEFT JOIN totals t USING (start) ORDER BY m.start""",
                params,
            ).fetchall()
            categories = conn.execute(
                """SELECT to_char(t.tx_date, 'YYYY-MM') AS month, t.category_id AS id,
                          coalesce(c.name, 'Sin categoría') AS name, c.is_fixed AS fixed,
                          sum(t.amount)::text AS amount
                   FROM finance.transactions t
                   JOIN finance.account a ON a.account_id = t.account_id AND a.household_id = t.household_id
                     AND a.currency = 'CLP'
                   LEFT JOIN finance.category c ON c.category_id = t.category_id
                     AND c.household_id = t.household_id AND c.kind = 'expense'
                   WHERE t.household_id = %(household)s AND t.member_id = %(member)s AND t.type = 'expense'
                     AND t.tx_date >= (%(month)s || '-01')::date - interval '11 months'
                     AND t.tx_date < (%(month)s || '-01')::date + interval '1 month'
                   GROUP BY 1, 2, 3, 4 ORDER BY 1, 3, 2""",
                params,
            ).fetchall()
            daily = conn.execute(
                """SELECT extract(day FROM t.tx_date)::int AS day,
                          coalesce(sum(t.amount) FILTER (WHERE b.budget_id IS NOT NULL), 0)::text AS budgeted,
                          coalesce(sum(t.amount) FILTER (WHERE b.budget_id IS NULL), 0)::text AS unbudgeted
                   FROM finance.transactions t
                   JOIN finance.account a ON a.account_id = t.account_id AND a.household_id = t.household_id
                     AND a.currency = 'CLP'
                   LEFT JOIN finance.budget b ON b.household_id = t.household_id AND b.member_id = t.member_id
                     AND b.category_id = t.category_id AND b.month_start = (%(month)s || '-01')::date
                   WHERE t.household_id = %(household)s AND t.member_id = %(member)s AND t.type = 'expense'
                     AND t.tx_date >= (%(month)s || '-01')::date
                     AND t.tx_date < (%(month)s || '-01')::date + interval '1 month'
                     AND t.tx_date <= current_date GROUP BY 1 ORDER BY 1""",
                params,
            ).fetchall()
            top = conn.execute(
                """SELECT t.transaction_id::text AS id, to_char(t.tx_date, 'YYYY-MM-DD') AS date,
                          coalesce(nullif(btrim(t.merchant), ''), nullif(btrim(t.note), ''), 'Sin descripción') AS name,
                          t.amount::text AS amount
                   FROM finance.transactions t
                   JOIN finance.account a ON a.account_id = t.account_id AND a.household_id = t.household_id
                     AND a.currency = 'CLP'
                   WHERE t.household_id = %(household)s AND t.member_id = %(member)s AND t.type = 'expense'
                     AND t.tx_date >= (%(month)s || '-01')::date
                     AND t.tx_date < (%(month)s || '-01')::date + interval '1 month'
                   ORDER BY t.amount DESC, t.transaction_id DESC LIMIT 10""",
                params,
            ).fetchall()
            merchants = conn.execute(
                """SELECT coalesce(nullif(btrim(t.merchant), ''), 'Sin comercio') AS name,
                          count(*)::int AS count, sum(t.amount)::text AS amount
                   FROM finance.transactions t
                   JOIN finance.account a ON a.account_id = t.account_id AND a.household_id = t.household_id
                     AND a.currency = 'CLP'
                   WHERE t.household_id = %(household)s AND t.member_id = %(member)s AND t.type = 'expense'
                     AND t.tx_date >= (%(month)s || '-01')::date
                     AND t.tx_date < (%(month)s || '-01')::date + interval '1 month'
                   GROUP BY 1 ORDER BY sum(t.amount) DESC, count(*) DESC, 1 LIMIT 10""",
                params,
            ).fetchall()
            goals = conn.execute(
                """SELECT g.goal_id AS id, g.name, g.target_amount::text AS target,
                          coalesce(sum(sc.amount) FILTER (WHERE sc.contributed_on <= current_date), 0)::text AS saved,
                          coalesce(sum(sc.amount) FILTER (
                            WHERE sc.contributed_on >= date_trunc('month', current_date) - interval '3 months'
                              AND sc.contributed_on < date_trunc('month', current_date)), 0)::text AS recent
                   FROM finance.savings_goal g
                   LEFT JOIN finance.savings_contribution sc ON sc.goal_id = g.goal_id AND sc.household_id = g.household_id
                     AND sc.member_id = %(member)s
                   WHERE g.household_id = %(household)s
                   GROUP BY g.goal_id ORDER BY g.name, g.goal_id""",
                params,
            ).fetchall()
            today = conn.execute("SELECT current_date AS today").fetchone()["today"]
            balances = conn.execute(
                """WITH months AS (
                     SELECT generate_series((%(month)s || '-01')::date - interval '11 months',
                                            (%(month)s || '-01')::date, interval '1 month')::date AS start
                   ), accounts AS (
                     SELECT * FROM finance.account
                     WHERE household_id = %(household)s AND currency = 'CLP' AND is_active
                       AND (member_id IS NULL OR member_id = %(member)s)
                   )
                   SELECT to_char(m.start, 'YYYY-MM') AS month,
                     coalesce(sum(a.opening_balance
                       + coalesce((SELECT sum(CASE t.type WHEN 'income' THEN t.amount ELSE -t.amount END)
                           FROM finance.transactions t WHERE t.household_id = a.household_id
                             AND t.account_id = a.account_id AND t.member_id = %(member)s
                             AND t.type IN ('income', 'expense')
                             AND t.tx_date < least(m.start + interval '1 month', current_date + 1)), 0)
                       + coalesce((SELECT sum(CASE WHEN tr.source_account_id = a.account_id THEN -tr.amount ELSE tr.amount END)
                           FROM finance.account_transfer tr WHERE tr.household_id = a.household_id
                             AND tr.member_id = %(member)s AND (tr.source_account_id = a.account_id OR tr.destination_account_id = a.account_id)
                             AND tr.tx_date < least(m.start + interval '1 month', current_date + 1)), 0)), 0)::text AS balance
                   FROM months m LEFT JOIN accounts a ON true GROUP BY m.start ORDER BY m.start""",
                params,
            ).fetchall()
        for item in monthly:
            item["saving"] = str(Decimal(item["income"]) - Decimal(item["expenses"]))
            item["savingRate"] = (str((Decimal(item["saving"]) * 100 / Decimal(item["income"])).quantize(Decimal("0.01")))
                                  if Decimal(item["income"]) else None)
        for goal in goals:
            goal["estimate"] = estimate_goal(goal["target"], goal["saved"], goal["recent"], today)
        return {"month": month, "today": today.isoformat(), "current": monthly[-1], "previous": monthly[-2],
                "monthly": monthly[1:], "categories": categories, "budgets": budgets, "daily": daily,
                "goals": goals, "balances": balances, "topExpenses": top, "merchants": merchants}
