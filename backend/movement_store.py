from .store import connect


class MovementStore:
    def __init__(self, connection_factory=connect):
        self.connection_factory = connection_factory

    def personal_member(self, household_id):
        with self.connection_factory() as conn:
            rows = conn.execute(
                """SELECT h.household_id, h.name, m.member_id
                   FROM finance.household h
                   JOIN finance.member m ON m.household_id = h.household_id AND m.is_active
                   WHERE h.household_id = %s AND h.base_currency = 'CLP' AND h.name <> %s""",
                (household_id, "[DEMO] Hogar de prueba"),
            ).fetchall()
            return rows[0] if len(rows) == 1 else None

    def options(self, member):
        household_id = member["household_id"]
        member_id = member["member_id"]
        with self.connection_factory() as conn:
            accounts = conn.execute(
                """SELECT a.account_id AS id, a.name, a.opening_balance::text AS "openingBalance",
                   (a.opening_balance + COALESCE(SUM(CASE t.type WHEN 'income' THEN t.amount
                       WHEN 'expense' THEN -t.amount ELSE 0 END), 0)
                     + COALESCE((
                       SELECT SUM(CASE WHEN tr.source_account_id = a.account_id THEN -tr.amount ELSE tr.amount END)
                       FROM finance.account_transfer tr
                       WHERE tr.household_id = a.household_id AND tr.member_id = %(member)s
                         AND tr.tx_date <= CURRENT_DATE
                         AND (tr.source_account_id = a.account_id OR tr.destination_account_id = a.account_id)
                     ), 0))::text AS balance
                   FROM finance.account a
                   LEFT JOIN finance.transactions t ON t.household_id = a.household_id AND t.account_id = a.account_id
                     AND t.member_id = %(member)s AND t.type IN ('income', 'expense') AND t.tx_date <= CURRENT_DATE
                   WHERE a.household_id = %(household)s AND a.is_active AND a.currency = 'CLP'
                     AND (a.member_id IS NULL OR a.member_id = %(member)s)
                   GROUP BY a.account_id, a.household_id, a.name, a.opening_balance
                   ORDER BY a.name, a.account_id""",
                {"household": household_id, "member": member_id},
            ).fetchall()
            categories = conn.execute(
                """SELECT category_id AS id, name FROM finance.category
                   WHERE household_id = %s AND kind = 'expense' AND is_active ORDER BY name, category_id""",
                (household_id,),
            ).fetchall()
            income_categories = conn.execute(
                """SELECT category_id AS id, name FROM finance.category
                   WHERE household_id = %s AND kind = 'income' ORDER BY name, category_id""",
                (household_id,),
            ).fetchall()
        return {"household": member["name"], "accounts": accounts, "categories": categories,
                "incomeCategories": income_categories}

    def expenses(self, member, month):
        with self.connection_factory() as conn:
            result = conn.execute(
                """WITH filtered AS (
                     SELECT t.transaction_id, t.tx_date, t.amount, t.merchant, t.note,
                            t.member_id, t.account_id, t.category_id AS transaction_category_id,
                            c.category_id, c.name AS category
                     FROM finance.transactions t
                     LEFT JOIN finance.category c ON c.category_id = t.category_id AND c.household_id = t.household_id
                     WHERE t.household_id = %(household)s AND t.type = 'expense'
                       AND t.tx_date >= (%(month)s || '-01')::date
                       AND t.tx_date < ((%(month)s || '-01')::date + interval '1 month')
                   ), category_totals AS (
                     SELECT category_id, category, SUM(amount) AS amount, COUNT(*)::int AS count
                     FROM filtered GROUP BY category_id, category
                   ), total AS (SELECT COALESCE(SUM(amount), 0) AS amount FROM filtered)
                   SELECT total.amount::text AS total,
                     COALESCE((SELECT json_agg(json_build_object(
                       'category', COALESCE(category, 'Sin categoría'), 'total', amount::text,
                       'count', count, 'grand_total', total.amount::text
                     ) ORDER BY amount DESC, category) FROM category_totals), '[]'::json) AS categories,
                     COALESCE((SELECT json_agg(json_build_object(
                       'id', transaction_id::text, 'accountId', account_id, 'categoryId', transaction_category_id,
                       'editable', member_id = %(member)s::integer, 'date', to_char(tx_date, 'YYYY-MM-DD'),
                       'merchant', merchant,
                       'description', COALESCE(NULLIF(BTRIM(merchant), ''), NULLIF(BTRIM(note), ''), 'Sin descripción'),
                       'category', COALESCE(category, 'Sin categoría'), 'amount', amount::text
                     ) ORDER BY tx_date DESC, transaction_id DESC) FROM filtered), '[]'::json) AS expenses
                   FROM total""",
                {"household": member["household_id"], "member": member["member_id"], "month": month},
            ).fetchone()
        return {"month": month, **result}

    def movements(self, member, month):
        with self.connection_factory() as conn:
            result = conn.execute(
                """SELECT COALESCE(json_agg(movement ORDER BY sort_date DESC, sort_id DESC), '[]'::json) AS movements,
                          COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)::text AS "incomeTotal"
                   FROM (
                     SELECT json_build_object(
                       'id', 'transaction-' || t.transaction_id::text,
                       'date', to_char(t.tx_date, 'YYYY-MM-DD'), 'type', t.type,
                       'description', COALESCE(NULLIF(BTRIM(t.merchant), ''), NULLIF(BTRIM(t.note), ''), 'Sin descripción'),
                       'amount', t.amount::text, 'merchant', t.merchant, 'accountId', t.account_id,
                       'categoryId', t.category_id, 'category', c.name, 'account', a.name,
                       'editable', COALESCE(t.member_id = %(member)s, false)
                     ) AS movement, t.tx_date AS sort_date, t.transaction_id AS sort_id, t.type, t.amount
                     FROM finance.transactions t
                     JOIN finance.account a ON a.account_id = t.account_id AND a.household_id = t.household_id
                     LEFT JOIN finance.category c ON c.category_id = t.category_id AND c.household_id = t.household_id
                     WHERE t.household_id = %(household)s AND t.type IN ('income', 'expense')
                       AND (t.member_id = %(member)s OR (%(month)s::text IS NULL AND t.type = 'expense'))
                       AND (%(month)s::text IS NULL OR (t.tx_date >= (%(month)s || '-01')::date
                         AND t.tx_date < ((%(month)s || '-01')::date + interval '1 month')))
                     UNION ALL
                     SELECT json_build_object(
                       'id', 'transfer-' || tr.transfer_id::text, 'date', to_char(tr.tx_date, 'YYYY-MM-DD'),
                       'type', 'transfer', 'description', COALESCE(NULLIF(BTRIM(tr.note), ''), 'Transferencia'),
                       'amount', tr.amount::text, 'note', tr.note, 'sourceAccountId', tr.source_account_id,
                       'destinationAccountId', tr.destination_account_id, 'category', NULL,
                       'account', source.name, 'destinationAccount', destination.name
                     ) AS movement, tr.tx_date AS sort_date, tr.transfer_id AS sort_id, 'transfer'::text AS type, tr.amount
                     FROM finance.account_transfer tr
                     JOIN finance.account source ON source.account_id = tr.source_account_id AND source.household_id = tr.household_id
                     JOIN finance.account destination ON destination.account_id = tr.destination_account_id AND destination.household_id = tr.household_id
                     WHERE tr.household_id = %(household)s AND tr.member_id = %(member)s
                       AND (%(month)s::text IS NULL OR (tr.tx_date >= (%(month)s || '-01')::date
                         AND tr.tx_date < ((%(month)s || '-01')::date + interval '1 month')))
                   ) entries""",
                {"household": member["household_id"], "member": member["member_id"], "month": month},
            ).fetchone()
        return {"month": month, **result}

    def write_transaction(self, member, kind, body, method):
        params = {
            "household": member["household_id"], "member": member["member_id"], "kind": kind,
            "account": body["accountId"], "category": body["categoryId"], "date": body["date"],
            "amount": body["amount"], "merchant": body["merchant"].strip(), "id": body.get("id"),
        }
        account = """a.household_id = h.household_id AND a.account_id = %(account)s
                     AND a.is_active AND a.currency = 'CLP' AND (a.member_id IS NULL OR a.member_id = m.member_id)"""
        category = """c.household_id = h.household_id AND c.category_id = %(category)s AND c.kind = %(kind)s
                      AND (%(kind)s <> 'expense' OR c.is_active)"""
        common = """h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                    AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1"""
        if method == "POST":
            query = f"""INSERT INTO finance.transactions
                        (household_id, member_id, account_id, category_id, tx_date, amount, type, merchant)
                        SELECT h.household_id, m.member_id, a.account_id, c.category_id,
                               %(date)s::date, %(amount)s::numeric, %(kind)s, %(merchant)s
                        FROM finance.household h
                        JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                        JOIN finance.account a ON {account}
                        JOIN finance.category c ON {category}
                        WHERE {common}
                        RETURNING transaction_id"""
        else:
            query = f"""UPDATE finance.transactions t
                        SET account_id = a.account_id, category_id = c.category_id, tx_date = %(date)s::date,
                            amount = %(amount)s::numeric, merchant = %(merchant)s
                        FROM finance.household h, finance.member m, finance.account a, finance.category c
                        WHERE {common}
                          AND m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                          AND {account} AND {category}
                          AND t.transaction_id = %(id)s::bigint AND t.household_id = h.household_id
                          AND t.member_id = m.member_id AND t.type = %(kind)s AND t.amount = trunc(t.amount)
                        RETURNING t.transaction_id"""
        with self.connection_factory() as conn:
            return conn.execute(query, params).fetchone() is not None

    def write_transfer(self, member, body, method):
        params = {
            "household": member["household_id"], "member": member["member_id"],
            "source": body["sourceAccountId"], "destination": body["destinationAccountId"],
            "date": body["date"], "amount": body["amount"], "note": body.get("note", "").strip(), "id": body.get("id"),
        }
        source = """src.household_id = h.household_id AND src.account_id = %(source)s
                    AND src.is_active AND src.currency = 'CLP' AND (src.member_id IS NULL OR src.member_id = m.member_id)"""
        destination = """dst.household_id = h.household_id AND dst.account_id = %(destination)s
                         AND dst.is_active AND dst.currency = src.currency
                         AND (dst.member_id IS NULL OR dst.member_id = m.member_id)"""
        common = """h.household_id = %(household)s AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
                    AND src.account_id <> dst.account_id
                    AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1"""
        if method == "POST":
            query = f"""INSERT INTO finance.account_transfer
                        (household_id, member_id, source_account_id, destination_account_id, tx_date, amount, note)
                        SELECT h.household_id, m.member_id, src.account_id, dst.account_id,
                               %(date)s::date, %(amount)s::numeric, NULLIF(BTRIM(%(note)s), '')
                        FROM finance.household h
                        JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                        JOIN finance.account src ON {source}
                        JOIN finance.account dst ON {destination}
                        WHERE {common}
                        RETURNING transfer_id"""
        else:
            query = f"""UPDATE finance.account_transfer tr
                        SET source_account_id = src.account_id, destination_account_id = dst.account_id,
                            tx_date = %(date)s::date, amount = %(amount)s::numeric, note = NULLIF(BTRIM(%(note)s), '')
                        FROM finance.household h, finance.member m, finance.account src, finance.account dst
                        WHERE {common}
                          AND m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                          AND {source} AND {destination}
                          AND tr.transfer_id = %(id)s::bigint AND tr.household_id = h.household_id AND tr.member_id = m.member_id
                        RETURNING tr.transfer_id"""
        with self.connection_factory() as conn:
            return conn.execute(query, params).fetchone() is not None

    def delete(self, member, kind, identifier):
        table, alias, id_column = (
            ("finance.account_transfer", "tr", "transfer_id") if kind == "transfer"
            else ("finance.transactions", "t", "transaction_id")
        )
        type_filter = "" if kind == "transfer" else "AND t.type = %(kind)s"
        query = f"""DELETE FROM {table} {alias}
                    USING finance.household h, finance.member m
                    WHERE h.household_id = %(household)s AND h.base_currency = 'CLP'
                      AND h.name <> '[DEMO] Hogar de prueba'
                      AND m.household_id = h.household_id AND m.member_id = %(member)s AND m.is_active
                      AND {alias}.{id_column} = %(id)s::bigint AND {alias}.household_id = h.household_id
                      AND {alias}.member_id = m.member_id {type_filter}
                      AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
                    RETURNING {alias}.{id_column}"""
        with self.connection_factory() as conn:
            return conn.execute(query, {
                "household": member["household_id"], "member": member["member_id"], "id": identifier, "kind": kind,
            }).fetchone() is not None
