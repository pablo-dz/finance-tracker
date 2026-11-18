import os
import subprocess
from getpass import getpass
from uuid import uuid4

import psycopg
from psycopg import sql

from .backup_neon import BACKUP_DIR, passphrase_pipe


def verify_backup(path, passphrase):
    if any(key.startswith("PG") for key in os.environ):
        raise ValueError("La prueba requiere un entorno PostgreSQL local sin variables PG configuradas.")
    env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    database = "finance_restore_test_" + uuid4().hex
    with psycopg.connect("host=/tmp dbname=postgres", autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(database)))
        try:
            password_fd = passphrase_pipe(passphrase)
            try:
                with subprocess.Popen(
                    ["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase-fd", str(password_fd),
                     "--decrypt", str(path)], stdout=subprocess.PIPE, pass_fds=(password_fd,),
                ) as decrypt:
                    try:
                        restore = subprocess.Popen(
                            ["pg_restore", "--host=/tmp", f"--dbname={database}", "--exit-on-error",
                             "--no-owner", "--no-acl"], stdin=decrypt.stdout, env=env,
                        )
                    finally:
                        decrypt.stdout.close()
                    with restore:
                        restore_status = restore.wait()
                    decrypt_status = decrypt.wait()
            finally:
                os.close(password_fd)
            if decrypt_status or restore_status:
                raise RuntimeError("Falló la restauración; revisa los mensajes anteriores.")
            with psycopg.connect(host="/tmp", dbname=database) as conn:
                exists = conn.execute(
                    "SELECT to_regclass('finance.app_user') IS NOT NULL "
                    "AND to_regclass('finance.transactions') IS NOT NULL"
                ).fetchone()[0]
                if not exists:
                    raise RuntimeError("La copia restaurada no contiene las tablas esperadas.")
        finally:
            admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database)))


def main():
    for key in list(os.environ):
        if key.startswith("PG"):
            del os.environ[key]
    backups = sorted(BACKUP_DIR.glob("finance-*.dump.gpg"))
    if not backups:
        raise FileNotFoundError("No se encontró un respaldo cifrado en la carpeta configurada.")
    path = backups[-1]
    print(f"Se probará el respaldo: {path}")
    if input("Se creará y eliminará una base temporal local. Escribe SI para continuar: ") != "SI":
        print("Prueba cancelada.")
        return
    password = getpass("Contraseña de cifrado del respaldo: ")
    verify_backup(path, password)
    print("Restauración verificada; la base temporal fue eliminada.")


if __name__ == "__main__":
    main()
