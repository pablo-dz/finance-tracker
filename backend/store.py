import os

import psycopg
from psycopg.rows import dict_row

from .auth import hash_password, new_token, token_hash


DEFAULT_CATEGORIES = [
    ("Rent", "expense", True),
    ("Utilities", "expense", True),
    ("Groceries", "expense", False),
    ("Transport", "expense", False),
    ("Dining out", "expense", False),
    ("Subscriptions", "expense", True),
    ("Health", "expense", False),
    ("Leisure", "expense", False),
    ("Salary", "income", False),
    ("Other income", "income", False),
]


def connect():
    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg.connect(url, row_factory=dict_row)
    return psycopg.connect(dbname=os.environ.get("PGDATABASE", "finance_tracker"), row_factory=dict_row)


class AuthStore:
    def __init__(self, connection_factory=connect):
        self.connection_factory = connection_factory

    def register(self, email, password):
        password_hash = hash_password(password)
        token = new_token()
        with self.connection_factory() as conn:
            with conn.transaction():
                user = conn.execute(
                    "INSERT INTO finance.app_user (email, password_hash) VALUES (%s, %s) RETURNING user_id",
                    (email, password_hash),
                ).fetchone()
                household = conn.execute(
                    "INSERT INTO finance.household (name, base_currency, owner_user_id) "
                    "VALUES ('Finanzas personales', 'CLP', %s) RETURNING household_id",
                    (user["user_id"],),
                ).fetchone()
                household_id = household["household_id"]
                member = conn.execute(
                    "INSERT INTO finance.member (household_id, name) VALUES (%s, 'Yo') RETURNING member_id",
                    (household_id,),
                ).fetchone()
                conn.execute(
                    "INSERT INTO finance.account (household_id, member_id, name, type, currency) "
                    "VALUES (%s, %s, 'Cuenta principal', 'checking', 'CLP')",
                    (household_id, member["member_id"]),
                )
                with conn.cursor() as cursor:
                    cursor.executemany(
                        "INSERT INTO finance.category (household_id, name, kind, is_fixed) VALUES (%s, %s, %s, %s)",
                        [(household_id, name, kind, fixed) for name, kind, fixed in DEFAULT_CATEGORIES],
                    )
                conn.execute(
                    "INSERT INTO finance.app_session (token_hash, user_id, expires_at) "
                    "VALUES (%s, %s, now() + interval '30 days')",
                    (token_hash(token), user["user_id"]),
                )
        return token

    def find_user(self, email):
        with self.connection_factory() as conn:
            return conn.execute(
                "SELECT u.user_id, u.email, u.password_hash "
                "FROM finance.app_user u JOIN finance.household h ON h.owner_user_id = u.user_id "
                "WHERE u.email = %s",
                (email,),
            ).fetchone()

    def create_session(self, user_id):
        token = new_token()
        with self.connection_factory() as conn:
            conn.execute(
                "INSERT INTO finance.app_session (token_hash, user_id, expires_at) "
                "VALUES (%s, %s, now() + interval '30 days')",
                (token_hash(token), user_id),
            )
        return token

    def session_user(self, token):
        with self.connection_factory() as conn:
            return conn.execute(
                "SELECT u.user_id, u.email, h.household_id "
                "FROM finance.app_session s "
                "JOIN finance.app_user u ON u.user_id = s.user_id "
                "JOIN finance.household h ON h.owner_user_id = u.user_id "
                "WHERE s.token_hash = %s AND s.expires_at > now()",
                (token_hash(token),),
            ).fetchone()

    def delete_session(self, token):
        with self.connection_factory() as conn:
            conn.execute("DELETE FROM finance.app_session WHERE token_hash = %s", (token_hash(token),))


def get_store():
    return AuthStore()
