from .store import connect


class FinancialStore:
    def __init__(self, connection_factory=connect):
        self.connection_factory = connection_factory

    def goals(self, member):
        with self.connection_factory() as conn:
            return conn.execute(
                """SELECT g.goal_id AS id, g.name, g.target_amount::text AS "targetAmount",
                          g.due_date::text AS "dueDate", g.account_id AS "accountId", ga.name AS "accountName",
                          COALESCE(SUM(sc.amount) FILTER (WHERE sc.contributed_on <= CURRENT_DATE), 0)::text AS saved,
                          COALESCE(json_agg(json_build_object(
                            'id', sc.contribution_id::text, 'date', to_char(sc.contributed_on, 'YYYY-MM-DD'),
                            'amount', sc.amount::text, 'note', sc.note, 'editable', sc.member_id = %(member)s,
                            'sourceAccount', src.name, 'destinationAccount', dst.name,
                            'sourceAccountId', tr.source_account_id, 'destinationAccountId', tr.destination_account_id,
                            'needsAccounts', sc.transfer_id IS NULL
                          ) ORDER BY sc.contributed_on DESC, sc.contribution_id DESC)
                            FILTER (WHERE sc.contribution_id IS NOT NULL), '[]'::json) AS contributions
                   FROM finance.savings_goal g
                   LEFT JOIN finance.account ga ON ga.account_id = g.account_id AND ga.household_id = g.household_id
                   LEFT JOIN finance.savings_contribution sc
                     ON sc.household_id = g.household_id AND sc.goal_id = g.goal_id
                   LEFT JOIN finance.account_transfer tr ON tr.transfer_id = sc.transfer_id AND tr.household_id = sc.household_id
                   LEFT JOIN finance.account src ON src.account_id = tr.source_account_id AND src.household_id = tr.household_id
                   LEFT JOIN finance.account dst ON dst.account_id = tr.destination_account_id AND dst.household_id = tr.household_id
                   WHERE g.household_id = %(household)s
                   GROUP BY g.goal_id, g.name, g.target_amount, g.due_date, ga.name
                   ORDER BY g.due_date NULLS LAST, g.name, g.goal_id""",
                {"household": member["household_id"], "member": member["member_id"]},
            ).fetchall()

    def create_goal(self, member, body):
        with self.connection_factory() as conn:
            return conn.execute(
                """INSERT INTO finance.savings_goal (household_id, name, target_amount, due_date, account_id)
                   SELECT h.household_id, %(name)s, %(amount)s::numeric, %(date)s::date, a.account_id
                   FROM finance.household h
                   JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                   JOIN finance.account a ON a.household_id = h.household_id AND a.account_id = %(account)s
                     AND a.is_active AND a.opening_configured AND a.currency = 'CLP' AND a.type = 'savings'
                     AND (a.member_id IS NULL OR a.member_id = m.member_id)
                   WHERE h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   RETURNING goal_id""",
                {"household": member["household_id"], "member": member["member_id"],
                 "name": body["name"].strip(), "amount": body["targetAmount"], "date": body.get("dueDate"),
                 "account": body["accountId"]},
            ).fetchone() is not None

    def assign_goal_account(self, member, body):
        params = {"household": member["household_id"], "member": member["member_id"],
                  "goal": body["id"], "account": body["accountId"]}
        with self.connection_factory() as conn:
            goal = conn.execute(
                """SELECT g.goal_id FROM finance.savings_goal g
                   JOIN finance.household h ON h.household_id = g.household_id
                   JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                   JOIN finance.account a ON a.household_id = h.household_id AND a.account_id = %(account)s
                     AND a.is_active AND a.opening_configured AND a.currency = 'CLP' AND a.type = 'savings'
                     AND (a.member_id IS NULL OR a.member_id = m.member_id)
                   WHERE g.goal_id = %(goal)s AND g.household_id = %(household)s AND g.account_id IS NULL
                     AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   FOR UPDATE OF g""", params,
            ).fetchone()
            if not goal:
                return False
            transfers = conn.execute(
                """SELECT tr.transfer_id, tr.source_account_id, tr.destination_account_id
                   FROM finance.savings_contribution sc
                   JOIN finance.account_transfer tr ON tr.transfer_id = sc.transfer_id AND tr.household_id = sc.household_id
                   WHERE sc.goal_id = %(goal)s AND sc.household_id = %(household)s
                   FOR UPDATE OF sc, tr""", params,
            ).fetchall()
            if any(params["account"] not in (tr["source_account_id"], tr["destination_account_id"]) for tr in transfers):
                return False
            for transfer in transfers:
                if transfer["source_account_id"] == params["account"]:
                    conn.execute(
                        """UPDATE finance.account_transfer
                           SET source_account_id = destination_account_id, destination_account_id = source_account_id
                           WHERE transfer_id = %s""", (transfer["transfer_id"],),
                    )
            conn.execute("UPDATE finance.savings_goal SET account_id = %(account)s WHERE goal_id = %(goal)s", params)
            return True

    def _contribution_transfer(self, conn, member, body, date, amount, note):
        return conn.execute(
            """INSERT INTO finance.account_transfer
                 (household_id, member_id, source_account_id, destination_account_id, tx_date, amount, note)
               SELECT h.household_id, m.member_id, src.account_id, dst.account_id, %(date)s::date,
                      %(amount)s::numeric, %(note)s
               FROM finance.household h
               JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
               JOIN finance.account src ON src.household_id = h.household_id AND src.account_id = %(source)s
               JOIN finance.account dst ON dst.household_id = h.household_id AND dst.account_id = %(destination)s
               WHERE h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                 AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                 AND src.account_id <> dst.account_id
                 AND src.is_active AND dst.is_active AND src.currency = 'CLP' AND dst.currency = 'CLP'
                 AND (src.member_id IS NULL OR src.member_id = m.member_id)
                 AND (dst.member_id IS NULL OR dst.member_id = m.member_id)
                 AND src.opening_configured AND dst.opening_configured
                 AND (src.opening_date IS NULL OR %(date)s::date >= src.opening_date)
                 AND (dst.opening_date IS NULL OR %(date)s::date >= dst.opening_date)
               RETURNING transfer_id""",
            {"household": member["household_id"], "member": member["member_id"],
             "source": body["sourceAccountId"], "destination": body["destinationAccountId"],
             "date": date, "amount": amount, "note": note},
        ).fetchone()

    def create_contribution(self, member, body):
        with self.connection_factory() as conn:
            goal = conn.execute(
                """SELECT g.goal_id, g.name, g.target_amount, g.account_id
                   FROM finance.savings_goal g JOIN finance.household h ON h.household_id = g.household_id
                   JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                   WHERE g.goal_id = %(goal)s AND g.household_id = %(household)s AND h.base_currency = 'CLP'
                     AND h.name <> '[DEMO] Hogar de prueba'
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   FOR UPDATE OF g""",
                {"goal": body["goalId"], "household": member["household_id"], "member": member["member_id"]},
            ).fetchone()
            if not goal or goal["account_id"] is None or goal["account_id"] != body["destinationAccountId"]:
                return False
            saved = conn.execute(
                """SELECT COALESCE(SUM(amount), 0) AS saved FROM finance.savings_contribution
                   WHERE goal_id = %s AND household_id = %s AND contributed_on <= CURRENT_DATE""",
                (goal["goal_id"], member["household_id"]),
            ).fetchone()["saved"]
            if saved >= goal["target_amount"]:
                return False
            note = body.get("note", "").strip()
            transfer = self._contribution_transfer(conn, member, body, body["date"], body["amount"],
                                                   f"Aporte a {goal['name']}")
            if not transfer:
                return False
            conn.execute(
                """INSERT INTO finance.savings_contribution
                     (household_id, member_id, goal_id, contributed_on, amount, note, transfer_id)
                   VALUES (%s, %s, %s, %s::date, %s::numeric, NULLIF(BTRIM(%s), ''), %s)""",
                (member["household_id"], member["member_id"], goal["goal_id"], body["date"], body["amount"],
                 note, transfer["transfer_id"]),
            )
            return True

    def assign_contribution_accounts(self, member, body):
        with self.connection_factory() as conn:
            contribution = conn.execute(
                """SELECT sc.contribution_id, sc.contributed_on, sc.amount, g.name, g.account_id
                   FROM finance.savings_contribution sc
                   JOIN finance.savings_goal g ON g.goal_id = sc.goal_id AND g.household_id = sc.household_id
                   JOIN finance.household h ON h.household_id = sc.household_id
                   JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                   WHERE sc.contribution_id = %(id)s::bigint AND sc.household_id = %(household)s
                     AND sc.member_id = m.member_id AND sc.transfer_id IS NULL AND h.base_currency = 'CLP'
                     AND h.name <> '[DEMO] Hogar de prueba'
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   FOR UPDATE OF sc""",
                {"id": body["id"], "household": member["household_id"], "member": member["member_id"]},
            ).fetchone()
            if not contribution or contribution["account_id"] is None or contribution["account_id"] != body["destinationAccountId"]:
                return False
            transfer = self._contribution_transfer(conn, member, body, contribution["contributed_on"],
                                                   contribution["amount"], f"Aporte a {contribution['name']}")
            if not transfer:
                return False
            conn.execute("UPDATE finance.savings_contribution SET transfer_id = %s WHERE contribution_id = %s",
                         (transfer["transfer_id"], contribution["contribution_id"]))
            return True

    def delete_contribution(self, member, identifier):
        with self.connection_factory() as conn:
            row = conn.execute(
                """DELETE FROM finance.savings_contribution sc USING finance.household h, finance.member m
                   WHERE h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                     AND m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                     AND sc.contribution_id = %(id)s::bigint AND sc.household_id = h.household_id AND sc.member_id = m.member_id
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   RETURNING sc.transfer_id""",
                {"household": member["household_id"], "member": member["member_id"], "id": identifier},
            ).fetchone()
            if not row:
                return False
            if row["transfer_id"] is not None:
                conn.execute("DELETE FROM finance.account_transfer WHERE transfer_id = %s", (row["transfer_id"],))
            return True

    def delete_goal(self, member, identifier):
        with self.connection_factory() as conn:
            goal = conn.execute(
                """SELECT g.goal_id FROM finance.savings_goal g
                   JOIN finance.household h ON h.household_id = g.household_id
                   JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                   WHERE g.goal_id = %(id)s AND g.household_id = %(household)s AND h.base_currency = 'CLP'
                     AND h.name <> '[DEMO] Hogar de prueba'
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                   FOR UPDATE OF g""",
                {"id": identifier, "household": member["household_id"], "member": member["member_id"]},
            ).fetchone()
            if not goal:
                return False
            transfers = conn.execute(
                "DELETE FROM finance.savings_contribution WHERE goal_id = %s AND household_id = %s RETURNING transfer_id",
                (identifier, member["household_id"]),
            ).fetchall()
            for transfer in transfers:
                if transfer["transfer_id"] is not None:
                    conn.execute("DELETE FROM finance.account_transfer WHERE transfer_id = %s", (transfer["transfer_id"],))
            conn.execute("DELETE FROM finance.savings_goal WHERE goal_id = %s AND household_id = %s",
                         (identifier, member["household_id"]))
            return True

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

    def create_account(self, member, body):
        with self.connection_factory() as conn:
            return conn.execute(
                """INSERT INTO finance.account
                     (household_id, member_id, name, type, currency, opening_balance, opening_date, opening_configured)
                   SELECT h.household_id, m.member_id, %(name)s, %(type)s, 'CLP', %(amount)s::numeric, %(date)s::date, TRUE
                   FROM finance.household h
                   JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                   WHERE h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                     AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                     AND NOT EXISTS (SELECT 1 FROM finance.account a WHERE a.household_id = h.household_id
                                     AND lower(btrim(a.name)) = lower(%(name)s))
                   RETURNING account_id""",
                {"household": member["household_id"], "member": member["member_id"],
                 "name": body["name"].strip(), "type": body["type"], "amount": body["amount"], "date": body["date"]},
            ).fetchone() is not None

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
