import hashlib
import hmac
import re
import secrets


COOKIE_NAME = "finance_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
TOKEN_PATTERN = re.compile(r"[a-f0-9]{64}\Z")
HASH_PATTERN = re.compile(r"scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})\Z")


def valid_credentials(body):
    if not isinstance(body, dict):
        return False
    email = body.get("email")
    password = body.get("password")
    if not isinstance(email, str) or not isinstance(password, str):
        return False
    try:
        password_length = len(password.encode("utf-16-le")) // 2
        email_length = len(email.strip().encode("utf-16-le")) // 2
    except UnicodeEncodeError:
        return False
    return (
        email_length <= 254
        and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email.strip()) is not None
        and 12 <= password_length <= 128
    )


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password, stored_hash):
    match = HASH_PATTERN.fullmatch(stored_hash) if isinstance(stored_hash, str) else None
    if not match:
        return False
    salt, expected = (bytes.fromhex(value) for value in match.groups())
    actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
    return hmac.compare_digest(actual, expected)


def new_token():
    return secrets.token_hex(32)


def token_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def request_token(request):
    token = request.cookies.get(COOKIE_NAME)
    return token if token and TOKEN_PATTERN.fullmatch(token) else None
