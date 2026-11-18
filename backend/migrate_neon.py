from getpass import getpass
from pathlib import Path
from urllib.parse import urlsplit

import psycopg


def apply_migrations(conn):
    exists = conn.execute(
        "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'finance')"
    ).fetchone()[0]
    if exists:
        raise ValueError("La base ya contiene el esquema finance; no se aplicó ninguna migración.")
    migrations = sorted((Path(__file__).resolve().parent.parent / "db" / "migrations").glob("*.sql"))
    if not migrations:
        raise ValueError("No se encontraron migraciones.")
    for path in migrations:
        print(f"Aplicando {path.name}", flush=True)
        conn.execute(path.read_text())


def main():
    url = getpass("URL directa de Neon: ")
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    if (parsed.scheme not in ("postgres", "postgresql") or not host.endswith(".neon.tech")
            or "-pooler." in host):
        raise ValueError("Usa la URL directa de Neon, no la URL con pooler.")
    with psycopg.connect(url, autocommit=True, sslmode="verify-full",
                         sslrootcert="/etc/ssl/cert.pem") as conn:
        if conn.info.host != host:
            raise ValueError("El servidor conectado no coincide con la URL directa de Neon.")
        apply_migrations(conn)
    print("Migraciones completadas.")


if __name__ == "__main__":
    main()
