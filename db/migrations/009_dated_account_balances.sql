BEGIN;

ALTER TABLE finance.account
  ADD COLUMN opening_date DATE,
  ADD COLUMN opening_configured BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE finance.account SET opening_configured = TRUE;

CREATE TABLE finance.account_balance_adjustment (
  adjustment_id BIGSERIAL PRIMARY KEY,
  household_id INT NOT NULL,
  member_id INT NOT NULL,
  account_id INT NOT NULL,
  adjustment_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount <> 0),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (member_id, household_id) REFERENCES finance.member (member_id, household_id),
  FOREIGN KEY (account_id, household_id) REFERENCES finance.account (account_id, household_id)
);

CREATE INDEX ix_account_balance_adjustment_account_date
  ON finance.account_balance_adjustment (account_id, adjustment_date);

COMMIT;
