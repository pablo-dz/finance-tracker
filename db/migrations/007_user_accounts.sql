BEGIN;

CREATE TABLE finance.app_user (
    user_id       BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254)
);

ALTER TABLE finance.household
    ADD COLUMN owner_user_id BIGINT REFERENCES finance.app_user(user_id);

CREATE UNIQUE INDEX uq_household_owner_user
    ON finance.household (owner_user_id)
    WHERE owner_user_id IS NOT NULL;

CREATE TABLE finance.app_session (
    token_hash CHAR(64) PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES finance.app_user(user_id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_app_session_expiration ON finance.app_session (expires_at);

COMMIT;
