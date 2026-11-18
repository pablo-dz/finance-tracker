from .store import connect


class FinancialStore:
    def __init__(self, connection_factory=connect):
        self.connection_factory = connection_factory

    def goals(self, member):
        with self.connection_factory() as conn:
            return conn.execute(
                """SELECT g.goal_id AS id, g.name, g.target_amount::text AS "targetAmount",
                          g.due_date::text AS "dueDate", COALESCE(SUM(sc.amount), 0)::text AS saved,
                          COALESCE(json_agg(json_build_object(
                            'id', sc.contribution_id::text, 'date', to_char(sc.contributed_on, 'YYYY-MM-DD'),
                            'amount', sc.amount::text, 'note', sc.note, 'editable', sc.member_id = %(member)s
                          ) ORDER BY sc.contributed_on DESC, sc.contribution_id DESC)
                            FILTER (WHERE sc.contribution_id IS NOT NULL), '[]'::json) AS contributions
                   FROM finance.savings_goal g
                   LEFT JOIN finance.savings_contribution sc
                     ON sc.household_id = g.household_id AND sc.goal_id = g.goal_id
                   WHERE g.household_id = %(household)s
                   GROUP BY g.goal_id, g.name, g.target_amount, g.due_date
                   ORDER BY g.due_date NULLS LAST, g.name, g.goal_id""",
                {"household": member["household_id"], "member": member["member_id"]},
            ).fetchall()

    def create_goal(self, member, body):
        with self.connection_factory() as conn:
            return conn.execute(
                """INSERT INTO finance.savings_goal (household_id, name, target_amount, due_date)
                   SELECT h.household_id, %(name)s, %(amount)s::numeric, %(date)s::date
                   FROM finance.household h
                   JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                   WHERE h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   RETURNING goal_id""",
                {"household": member["household_id"], "member": member["member_id"],
                 "name": body["name"].strip(), "amount": body["targetAmount"], "date": body.get("dueDate")},
            ).fetchone() is not None

    def create_contribution(self, member, body):
        with self.connection_factory() as conn:
            return conn.execute(
                """INSERT INTO finance.savings_contribution (household_id, member_id, goal_id, contributed_on, amount, note)
                   SELECT h.household_id, m.member_id, g.goal_id, %(date)s::date, %(amount)s::numeric,
                          NULLIF(BTRIM(%(note)s), '')
                   FROM finance.household h
                   JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                   JOIN finance.savings_goal g ON g.household_id = h.household_id AND g.goal_id = %(goal)s
                   WHERE h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   RETURNING contribution_id""",
                {"household": member["household_id"], "member": member["member_id"],
                 "goal": body["goalId"], "date": body["date"], "amount": body["amount"],
                 "note": body.get("note", "").strip()},
            ).fetchone() is not None

    def delete_contribution(self, member, identifier):
        with self.connection_factory() as conn:
            return conn.execute(
                """DELETE FROM finance.savings_contribution sc USING finance.household h, finance.member m
                   WHERE h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                     AND m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                     AND sc.contribution_id = %(id)s::bigint AND sc.household_id = h.household_id AND sc.member_id = m.member_id
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   RETURNING sc.contribution_id""",
                {"household": member["household_id"], "member": member["member_id"], "id": identifier},
            ).fetchone() is not None

    def report(self, member, month, months):
        with self.connection_factory() as conn:
            return conn.execute(
                """WITH period AS (
                     SELECT (%(month)s || '-01')::date AS end_month,
                            ((%(month)s || '-01')::date - ((%(months)s::int - 1) * interval '1 month'))::date AS start_month
                   ), months AS (
                     SELECT generate_series(p.start_month, p.end_month, interval '1 month')::date AS month_start FROM period p
                   ), filtered AS (
                     SELECT date_trunc('month', t.tx_date)::date AS month_start, COALESCE(c.name, 'Sin categoría') AS category, t.amount
                     FROM finance.transactions t
                     JOIN finance.account a ON a.account_id = t.account_id AND a.household_id = t.household_id AND a.currency = 'CLP'
                     LEFT JOIN finance.category c ON c.category_id = t.category_id AND c.household_id = t.household_id AND c.kind = 'expense'
                     CROSS JOIN period p
                     WHERE t.household_id = %(household)s AND t.member_id = %(member)s AND t.type = 'expense'
                       AND t.tx_date >= p.start_month AND t.tx_date < (p.end_month + interval '1 month')
                   ), monthly AS (
                     SELECT m.month_start, COALESCE(SUM(f.amount), 0) AS amount, COUNT(f.amount)::int AS count
                     FROM months m LEFT JOIN filtered f ON f.month_start = m.month_start GROUP BY m.month_start
                   ), category_totals AS (
                     SELECT category, SUM(amount) AS amount, COUNT(*)::int AS count FROM filtered GROUP BY category
                   )
                   SELECT COALESCE((SELECT json_agg(json_build_object('month', to_char(month_start, 'YYYY-MM'),
                            'total', amount::text, 'count', count) ORDER BY month_start) FROM monthly), '[]'::json) AS monthly,
                          COALESCE((SELECT json_agg(json_build_object('category', category, 'total', amount::text, 'count', count)
                            ORDER BY amount DESC, category) FROM category_totals), '[]'::json) AS categories,
                          COALESCE((SELECT SUM(amount)::text FROM monthly), '0') AS total,
                          COALESCE((SELECT ROUND(AVG(amount), 2)::text FROM monthly), '0.00') AS average""",
                {"household": member["household_id"], "member": member["member_id"], "month": month, "months": months},
            ).fetchone()

    def update_opening_balance(self, member, body):
        with self.connection_factory() as conn:
            return conn.execute(
                """UPDATE finance.account a SET opening_balance = %(amount)s::numeric,
                       opening_date = %(date)s::date, opening_configured = TRUE
                   FROM finance.household h, finance.member m
                   WHERE h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                     AND m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                     AND a.household_id = h.household_id AND a.account_id = %(account)s
                     AND a.is_active AND a.currency = 'CLP' AND (a.member_id IS NULL OR a.member_id = m.member_id)
                     AND NOT a.opening_configured
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   RETURNING a.account_id""",
                {"household": member["household_id"], "member": member["member_id"], "account": body["accountId"],
                 "amount": body["amount"], "date": body["date"]},
            ).fetchone() is not None

    def adjustments(self, member):
        with self.connection_factory() as conn:
            return conn.execute(
                """SELECT adj.adjustment_id::text AS id, adj.account_id AS "accountId", a.name AS account,
                          adj.adjustment_date::text AS date, adj.amount::text AS amount, adj.reason
                   FROM finance.account_balance_adjustment adj
                   JOIN finance.account a ON a.account_id = adj.account_id AND a.household_id = adj.household_id
                   WHERE adj.household_id = %(household)s AND adj.member_id = %(member)s
                   ORDER BY adj.adjustment_date DESC, adj.adjustment_id DESC""",
                {"household": member["household_id"], "member": member["member_id"]},
            ).fetchall()

    def create_adjustment(self, member, body):
        with self.connection_factory() as conn:
            return conn.execute(
                """INSERT INTO finance.account_balance_adjustment
                     (household_id, member_id, account_id, adjustment_date, amount, reason)
                   SELECT h.household_id, m.member_id, a.account_id, %(date)s::date, %(amount)s::numeric, %(reason)s
                   FROM finance.household h
                   JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                   JOIN finance.account a ON a.household_id = h.household_id AND a.account_id = %(account)s
                     AND a.is_active AND a.currency = 'CLP' AND (a.member_id IS NULL OR a.member_id = m.member_id)
                     AND a.opening_configured AND (a.opening_date IS NULL OR %(date)s::date >= a.opening_date)
                   WHERE h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   RETURNING adjustment_id""",
                {"household": member["household_id"], "member": member["member_id"], "account": body["accountId"],
                 "date": body["date"], "amount": body["amount"], "reason": body["reason"].strip()},
            ).fetchone() is not None

    def delete_adjustment(self, member, identifier):
        with self.connection_factory() as conn:
            return conn.execute(
                """DELETE FROM finance.account_balance_adjustment adj USING finance.household h, finance.member m
                   WHERE h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                     AND m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                     AND adj.household_id = h.household_id AND adj.member_id = m.member_id
                     AND adj.adjustment_id = %(id)s::bigint
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   RETURNING adj.adjustment_id""",
                {"household": member["household_id"], "member": member["member_id"], "id": identifier},
            ).fetchone() is not None
