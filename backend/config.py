import os
import re
from urllib.parse import urlsplit


def parse_public_origin(value):
    if not value:
        return None
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise ValueError("PUBLIC_ORIGIN debe ser un origen HTTPS válido.") from error
    hostname = parsed.hostname or ""
    labels = hostname.split(".")
    if (parsed.scheme != "https" or not parsed.netloc or parsed.username is not None
            or parsed.password is not None or parsed.path or parsed.query or parsed.fragment
            or port is not None or parsed.netloc != hostname or value != f"https://{hostname}"
            or len(hostname) > 253 or len(labels) < 2
            or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                   for label in labels)):
        raise ValueError("PUBLIC_ORIGIN debe ser un origen HTTPS válido sin ruta.")
    return value


PUBLIC_ORIGIN = parse_public_origin(os.environ.get("PUBLIC_ORIGIN"))
if PUBLIC_ORIGIN and not os.environ.get("DATABASE_URL"):
    raise ValueError("DATABASE_URL es obligatoria cuando se configura PUBLIC_ORIGIN.")
