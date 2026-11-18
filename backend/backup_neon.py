import os
import subprocess
from datetime import datetime, timezone
from getpass import getpass
from pathlib import Path

from psycopg.conninfo import conninfo_to_dict


BACKUP_DIR = Path.home() / "Documents" / "finance-tracker-backups"
CA_BUNDLE = "/etc/ssl/cert.pem"
PG_ENV = {
    "host": "PGHOST", "port": "PGPORT", "dbname": "PGDATABASE",
    "user": "PGUSER", "password": "PGPASSWORD", "channel_binding": "PGCHANNELBINDING",
}


def connection_environment(url):
    params = conninfo_to_dict(url)
    host = params.get("host", "")
    if not host.endswith(".neon.tech") or "-pooler." in host:
        raise ValueError("Usa la conexión directa de Neon, no la conexión con pooler.")
    if set(params) - (set(PG_ENV) | {"sslmode", "sslrootcert"}):
        raise ValueError("La URL contiene opciones de conexión no compatibles.")
    env = {key: value for key, value in os.environ.items() if not key.startswith("PG")}
    env.update({PG_ENV[key]: value for key, value in params.items() if key in PG_ENV})
    env.update({"PGSSLMODE": "verify-full", "PGSSLROOTCERT": CA_BUNDLE})
    return env


def passphrase_pipe(passphrase):
    if not passphrase or len(passphrase.encode("utf-8")) > 1024 or "\n" in passphrase or "\r" in passphrase:
        raise ValueError("La contraseña de cifrado debe tener entre 1 y 1024 bytes y no incluir saltos de línea.")
    read_fd, write_fd = os.pipe()
    try:
        with os.fdopen(write_fd, "wb") as stream:
            stream.write(passphrase.encode("utf-8") + b"\n")
    except Exception:
        os.close(read_fd)
        raise
    return read_fd


def create_backup(url, passphrase, directory=BACKUP_DIR):
    env = connection_environment(url)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    name = datetime.now(timezone.utc).strftime("finance-%Y%m%dT%H%M%S%fZ.dump.gpg")
    path = directory / name
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    success = False
    try:
        with os.fdopen(fd, "wb") as output:
            password_fd = passphrase_pipe(passphrase)
            try:
                with subprocess.Popen(["pg_dump", "--format=custom", "--no-owner", "--no-acl"],
                                      env=env, stdout=subprocess.PIPE) as dump:
                    try:
                        encrypt = subprocess.Popen(
                            ["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase-fd", str(password_fd),
                             "--symmetric", "--cipher-algo", "AES256"],
                            stdin=dump.stdout, stdout=output, pass_fds=(password_fd,),
                        )
                    finally:
                        dump.stdout.close()
                    with encrypt:
                        encryption_status = encrypt.wait()
                    dump_status = dump.wait()
            finally:
                os.close(password_fd)
            if dump_status or encryption_status:
                raise RuntimeError("Falló la creación del respaldo cifrado; revisa los mensajes anteriores.")
        password_fd = passphrase_pipe(passphrase)
        try:
            with path.open("rb") as encrypted, open(os.devnull, "wb") as discard:
                check = subprocess.run(
                    ["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase-fd", str(password_fd),
                     "--decrypt"],
                    stdin=encrypted, stdout=discard, pass_fds=(password_fd,), check=False,
                )
        finally:
            os.close(password_fd)
        if check.returncode:
            raise RuntimeError("No se pudo verificar el cifrado del respaldo.")
        success = True
        return path
    finally:
        if not success:
            path.unlink(missing_ok=True)


def main():
    url = getpass("URL directa de Neon: ")
    passphrase = getpass("Contraseña nueva para cifrar el respaldo: ")
    if passphrase != getpass("Repite la contraseña de cifrado: "):
        raise ValueError("Las contraseñas no coinciden.")
    path = create_backup(url, passphrase)
    print(f"Respaldo cifrado y verificado: {path}")
    print("Guarda la contraseña de cifrado por separado. Falta probar la restauración en una base aislada.")


if __name__ == "__main__":
    main()
