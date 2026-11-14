-- 002_bi_views.sql
-- Star-schema views. Power BI reads ONLY these, so table changes
-- don't break the report.

SET search_path = finance;

CREATE VIEW dim_date AS
SELECT d::date                       AS date,
       EXTRACT(year  FROM d)::int    AS year,
       EXTRACT(month FROM d)::int    AS month_num,
       to_char(d, 'FMMonth')         AS month_name,
       date_trunc('month', d)::date  AS month_start,
       EXTRACT(isodow FROM d)::int   AS weekday
FROM generate_series('2026-01-01'::date, '2035-12-31'::date, '1 day') AS d;

CREATE VIEW dim_member AS
SELECT member_id, household_id, name FROM member;

CREATE VIEW dim_account AS
SELECT account_id, household_id, member_id, name, type, currency FROM account;

CREATE VIEW dim_category AS
SELECT c.category_id, c.household_id, c.name AS category,
       p.name AS parent_category, c.kind, c.is_fixed
FROM category c
LEFT JOIN category p ON p.category_id = c.parent_id;

CREATE VIEW fact_transactions AS
SELECT transaction_id, household_id, member_id, account_id, category_id,
       tx_date, type, is_shared, merchant, amount,
       CASE type WHEN 'expense' THEN -amount
                 WHEN 'income'  THEN  amount
                 ELSE 0 END AS net_amount
FROM transactions
WHERE type <> 'transfer';

CREATE VIEW fact_budget AS
SELECT household_id, member_id, category_id, month_start, amount AS budget_amount
FROM budget;
