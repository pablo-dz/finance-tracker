BEGIN;

ALTER TABLE finance.savings_goal
  ADD CONSTRAINT uq_savings_goal_household UNIQUE (goal_id, household_id);

CREATE TABLE finance.savings_contribution (
    contribution_id BIGSERIAL PRIMARY KEY,
    household_id    INT NOT NULL REFERENCES finance.household,
    member_id       INT NOT NULL REFERENCES finance.member,
    goal_id         INT NOT NULL,
    contributed_on  DATE NOT NULL,
    amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (goal_id, household_id)
      REFERENCES finance.savings_goal (goal_id, household_id)
);

CREATE INDEX ix_savings_contribution_goal_date
  ON finance.savings_contribution (goal_id, contributed_on, contribution_id);

COMMIT;
