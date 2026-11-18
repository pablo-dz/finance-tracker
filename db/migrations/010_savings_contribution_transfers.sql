BEGIN;

ALTER TABLE finance.account_transfer
  ADD CONSTRAINT uq_transfer_household UNIQUE (transfer_id, household_id);

ALTER TABLE finance.savings_contribution
  ADD COLUMN transfer_id BIGINT UNIQUE,
  ADD CONSTRAINT fk_contribution_transfer
    FOREIGN KEY (transfer_id, household_id)
    REFERENCES finance.account_transfer (transfer_id, household_id);

COMMIT;
