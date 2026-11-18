CREATE TABLE finance.recurring_payment (
    recurring_payment_id BIGSERIAL PRIMARY KEY,
    household_id INT NOT NULL REFERENCES finance.household,
    member_id INT NOT NULL REFERENCES finance.member,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'yearly'))
);

CREATE INDEX ix_recurring_payment_person
    ON finance.recurring_payment (household_id, member_id);
