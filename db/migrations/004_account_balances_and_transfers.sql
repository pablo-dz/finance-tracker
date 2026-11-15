BEGIN;

ALTER TABLE finance.account
  ADD COLUMN opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE finance.member
  ADD CONSTRAINT uq_member_household UNIQUE (member_id, household_id);

ALTER TABLE finance.account
  ADD CONSTRAINT uq_account_household UNIQUE (account_id, household_id);

CREATE TABLE finance.account_transfer (
    transfer_id         BIGSERIAL PRIMARY KEY,
    household_id        INT NOT NULL REFERENCES finance.household,
    member_id           INT NOT NULL,
    source_account_id   INT NOT NULL,
    destination_account_id INT NOT NULL,
    tx_date             DATE NOT NULL,
    amount              NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    note                TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (source_account_id <> destination_account_id),
    FOREIGN KEY (member_id, household_id)
      REFERENCES finance.member (member_id, household_id),
    FOREIGN KEY (source_account_id, household_id)
      REFERENCES finance.account (account_id, household_id),
    FOREIGN KEY (destination_account_id, household_id)
      REFERENCES finance.account (account_id, household_id)
);

CREATE INDEX ix_account_transfer_household_date
  ON finance.account_transfer (household_id, tx_date);

COMMIT;
