import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = {
  "/": ["./web/index.html", "text/html; charset=utf-8"],
  "/dashboard.js": ["./web/dashboard.js", "text/javascript; charset=utf-8"],
  "/chart.js": ["./web/chart.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["./web/styles.css", "text/css; charset=utf-8"],
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function personalMember(pool, householdId) {
  if (!householdId) return null;
  const result = await pool.query(
    `SELECT h.household_id, h.name, m.member_id
     FROM finance.household h
     JOIN finance.member m ON m.household_id = h.household_id AND m.is_active
     WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> $2`,
    [householdId, "[DEMO] Hogar de prueba"],
  );
  return result.rows.length === 1 ? result.rows[0] : null;
}

function validDate(value) {
  if (typeof value !== "string" || !/^(?:19\d{2}|[2-9]\d{3})-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validMonth(value) {
  return typeof value === "string" && /^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(value);
}

function validBudget(body) {
  return body && typeof body === "object" && !Array.isArray(body)
    && validMonth(body.month)
    && Number.isSafeInteger(body.categoryId) && body.categoryId > 0 && body.categoryId <= 2147483647
    && typeof body.amount === "string" && /^(?:0|[1-9]\d{0,11})$/.test(body.amount);
}

function validExpense(body) {
  return body && typeof body === "object" && !Array.isArray(body)
    && typeof body.merchant === "string" && body.merchant.trim().length > 0 && body.merchant.trim().length <= 100
    && typeof body.amount === "string" && /^[1-9]\d{0,11}$/.test(body.amount)
    && validDate(body.date)
    && Number.isSafeInteger(body.accountId) && body.accountId > 0 && body.accountId <= 2147483647
    && Number.isSafeInteger(body.categoryId) && body.categoryId > 0 && body.categoryId <= 2147483647;
}

function validIncome(body) {
  return validExpense(body);
}

function validTransfer(body) {
  return body && typeof body === "object" && !Array.isArray(body)
    && validDate(body.date)
    && typeof body.amount === "string" && /^[1-9]\d{0,11}(?:\.\d{1,2})?$/.test(body.amount)
    && Number.isSafeInteger(body.sourceAccountId) && body.sourceAccountId > 0 && body.sourceAccountId <= 2147483647
    && Number.isSafeInteger(body.destinationAccountId) && body.destinationAccountId > 0
    && body.destinationAccountId <= 2147483647 && body.sourceAccountId !== body.destinationAccountId
    && (body.note === undefined || (typeof body.note === "string" && body.note.trim().length <= 100));
}

function validOpeningBalance(body) {
  return body && typeof body === "object" && !Array.isArray(body)
    && Number.isSafeInteger(body.accountId) && body.accountId > 0 && body.accountId <= 2147483647
    && typeof body.amount === "string" && /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(body.amount)
    && typeof body.expectedAmount === "string" && /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(body.expectedAmount);
}

function validTransactionId(value) {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value)
    && BigInt(value) <= 9223372036854775807n;
}

export function createDashboardServer(pool, { householdId = null } = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const expenseWrite = url.pathname === "/api/gastos" && ["POST", "PUT", "DELETE"].includes(request.method);
      const budgetWrite = url.pathname === "/api/presupuestos" && ["POST", "PUT"].includes(request.method);
      const incomeWrite = url.pathname === "/api/ingresos" && request.method === "POST";
      const incomeDelete = url.pathname === "/api/ingresos" && request.method === "DELETE";
      const transferWrite = url.pathname === "/api/transferencias" && request.method === "POST";
      const transferDelete = url.pathname === "/api/transferencias" && request.method === "DELETE";
      const openingBalanceWrite = url.pathname === "/api/cuentas/saldo-inicial" && request.method === "PUT";
      if (expenseWrite || budgetWrite || incomeWrite || incomeDelete || transferWrite || transferDelete || openingBalanceWrite) {
        const origin = `http://127.0.0.1:${request.socket.localPort}`;
        if (request.headers.host !== `127.0.0.1:${request.socket.localPort}` || request.headers.origin !== origin
          || request.headers["content-type"] !== "application/json") {
          sendJson(response, 403, { error: "Solicitud no permitida." });
          return;
        }
        const length = request.headers["content-length"];
        if (!length || !/^\d+$/.test(length) || Number(length) > 8192) {
          sendJson(response, 413, { error: "El contenido de la solicitud es demasiado grande o inválido." });
          return;
        }
        const chunks = [];
        let received = 0;
        for await (const chunk of request) {
          received += chunk.length;
          if (received > 8192) {
            sendJson(response, 413, { error: "El contenido de la solicitud es demasiado grande." });
            return;
          }
          chunks.push(chunk);
        }
        let expense;
        try {
          expense = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          sendJson(response, 400, { error: "El contenido de la solicitud no es válido." });
          return;
        }
        if (budgetWrite && (!validBudget(expense) || (request.method === "PUT"
          && (typeof expense.expectedAmount !== "string"
            || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(expense.expectedAmount))))) {
          sendJson(response, 400, { error: "Selecciona un mes y una categoría válidos e ingresa un límite entero en CLP." });
          return;
        }
        if (expenseWrite && request.method === "DELETE" && (!expense || typeof expense !== "object"
          || Array.isArray(expense) || !validTransactionId(expense.id))) {
          sendJson(response, 400, { error: "El identificador del gasto no es válido." });
          return;
        }
        if ((incomeDelete || transferDelete) && (!expense || typeof expense !== "object"
          || Array.isArray(expense) || !validTransactionId(expense.id))) {
          sendJson(response, 400, { error: "El identificador del movimiento no es válido." });
          return;
        }
        if (expenseWrite && request.method !== "DELETE" && (!validExpense(expense) || (request.method === "PUT" && !validTransactionId(expense.id)))) {
          sendJson(response, 400, { error: "Revisa la descripción, el monto entero en CLP, la fecha, la categoría y la cuenta." });
          return;
        }
        if (incomeWrite && !validIncome(expense)) {
          sendJson(response, 400, { error: "Revisa la descripción, el monto, la fecha, la categoría y la cuenta del ingreso." });
          return;
        }
        if (transferWrite && !validTransfer(expense)) {
          sendJson(response, 400, { error: "Revisa el monto, la fecha y las cuentas de origen y destino de la transferencia." });
          return;
        }
        if (openingBalanceWrite && !validOpeningBalance(expense)) {
          sendJson(response, 400, { error: "Ingresa un saldo inicial válido para la cuenta." });
          return;
        }
        const member = await personalMember(pool, householdId);
        if (!member) {
          sendJson(response, 409, { error: "Configura un hogar personal en CLP con un único integrante activo." });
          return;
        }
        if (incomeDelete || transferDelete) {
          const result = incomeDelete ? await pool.query(
            `DELETE FROM finance.transactions t
             USING finance.household h, finance.member m
             WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
               AND m.household_id = h.household_id AND m.member_id = $2 AND m.is_active
               AND t.transaction_id = $3::bigint AND t.household_id = h.household_id
               AND t.member_id = m.member_id AND t.type = 'income'
               AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
             RETURNING t.transaction_id::text`,
            [member.household_id, member.member_id, expense.id],
          ) : await pool.query(
            `DELETE FROM finance.account_transfer tr
             USING finance.household h, finance.member m
             WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
               AND m.household_id = h.household_id AND m.member_id = $2 AND m.is_active
               AND tr.transfer_id = $3::bigint AND tr.household_id = h.household_id
               AND tr.member_id = m.member_id
               AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
             RETURNING tr.transfer_id::text`,
            [member.household_id, member.member_id, expense.id],
          );
          if (result.rows.length !== 1) {
            sendJson(response, 404, { error: "El ingreso o transferencia no existe o ya no está disponible." });
            return;
          }
          sendJson(response, 200, { message: incomeDelete ? "Ingreso eliminado correctamente." : "Transferencia eliminada correctamente." });
          return;
        }
        if (openingBalanceWrite) {
          const result = await pool.query(
            `UPDATE finance.account a SET opening_balance = $4::numeric
             FROM finance.household h, finance.member m
             WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
               AND m.household_id = h.household_id AND m.member_id = $2 AND m.is_active
               AND a.household_id = h.household_id AND a.account_id = $3
               AND a.is_active AND a.currency = 'CLP' AND (a.member_id IS NULL OR a.member_id = m.member_id)
               AND a.opening_balance = $5::numeric
               AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
             RETURNING a.account_id`,
            [member.household_id, member.member_id, expense.accountId, expense.amount, expense.expectedAmount],
          );
          if (result.rows.length !== 1) {
            sendJson(response, 409, { error: "La cuenta o su saldo inicial cambió. Vuelve a consultar antes de editarlo." });
            return;
          }
          sendJson(response, 200, { message: "Saldo inicial actualizado correctamente." });
          return;
        }
        if (incomeWrite) {
          const result = await pool.query(
            `INSERT INTO finance.transactions
               (household_id, member_id, account_id, category_id, tx_date, amount, type, merchant)
             SELECT h.household_id, m.member_id, a.account_id, c.category_id, $5::date, $6::numeric, 'income', $7
             FROM finance.household h
             JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = $2 AND m.is_active
             JOIN finance.account a ON a.household_id = h.household_id AND a.account_id = $3
               AND a.is_active AND a.currency = 'CLP' AND (a.member_id IS NULL OR a.member_id = m.member_id)
             JOIN finance.category c ON c.household_id = h.household_id AND c.category_id = $4 AND c.kind = 'income'
             WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
               AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
             RETURNING transaction_id::text`,
            [member.household_id, member.member_id, expense.accountId, expense.categoryId, expense.date, expense.amount, expense.merchant.trim()],
          );
          if (result.rows.length !== 1) {
            sendJson(response, 400, { error: "La cuenta o categoría de ingreso no pertenece al hogar personal o no está disponible." });
            return;
          }
          sendJson(response, 201, { message: "Ingreso registrado correctamente." });
          return;
        }
        if (transferWrite) {
          const result = await pool.query(
            `INSERT INTO finance.account_transfer
               (household_id, member_id, source_account_id, destination_account_id, tx_date, amount, note)
             SELECT h.household_id, m.member_id, src.account_id, dst.account_id,
                    $5::date, $6::numeric, NULLIF(BTRIM($7), '')
             FROM finance.household h
             JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = $2 AND m.is_active
             JOIN finance.account src ON src.household_id = h.household_id AND src.account_id = $3
               AND src.is_active AND src.currency = 'CLP' AND (src.member_id IS NULL OR src.member_id = m.member_id)
             JOIN finance.account dst ON dst.household_id = h.household_id AND dst.account_id = $4
               AND dst.is_active AND dst.currency = src.currency
               AND (dst.member_id IS NULL OR dst.member_id = m.member_id)
             WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
               AND src.account_id <> dst.account_id
               AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
             RETURNING transfer_id::text`,
            [member.household_id, member.member_id, expense.sourceAccountId, expense.destinationAccountId, expense.date, expense.amount, expense.note?.trim() ?? ""],
          );
          if (result.rows.length !== 1) {
            sendJson(response, 400, { error: "Las cuentas de origen y destino deben estar activas, ser distintas y pertenecer al hogar personal." });
            return;
          }
          sendJson(response, 201, { message: "Transferencia registrada correctamente." });
          return;
        }
        if (budgetWrite) {
          const parameters = [member.household_id, member.member_id, expense.categoryId, expense.month, expense.amount];
          const result = request.method === "POST" ? await pool.query(
            `INSERT INTO finance.budget (household_id, member_id, category_id, month_start, amount)
             SELECT h.household_id, m.member_id, c.category_id, ($4 || '-01')::date, $5::numeric
             FROM finance.household h
             JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = $2 AND m.is_active
             JOIN finance.category c ON c.household_id = h.household_id AND c.category_id = $3 AND c.kind = 'expense'
             WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
               AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
             ON CONFLICT (household_id, (COALESCE(member_id, 0)), category_id, month_start) DO NOTHING
             RETURNING budget_id`,
            parameters,
          ) : await pool.query(
            `UPDATE finance.budget b SET amount = $5::numeric
             FROM finance.household h, finance.member m, finance.category c
             WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
               AND m.household_id = h.household_id AND m.member_id = $2 AND m.is_active
               AND c.household_id = h.household_id AND c.category_id = $3 AND c.kind = 'expense'
               AND b.household_id = h.household_id AND b.member_id = m.member_id AND b.category_id = c.category_id
               AND b.month_start = ($4 || '-01')::date AND b.amount = $6::numeric
               AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
             RETURNING b.budget_id`,
            [...parameters, expense.expectedAmount],
          );
          if (result.rows.length !== 1) {
            sendJson(response, 409, {
              error: request.method === "POST"
                ? "La categoría no está disponible o ya tiene un presupuesto para ese mes. Vuelve a consultar."
                : "El presupuesto cambió o ya no está disponible. Vuelve a consultar antes de editarlo.",
            });
            return;
          }
          sendJson(response, request.method === "POST" ? 201 : 200, { message: "Presupuesto guardado correctamente." });
          return;
        }
        if (request.method === "DELETE") {
          const result = await pool.query(
            `DELETE FROM finance.transactions t
             USING finance.household h, finance.member m
             WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
               AND m.household_id = h.household_id AND m.member_id = $2 AND m.is_active
               AND t.transaction_id = $3::bigint AND t.household_id = h.household_id
               AND t.member_id = m.member_id AND t.type = 'expense'
               AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
             RETURNING t.transaction_id::text`,
            [member.household_id, member.member_id, expense.id],
          );
          if (result.rows.length !== 1) {
            sendJson(response, 404, { error: "El gasto personal no existe o ya no está disponible." });
            return;
          }
          sendJson(response, 200, { message: "Gasto eliminado correctamente." });
          return;
        }
        const parameters = [member.household_id, member.member_id, expense.accountId, expense.categoryId, expense.date, expense.amount, expense.merchant.trim()];
        const result = request.method === "POST" ? await pool.query(
          `INSERT INTO finance.transactions
             (household_id, member_id, account_id, category_id, tx_date, amount, type, merchant)
           SELECT h.household_id, m.member_id, a.account_id, c.category_id, $5::date, $6::numeric, 'expense', $7
           FROM finance.household h
           JOIN finance.member m ON m.household_id = h.household_id AND m.member_id = $2 AND m.is_active
           JOIN finance.account a ON a.household_id = h.household_id AND a.account_id = $3
             AND a.is_active AND a.currency = 'CLP' AND (a.member_id IS NULL OR a.member_id = m.member_id)
           JOIN finance.category c ON c.household_id = h.household_id AND c.category_id = $4 AND c.kind = 'expense'
           WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
             AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
           RETURNING transaction_id::text`,
          parameters,
        ) : await pool.query(
          `UPDATE finance.transactions t
           SET account_id = a.account_id, category_id = c.category_id, tx_date = $5::date,
               amount = $6::numeric, merchant = $7
           FROM finance.household h, finance.member m, finance.account a, finance.category c
           WHERE h.household_id = $1 AND h.base_currency = 'CLP' AND h.name <> '[DEMO] Hogar de prueba'
             AND m.household_id = h.household_id AND m.member_id = $2 AND m.is_active
             AND a.household_id = h.household_id AND a.account_id = $3
             AND a.is_active AND a.currency = 'CLP' AND (a.member_id IS NULL OR a.member_id = m.member_id)
             AND c.household_id = h.household_id AND c.category_id = $4 AND c.kind = 'expense'
             AND t.transaction_id = $8::bigint AND t.household_id = h.household_id
             AND t.member_id = m.member_id AND t.type = 'expense' AND t.amount = trunc(t.amount)
             AND (SELECT count(*) FROM finance.member WHERE household_id = h.household_id AND is_active) = 1
           RETURNING t.transaction_id::text`,
          [...parameters, expense.id],
        );
        if (result.rows.length !== 1) {
          sendJson(response, 400, { error: "El gasto, cuenta o categoría no pertenece al hogar personal o ya no está disponible." });
          return;
        }
        sendJson(response, request.method === "POST" ? 201 : 200, {
          message: request.method === "POST" ? "Gasto registrado correctamente." : "Gasto actualizado correctamente.",
        });
        return;
      }

      if (request.method !== "GET") {
        const allow = url.pathname === "/api/gastos" ? "GET, POST, PUT, DELETE"
          : url.pathname === "/api/presupuestos" ? "GET, POST, PUT"
            : url.pathname === "/api/ingresos" || url.pathname === "/api/transferencias" ? "GET, POST, DELETE"
              : url.pathname === "/api/cuentas/saldo-inicial" ? "GET, PUT" : "GET";
        response.writeHead(405, { Allow: allow });
        response.end();
        return;
      }

      if (url.pathname === "/api/opciones") {
        const member = await personalMember(pool, householdId);
        if (!member) {
          sendJson(response, 409, { error: "Configura FINANCE_HOUSEHOLD_ID con un hogar personal en CLP que tenga un único integrante activo." });
          return;
        }
        const accounts = await pool.query(
          `SELECT a.account_id AS id, a.name, a.opening_balance::text AS "openingBalance",
             (a.opening_balance + COALESCE(SUM(CASE t.type WHEN 'income' THEN t.amount WHEN 'expense' THEN -t.amount ELSE 0 END), 0)
               + COALESCE((
                 SELECT SUM(CASE WHEN tr.source_account_id = a.account_id THEN -tr.amount ELSE tr.amount END)
                 FROM finance.account_transfer tr
                 WHERE tr.household_id = a.household_id AND tr.member_id = $2
                   AND tr.tx_date <= CURRENT_DATE
                   AND (tr.source_account_id = a.account_id OR tr.destination_account_id = a.account_id)
               ), 0))::text AS balance
           FROM finance.account a
           LEFT JOIN finance.transactions t ON t.household_id = a.household_id AND t.account_id = a.account_id
             AND t.member_id = $2 AND t.type IN ('income', 'expense') AND t.tx_date <= CURRENT_DATE
           WHERE a.household_id = $1 AND a.is_active AND a.currency = 'CLP'
             AND (a.member_id IS NULL OR a.member_id = $2)
           GROUP BY a.account_id, a.household_id, a.name, a.opening_balance
           ORDER BY a.name, a.account_id`,
          [member.household_id, member.member_id],
        );
        const categories = await pool.query(
          "SELECT category_id AS id, name FROM finance.category WHERE household_id = $1 AND kind = 'expense' ORDER BY name, category_id",
          [member.household_id],
        );
        const incomeCategories = await pool.query(
          "SELECT category_id AS id, name FROM finance.category WHERE household_id = $1 AND kind = 'income' ORDER BY name, category_id",
          [member.household_id],
        );
        sendJson(response, 200, {
          household: member.name, accounts: accounts.rows, categories: categories.rows, incomeCategories: incomeCategories.rows,
        });
        return;
      }

      if (url.pathname === "/api/movimientos") {
        const month = url.searchParams.get("mes");
        if (!validMonth(month) || url.searchParams.getAll("mes").length !== 1) {
          sendJson(response, 400, { error: "Selecciona un mes válido." });
          return;
        }
        const member = await personalMember(pool, householdId);
        if (!member) {
          sendJson(response, 409, { error: "Configura un hogar personal en CLP con un único integrante activo." });
          return;
        }
        const result = await pool.query(
          `SELECT COALESCE(json_agg(movement ORDER BY sort_date DESC, sort_id DESC), '[]'::json) AS movements,
                  COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0)::text AS "incomeTotal"
           FROM (
             SELECT json_build_object(
               'id', 'transaction-' || t.transaction_id::text,
               'date', to_char(t.tx_date, 'YYYY-MM-DD'),
               'type', t.type,
               'description', COALESCE(NULLIF(BTRIM(t.merchant), ''), NULLIF(BTRIM(t.note), ''), 'Sin descripción'),
               'amount', t.amount::text,
               'category', c.name,
               'account', a.name
             ) AS movement, t.tx_date AS sort_date, t.transaction_id AS sort_id, t.type, t.amount
             FROM finance.transactions t
             JOIN finance.account a ON a.account_id = t.account_id AND a.household_id = t.household_id
             LEFT JOIN finance.category c ON c.category_id = t.category_id AND c.household_id = t.household_id
             WHERE t.household_id = $1 AND t.member_id = $2 AND t.type IN ('income', 'expense')
               AND t.tx_date >= ($3 || '-01')::date AND t.tx_date < (($3 || '-01')::date + interval '1 month')
             UNION ALL
             SELECT json_build_object(
               'id', 'transfer-' || tr.transfer_id::text,
               'date', to_char(tr.tx_date, 'YYYY-MM-DD'),
               'type', 'transfer',
               'description', COALESCE(NULLIF(BTRIM(tr.note), ''), 'Transferencia'),
               'amount', tr.amount::text,
               'category', NULL,
               'account', source.name,
               'destinationAccount', destination.name
             ) AS movement, tr.tx_date AS sort_date, tr.transfer_id AS sort_id, 'transfer'::text AS type, tr.amount
             FROM finance.account_transfer tr
             JOIN finance.account source ON source.account_id = tr.source_account_id AND source.household_id = tr.household_id
             JOIN finance.account destination ON destination.account_id = tr.destination_account_id AND destination.household_id = tr.household_id
             WHERE tr.household_id = $1 AND tr.member_id = $2
               AND tr.tx_date >= ($3 || '-01')::date AND tr.tx_date < (($3 || '-01')::date + interval '1 month')
           ) entries`,
          [member.household_id, member.member_id, month],
        );
        sendJson(response, 200, { month, ...result.rows[0] });
        return;
      }

      if (url.pathname === "/api/presupuestos") {
        const month = url.searchParams.get("mes");
        if (!validMonth(month) || url.searchParams.getAll("mes").length !== 1) {
          sendJson(response, 400, { error: "Selecciona un mes válido." });
          return;
        }
        const member = await personalMember(pool, householdId);
        if (!member) {
          sendJson(response, 409, { error: "Configura un hogar personal en CLP con un único integrante activo." });
          return;
        }
        const result = await pool.query(
          `WITH spent AS (
             SELECT t.category_id, SUM(t.amount) AS amount
             FROM finance.transactions t
             JOIN finance.account a ON a.account_id = t.account_id
               AND a.household_id = t.household_id AND a.currency = 'CLP'
             WHERE t.household_id = $1 AND t.member_id = $2 AND t.type = 'expense'
               AND t.tx_date >= ($3 || '-01')::date
               AND t.tx_date < (($3 || '-01')::date + interval '1 month')
             GROUP BY t.category_id
           )
           SELECT c.category_id AS "categoryId", c.name AS category, b.amount::text AS budget,
                  COALESCE(s.amount, 0)::text AS spent,
                  ABS(b.amount - COALESCE(s.amount, 0))::text AS difference,
                  b.amount < COALESCE(s.amount, 0) AS exceeded
           FROM finance.category c
           LEFT JOIN finance.budget b ON b.household_id = c.household_id AND b.member_id = $2
             AND b.category_id = c.category_id AND b.month_start = ($3 || '-01')::date
           LEFT JOIN spent s ON s.category_id = c.category_id
           WHERE c.household_id = $1 AND c.kind = 'expense'
           ORDER BY c.name, c.category_id`,
          [member.household_id, member.member_id, month],
        );
        sendJson(response, 200, { month, categories: result.rows });
        return;
      }

      if (url.pathname === "/api/gastos") {
        const month = url.searchParams.get("mes");
        if (!validMonth(month) || url.searchParams.getAll("mes").length !== 1) {
          sendJson(response, 400, { error: "Selecciona un mes válido." });
          return;
        }
        const mode = url.searchParams.get("vista") ?? "demo";
        if (!["demo", "personal"].includes(mode) || url.searchParams.getAll("vista").length > 1) {
          sendJson(response, 400, { error: "Selecciona una vista válida." });
          return;
        }
        let selectedHousehold;
        let selectedMember = null;
        if (mode === "personal") {
          const member = await personalMember(pool, householdId);
          if (!member) {
            sendJson(response, 409, { error: "Configura un hogar personal en CLP con un único integrante activo." });
            return;
          }
          selectedHousehold = member.household_id;
          selectedMember = member.member_id;
        } else {
          const households = await pool.query(
            "SELECT household_id FROM finance.household WHERE name = $1",
            ["[DEMO] Hogar de prueba"],
          );
          if (households.rows.length !== 1) {
            sendJson(response, 409, { error: "Debe existir exactamente un hogar de prueba. Revisa la carga de datos ficticios." });
            return;
          }
          selectedHousehold = households.rows[0].household_id;
        }

        const result = await pool.query(
          `WITH filtered AS (
             SELECT t.transaction_id, t.tx_date, t.amount, t.merchant, t.note,
                    t.member_id, t.account_id, t.category_id AS transaction_category_id,
                    c.category_id, c.name AS category
             FROM finance.transactions t
             LEFT JOIN finance.category c
               ON c.category_id = t.category_id AND c.household_id = t.household_id
             WHERE t.household_id = $1 AND t.type = 'expense'
               AND t.tx_date >= ($2 || '-01')::date
               AND t.tx_date < (($2 || '-01')::date + interval '1 month')
           ), category_totals AS (
             SELECT category_id, category, SUM(amount) AS amount, COUNT(*)::int AS count
             FROM filtered GROUP BY category_id, category
           ), total AS (
             SELECT COALESCE(SUM(amount), 0) AS amount FROM filtered
           )
           SELECT total.amount::text AS total,
             COALESCE((SELECT json_agg(json_build_object(
               'category', COALESCE(category, 'Sin categoría'),
               'total', amount::text, 'count', count, 'grand_total', total.amount::text
             ) ORDER BY amount DESC, category) FROM category_totals), '[]'::json) AS categories,
             COALESCE((SELECT json_agg(json_build_object(
               'id', transaction_id::text, 'accountId', account_id, 'categoryId', transaction_category_id,
               'editable', member_id = $3::integer,
               'date', to_char(tx_date, 'YYYY-MM-DD'),
               'merchant', merchant,
               'description', COALESCE(NULLIF(BTRIM(merchant), ''), NULLIF(BTRIM(note), ''), 'Sin descripción'),
               'category', COALESCE(category, 'Sin categoría'), 'amount', amount::text
             ) ORDER BY tx_date DESC, transaction_id DESC) FROM filtered), '[]'::json) AS expenses
           FROM total`,
          [selectedHousehold, month, selectedMember],
        );
        sendJson(response, 200, { month, ...result.rows[0] });
        return;
      }

      const file = files[url.pathname];
      if (!file) {
        response.writeHead(404);
        response.end("No encontrado");
        return;
      }
      const contents = await readFile(new URL(file[0], import.meta.url));
      response.writeHead(200, { "Content-Type": file[1] });
      response.end(contents);
    } catch (error) {
      console.error("Error al atender la solicitud:", error);
      if (!response.headersSent) sendJson(response, 500, { error: "No se pudo completar la solicitud. Revisa la conexión y el servidor." });
      else response.destroy();
    }
  });
}
