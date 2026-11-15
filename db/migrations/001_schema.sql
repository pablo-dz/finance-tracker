-- 001_schema.sql
-- Core tables. Everything hangs off "household", so going from one person
-- to two or more is just inserting another row in "member".

CREATE SCHEMA IF NOT EXISTS finance;
SET search_path = finance;

CREATE TABLE household (
    household_id  SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    base_currency CHAR(3) NOT NULL DEFAULT 'CLP'
);

CREATE TABLE member (
    member_id    SERIAL PRIMARY KEY,
    household_id INT NOT NULL REFERENCES household,
    name         TEXT NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE account (
    account_id   SERIAL PRIMARY KEY,
    household_id INT NOT NULL REFERENCES household,
    member_id    INT REFERENCES member,            -- NULL = shared account
    name         TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('checking','savings','credit','cash','investment')),
    currency     CHAR(3) NOT NULL DEFAULT 'CLP',
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE category (
    category_id  SERIAL PRIMARY KEY,
    household_id INT NOT NULL REFERENCES household,
    name         TEXT NOT NULL,
    parent_id    INT REFERENCES category,
    kind         TEXT NOT NULL CHECK (kind IN ('expense','income','saving')),
    is_fixed     BOOLEAN NOT NULL DEFAULT FALSE,   -- rent, internet, etc.
    UNIQUE (household_id, name)
);

CREATE TABLE transactions (
    transaction_id BIGSERIAL PRIMARY KEY,
    household_id   INT NOT NULL REFERENCES household,
    member_id      INT NOT NULL REFERENCES member,  -- who paid / received
    account_id     INT NOT NULL REFERENCES account,
    category_id    INT REFERENCES category,
    tx_date        DATE NOT NULL,
    amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    type           TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
    is_shared      BOOLEAN NOT NULL DEFAULT FALSE,  -- household expense vs personal
    merchant       TEXT,
    note           TEXT,
    source         TEXT NOT NULL DEFAULT 'manual',  -- manual | bank_statement | csv
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_tx_household_date ON transactions (household_id, tx_date);
CREATE INDEX ix_tx_category       ON transactions (category_id);

CREATE TABLE budget (
    budget_id    SERIAL PRIMARY KEY,
    household_id INT NOT NULL REFERENCES household,
    member_id    INT REFERENCES member,             -- NULL = household budget
    category_id  INT NOT NULL REFERENCES category,
    month_start  DATE NOT NULL CHECK (month_start = date_trunc('month', month_start)::date),
    amount       NUMERIC(14,2) NOT NULL CHECK (amount >= 0)
);
-- One budget per household/member/category/month (works on any Postgres version)
CREATE UNIQUE INDEX ux_budget ON budget (household_id, COALESCE(member_id, 0), category_id, month_start);

CREATE TABLE savings_goal (
    goal_id       SERIAL PRIMARY KEY,
    household_id  INT NOT NULL REFERENCES household,
    name          TEXT NOT NULL,
    target_amount NUMERIC(14,2) NOT NULL,
    due_date      DATE
);
