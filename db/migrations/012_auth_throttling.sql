BEGIN;

CREATE TABLE finance.auth_throttle (
    bucket TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL CHECK (attempts > 0),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ix_auth_throttle_expiration ON finance.auth_throttle (expires_at);

COMMIT;
