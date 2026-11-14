-- 003_reference_data.sql
-- One household with one member, plus base categories.
-- Generic names on purpose: this repo is public-friendly, no personal data.
-- To add a partner later:
--   INSERT INTO finance.member (household_id, name) VALUES (1, 'Partner');

SET search_path = finance;

INSERT INTO household (name) VALUES ('My household');
INSERT INTO member (household_id, name) VALUES (1, 'Me');

INSERT INTO category (household_id, name, kind, is_fixed) VALUES
 (1, 'Rent',                 'expense', TRUE),
 (1, 'Utilities',            'expense', TRUE),
 (1, 'Groceries',            'expense', FALSE),
 (1, 'Transport',            'expense', FALSE),
 (1, 'Dining out',           'expense', FALSE),
 (1, 'Subscriptions',        'expense', TRUE),
 (1, 'Health',               'expense', FALSE),
 (1, 'Leisure',              'expense', FALSE),
 (1, 'Salary',               'income',  FALSE),
 (1, 'Other income',         'income',  FALSE),
 (1, 'Monthly savings',      'saving',  FALSE);
