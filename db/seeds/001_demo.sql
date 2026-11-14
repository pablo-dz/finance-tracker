-- Datos ficticios para un hogar separado. Ejecutar solo de forma voluntaria.
-- Requiere las migraciones 001 y 002; no modifica los datos existentes.
BEGIN;

DO $$
DECLARE
    demo_household_id integer;
    demo_member_id integer;
    demo_account_id integer;
    month_offset integer;
    month_date date;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('finance.demo.seed.001'));

    IF EXISTS (SELECT 1 FROM finance.household WHERE name = '[DEMO] Hogar de prueba') THEN
        RAISE EXCEPTION 'Ya existe un hogar llamado [DEMO] Hogar de prueba; no se insertaron datos.';
    END IF;

    INSERT INTO finance.household (name, base_currency)
    VALUES ('[DEMO] Hogar de prueba', 'CLP')
    RETURNING household_id INTO demo_household_id;

    INSERT INTO finance.member (household_id, name)
    VALUES (demo_household_id, 'Persona de prueba')
    RETURNING member_id INTO demo_member_id;

    INSERT INTO finance.account (household_id, member_id, name, type, currency)
    VALUES (demo_household_id, demo_member_id, 'Cuenta de prueba', 'checking', 'CLP')
    RETURNING account_id INTO demo_account_id;

    INSERT INTO finance.category (household_id, name, kind, is_fixed) VALUES
        (demo_household_id, 'Arriendo', 'expense', true),
        (demo_household_id, 'Servicios', 'expense', true),
        (demo_household_id, 'Supermercado', 'expense', false),
        (demo_household_id, 'Transporte', 'expense', false),
        (demo_household_id, 'Salud', 'expense', false),
        (demo_household_id, 'Ocio', 'expense', false),
        (demo_household_id, 'Sueldo', 'income', true);

    FOR month_offset IN 0..2 LOOP
        month_date := (date_trunc('month', current_date) - make_interval(months => month_offset))::date;

        INSERT INTO finance.transactions
            (household_id, member_id, account_id, category_id, tx_date, amount, type, merchant, note, source)
        SELECT demo_household_id, demo_member_id, demo_account_id, c.category_id,
               month_date + sample.day_offset, sample.amount, sample.type,
               sample.merchant, 'Dato ficticio de prueba', 'demo'
        FROM (VALUES
            (0, 'Sueldo',       1800000::numeric, 'income',  'Empleador ficticio'),
            (1, 'Arriendo',      600000::numeric, 'expense', 'Arriendo ficticio'),
            (2, 'Servicios',      95000::numeric, 'expense', 'Servicios ficticios'),
            (3, 'Supermercado',  110000::numeric, 'expense', 'Supermercado ficticio'),
            (4, 'Transporte',     45000::numeric, 'expense', 'Transporte ficticio'),
            (5, 'Salud',          30000::numeric, 'expense', 'Farmacia ficticia'),
            (6, 'Ocio',           35000::numeric, 'expense', 'Actividad ficticia'),
            (7, 'Supermercado',   85000::numeric, 'expense', 'Supermercado ficticio')
        ) AS sample(day_offset, category_name, amount, type, merchant)
        JOIN finance.category c
          ON c.household_id = demo_household_id AND c.name = sample.category_name
        WHERE month_date + sample.day_offset <= current_date;

        INSERT INTO finance.budget (household_id, member_id, category_id, month_start, amount)
        SELECT demo_household_id, demo_member_id, c.category_id, month_date, limits.amount
        FROM (VALUES
            ('Arriendo',      600000::numeric),
            ('Servicios',     100000::numeric),
            ('Supermercado',  200000::numeric),
            ('Transporte',     80000::numeric),
            ('Salud',          50000::numeric),
            ('Ocio',           60000::numeric)
        ) AS limits(category_name, amount)
        JOIN finance.category c
          ON c.household_id = demo_household_id AND c.name = limits.category_name;
    END LOOP;

    INSERT INTO finance.savings_goal (household_id, name, target_amount, due_date)
    VALUES (demo_household_id, 'Fondo de mudanza ficticio', 3000000, NULL);

    RAISE NOTICE 'Hogar de prueba creado con ID %. Todos los montos son ficticios.', demo_household_id;
END $$;

COMMIT;
