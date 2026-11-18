BEGIN;

ALTER TABLE finance.savings_goal
  ADD COLUMN account_id INT,
  ADD CONSTRAINT fk_savings_goal_account
    FOREIGN KEY (account_id, household_id) REFERENCES finance.account (account_id, household_id);

COMMIT;
