import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { createDashboardServer } from "../server.js";

async function listen(t, server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

async function startServer(t, pool, options = {}) {
  const server = createDashboardServer(pool, {
    authenticate: async () => ({ userId: 1, email: "test@example.com", householdId: options.householdId ?? null }),
  });
  return listen(t, server);
}

async function startSessionServer(t, pool) {
  return listen(t, createDashboardServer(pool));
}

test("requiere una sesión para consultar datos personales", async (t) => {
  const url = await startSessionServer(t, { query() { throw new Error("No debe consultar la base"); } });
  const session = await fetch(`${url}/api/auth/session`);
  assert.deepEqual(await session.json(), { user: null });
  assert.equal((await fetch(`${url}/api/gastos?mes=2026-11`)).status, 401);
});

test("crea una cuenta con perfil propio y emite una sesión HttpOnly", async (t) => {
  const statements = [];
  let storedPasswordHash;
  const client = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql.includes("INSERT INTO finance.app_user")) {
        storedPasswordHash = params[1];
        return { rows: [{ user_id: 24 }] };
      }
      if (sql.includes("INSERT INTO finance.household")) return { rows: [{ household_id: 42 }] };
      if (sql.includes("INSERT INTO finance.member")) return { rows: [{ member_id: 9 }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() { return client; },
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql.includes("FROM finance.app_session")) {
        return { rows: [{ userId: 24, email: "persona@example.com", householdId: 42 }] };
      }
      return { rows: [] };
    },
  };
  const url = await startSessionServer(t, pool);
  const response = await fetch(`${url}/api/auth/register`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ email: " Persona@Example.com ", password: "correct horse battery" }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { user: { email: "persona@example.com" } });
  assert.notEqual(storedPasswordHash, "correct horse battery");
  assert.match(storedPasswordHash, /^scrypt\$/);
  assert.ok(statements.some(({ sql, params }) => sql.includes("owner_user_id") && params[0] === 24));
  assert.ok(statements.some(({ sql }) => sql.includes("INSERT INTO finance.account")));
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);

  const session = await fetch(`${url}/api/auth/session`, { headers: { Cookie: cookie.split(";")[0] } });
  assert.deepEqual(await session.json(), { user: { email: "persona@example.com" } });
  assert.match(statements.find(({ sql }) => sql.includes("FROM finance.app_session")).sql, /h\.owner_user_id = u\.user_id/);
});

test("autentica y cierra sesión sin exponer si un correo está registrado", async (t) => {
  const salt = Buffer.alloc(16, 1).toString("hex");
  const passwordHash = `scrypt$${salt}$${scryptSync("correct horse battery", Buffer.from(salt, "hex"), 64).toString("hex")}`;
  const statements = [];
  const pool = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql.includes("password_hash")) {
        return { rows: [{
          userId: 24, email: "persona@example.com", passwordHash, householdId: 42,
        }] };
      }
      return { rows: [] };
    },
  };
  const url = await startSessionServer(t, pool);
  const login = async (email, password) => fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal((await login("persona@example.com", "incorrect password")).status, 401);
  assert.equal((await login("unknown@example.com", "incorrect password")).status, 401);
  assert.deepEqual(await (await login("persona@example.com", "correct horse battery")).json(), {
    user: { email: "persona@example.com" },
  });
  const cookie = statements.find(({ sql }) => sql.includes("INSERT INTO finance.app_session")).params[0];
  assert.match(cookie, /^[a-f\d]{64}$/);

  const logout = await fetch(`${url}/api/auth/logout`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json", Cookie: `finance_session=${"a".repeat(64)}` },
    body: "{}",
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.ok(statements.some(({ sql }) => sql.includes("DELETE FROM finance.app_session")));
});

test("valida el registro y bloquea solicitudes de autenticación de otros orígenes", async (t) => {
  let connections = 0;
  const url = await startSessionServer(t, {
    async connect() { connections += 1; throw new Error("No debe conectar"); },
  });
  const register = (body, origin = url) => fetch(`${url}/api/auth/register`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal((await register({ email: "user@example.com", password: "long enough password" }, "https://otro-sitio.example")).status, 403);
  assert.equal((await register({ email: "no-es-email", password: "long enough password" })).status, 400);
  assert.equal((await register({ email: "user@example.com", password: "short" })).status, 400);
  assert.equal(connections, 0);
});

test("consulta solo los gastos personales y el mes seleccionado", async (t) => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (queries.length === 1) return { rows: [{ household_id: 42, member_id: 3 }] };
      return { rows: [{
        total: "123.50",
        categories: [{ category: "Hogar", total: "123.50", count: 2, grand_total: "123.50" }],
        expenses: [{ date: "2026-11-02", description: "Compra", category: "Hogar", amount: "123.50" }],
      }] };
    },
  };
  const url = await startServer(t, pool, { householdId: 42 });
  const response = await fetch(`${url}/api/gastos?mes=2026-11&vista=demo`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    month: "2026-11",
    total: "123.50",
    categories: [{ category: "Hogar", total: "123.50", count: 2, grand_total: "123.50" }],
    expenses: [{ date: "2026-11-02", description: "Compra", category: "Hogar", amount: "123.50" }],
  });
  assert.deepEqual(queries[0].params, [42, "[DEMO] Hogar de prueba"]);
  assert.deepEqual(queries[1].params, [42, "2026-11", 3]);
});

test("la página ofrece una única vista de finanzas personales", async (t) => {
  const url = await startServer(t, { query() { throw new Error("No debe consultar la base"); } });
  const response = await fetch(url);
  const page = await response.text();
  assert.equal(response.status, 200);
  assert.match(page, /id="login-form"/);
  assert.match(page, /id="register-form"/);
  assert.match(page, /REGISTRO PERSONAL/);
  assert.doesNotMatch(page, /id="view"|Hogar personal|Datos de prueba/);
});

test("rechaza meses inválidos y métodos de escritura antes de consultar la base", async (t) => {
  const url = await startServer(t, { query() { throw new Error("No debe consultar la base"); } });
  for (const month of ["2026-13", "2026-1", "1899-12", "2026-11&mes=2026-10"]) {
    assert.equal((await fetch(`${url}/api/gastos?mes=${month}`)).status, 400);
  }
  assert.equal((await fetch(`${url}/api/gastos?mes=2026-11`, { method: "PATCH" })).status, 405);
});

test("registra un gasto válido solo en el hogar y miembro configurados", async (t) => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (queries.length === 1) return { rows: [{ household_id: 7, member_id: 3 }] };
      return { rows: [{ transaction_id: "1" }] };
    },
  };
  const url = await startServer(t, pool, { householdId: 7 });
  const response = await fetch(`${url}/api/gastos`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ merchant: " Café ", amount: "1500", date: "2024-02-29", accountId: 4, categoryId: 5 }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(queries[0].params, [7, "[DEMO] Hogar de prueba"]);
  assert.deepEqual(queries[1].params, [7, 3, 4, 5, "2024-02-29", "1500", "Café"]);
  assert.match(queries[1].sql, /a\.household_id = h\.household_id/);
  assert.match(queries[1].sql, /c\.household_id = h\.household_id/);
});

test("actualiza solo el gasto personal solicitado y conserva su ID exacto", async (t) => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ transaction_id: "9007199254740993" }] };
    },
  };
  const url = await startServer(t, pool, { householdId: 7 });
  const response = await fetch(`${url}/api/gastos`, {
    method: "PUT",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "9007199254740993", merchant: " Café ", amount: "1500", date: "2024-02-29", accountId: 4, categoryId: 5 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(queries[1].params, [7, 3, 4, 5, "2024-02-29", "1500", "Café", "9007199254740993"]);
});

test("rechaza edición con ID inválido u origen ajeno", async (t) => {
  const url = await startServer(t, { query() { throw new Error("No debe consultar la base"); } }, { householdId: 7 });
  const valid = { id: "1", merchant: "Compra", amount: "1500", date: "2024-02-29", accountId: 4, categoryId: 5 };
  const put = (body, origin = url) => fetch(`${url}/api/gastos`, {
    method: "PUT", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await put(valid, "https://otro-sitio.example")).status, 403);
  for (const id of ["0", "1.5", "9223372036854775808", 1, null]) {
    assert.equal((await put({ ...valid, id })).status, 400);
  }
});

test("informa cuando el gasto no puede editarse en el hogar personal", async (t) => {
  let call = 0;
  const url = await startServer(t, {
    async query() {
      call += 1;
      return { rows: call === 1 ? [{ household_id: 7, member_id: 3 }] : [] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/gastos`, {
    method: "PUT",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "20", merchant: "Compra", amount: "1500", date: "2026-01-02", accountId: 4, categoryId: 5 }),
  });
  assert.equal(response.status, 400);
});

test("elimina únicamente el gasto personal solicitado", async (t) => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ transaction_id: "9007199254740993" }] };
    },
  };
  const url = await startServer(t, pool, { householdId: 7 });
  const response = await fetch(`${url}/api/gastos`, {
    method: "DELETE",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "9007199254740993" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: "Gasto eliminado correctamente." });
  assert.deepEqual(queries[1].params, [7, 3, "9007199254740993"]);
});

test("rechaza eliminación con ID inválido u origen ajeno", async (t) => {
  const url = await startServer(t, { query() { throw new Error("No debe consultar la base"); } }, { householdId: 7 });
  const remove = (body, origin = url) => fetch(`${url}/api/gastos`, {
    method: "DELETE", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await remove({ id: "1" }, "https://otro-sitio.example")).status, 403);
  for (const body of [null, {}, { id: 1 }, { id: "0" }, { id: "9223372036854775808" }]) {
    assert.equal((await remove(body)).status, 400);
  }
});

test("informa si el gasto no existe o no pertenece al integrante", async (t) => {
  let call = 0;
  const url = await startServer(t, {
    async query() {
      call += 1;
      return { rows: call === 1 ? [{ household_id: 7, member_id: 3 }] : [] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/gastos`, {
    method: "DELETE",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "20" }),
  });
  assert.equal(response.status, 404);
});

test("rechaza datos inválidos y solicitudes externas sin guardar gastos", async (t) => {
  const url = await startServer(t, { query() { throw new Error("No debe consultar la base"); } }, { householdId: 7 });
  const valid = { merchant: "Compra", amount: "1500", date: "2024-02-29", accountId: 4, categoryId: 5 };
  const post = (body, origin = url) => fetch(`${url}/api/gastos`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await post(valid, "https://otro-sitio.example")).status, 403);
  for (const change of [
    { merchant: " " }, { amount: "0" }, { amount: "1.5" }, { amount: "1000000000000" },
    { date: "2023-02-29" }, { accountId: -1 }, { categoryId: 1.5 },
  ]) assert.equal((await post({ ...valid, ...change })).status, 400);
});

test("rechaza una cuenta o categoría ajena al hogar personal", async (t) => {
  let call = 0;
  const url = await startServer(t, {
    async query() {
      call += 1;
      return { rows: call === 1 ? [{ household_id: 7, member_id: 3 }] : [] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/gastos`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ merchant: "Compra", amount: "1500", date: "2026-01-02", accountId: 4, categoryId: 5 }),
  });
  assert.equal(response.status, 400);
});

test("no permite registrar sin un único integrante personal activo", async (t) => {
  for (const members of [[], [{ member_id: 1 }, { member_id: 2 }]]) {
    const url = await startServer(t, { async query() { return { rows: members }; } }, { householdId: 7 });
    const response = await fetch(`${url}/api/gastos`, {
      method: "POST",
      headers: { Origin: url, "Content-Type": "application/json" },
      body: JSON.stringify({ merchant: "Compra", amount: "1500", date: "2026-01-02", accountId: 4, categoryId: 5 }),
    });
    assert.equal(response.status, 409);
  }
});

test("no muestra datos de prueba cuando falta una configuración personal", async (t) => {
  let queries = 0;
  const url = await startServer(t, { async query() { queries += 1; return { rows: [] }; } });
  const response = await fetch(`${url}/api/gastos?mes=2026-11`);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /configuración personal/);
  assert.equal(queries, 0);
});

test("un mes sin gastos devuelve total cero", async (t) => {
  let call = 0;
  const url = await startServer(t, {
    async query() {
      call += 1;
      return { rows: call === 1
        ? [{ household_id: 42, member_id: 3 }]
        : [{ total: "0", categories: [], expenses: [] }] };
    },
  }, { householdId: 42 });
  const response = await fetch(`${url}/api/gastos?mes=2025-01`);
  assert.deepEqual(await response.json(), { month: "2025-01", total: "0", categories: [], expenses: [] });
});

test("consulta presupuestos y gastos personales del mes sin convertir importes", async (t) => {
  const queries = [];
  const categories = [
    { categoryId: 5, category: "Hogar", budget: "0.00", spent: "0.50", difference: "0.50", exceeded: true },
    { categoryId: 6, category: "Ocio", budget: null, spent: "5.00", difference: null, exceeded: null },
  ];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: queries.length === 1 ? [{ household_id: 7, member_id: 3 }] : categories };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/presupuestos?mes=2026-11`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { month: "2026-11", categories });
  assert.deepEqual(queries[1].params, [7, 3, "2026-11"]);
});

test("consulta reporte personal del período con meses vacíos y gastos por categoría", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{
          monthly: [
            { month: "2026-06", total: "0", count: 0 },
            { month: "2026-07", total: "120.50", count: 2 },
          ],
          categories: [{ category: "Supermercado", total: "120.50", count: 2 }],
          total: "120.50",
          average: "60.25",
        }] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/reportes?mes=2026-07&meses=3`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    month: "2026-07",
    months: 3,
    monthly: [
      { month: "2026-06", total: "0", count: 0 },
      { month: "2026-07", total: "120.50", count: 2 },
    ],
    categories: [{ category: "Supermercado", total: "120.50", count: 2 }],
    total: "120.50",
    average: "60.25",
  });
  assert.deepEqual(queries[1].params, [7, 3, "2026-07", "3"]);
  assert.match(queries[1].sql, /generate_series/);
  assert.match(queries[1].sql, /t\.member_id = \$2/);
  assert.match(queries[1].sql, /a\.currency = 'CLP'/);
});

test("rechaza períodos inválidos y hogares personales no configurados en reportes", async (t) => {
  const url = await startServer(t, { query() { throw new Error("No debe consultar la base"); } }, { householdId: 7 });
  for (const query of [
    "mes=2026-13&meses=6",
    "mes=2026-11&meses=4",
    "mes=2026-11&meses=3&meses=6",
    "mes=2026-11&mes=2026-10&meses=6",
  ]) {
    assert.equal((await fetch(`${url}/api/reportes?${query}`)).status, 400);
  }

  const noMemberUrl = await startServer(t, { async query() { return { rows: [] }; } }, { householdId: 7 });
  const response = await fetch(`${noMemberUrl}/api/reportes?mes=2026-11&meses=6`);
  assert.equal(response.status, 409);
});

test("crea un límite cero y actualiza con el monto previamente consultado", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: queries.length % 2 ? [{ household_id: 7, member_id: 3 }] : [{ budget_id: 1 }] };
    },
  }, { householdId: 7 });
  const write = (method, body) => fetch(`${url}/api/presupuestos`, {
    method, headers: { Origin: url, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const budget = { month: "2026-11", categoryId: 5, amount: "0" };
  assert.equal((await write("POST", budget)).status, 201);
  assert.deepEqual(queries[1].params, [7, 3, 5, "2026-11", "0"]);
  assert.equal((await write("PUT", { ...budget, amount: "50", expectedAmount: "0.50" })).status, 200);
  assert.deepEqual(queries[3].params, [7, 3, 5, "2026-11", "50", "0.50"]);
});

test("rechaza datos de presupuesto inválidos, origen ajeno y meses ambiguos", async (t) => {
  const url = await startServer(t, { query() { throw new Error("No debe consultar la base"); } }, { householdId: 7 });
  const valid = { month: "2026-11", categoryId: 5, amount: "100" };
  const write = (method, body, origin = url) => fetch(`${url}/api/presupuestos`, {
    method, headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await write("POST", valid, "https://otro-sitio.example")).status, 403);
  for (const change of [
    { month: "2026-13" }, { categoryId: 0 }, { categoryId: 1.5 },
    { amount: "-1" }, { amount: "1.5" }, { amount: "1000000000000" }, { amount: 0 },
  ]) assert.equal((await write("POST", { ...valid, ...change })).status, 400);
  assert.equal((await write("PUT", valid)).status, 400);
  assert.equal((await fetch(`${url}/api/presupuestos?mes=2026-11&mes=2026-10`)).status, 400);
});

test("no sobrescribe presupuestos existentes o cambiados y exige hogar personal", async (t) => {
  let call = 0;
  const url = await startServer(t, {
    async query() {
      call += 1;
      return { rows: call % 2 ? [{ household_id: 7, member_id: 3 }] : [] };
    },
  }, { householdId: 7 });
  const write = (method, body) => fetch(`${url}/api/presupuestos`, {
    method, headers: { Origin: url, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const budget = { month: "2026-11", categoryId: 5, amount: "100" };
  assert.equal((await write("POST", budget)).status, 409);
  assert.equal((await write("PUT", { ...budget, expectedAmount: "50.00" })).status, 409);
  const noMember = await startServer(t, { async query() { return { rows: [] }; } }, { householdId: 7 });
  assert.equal((await fetch(`${noMember}/api/presupuestos?mes=2026-11`)).status, 409);
});

test("registra ingresos solo con cuenta y categoría del hogar personal", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ transaction_id: "12" }] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/ingresos`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({
      merchant: " Sueldo ", amount: "1500000", date: "2026-11-15", accountId: 4, categoryId: 6,
    }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(queries[1].params, [7, 3, 4, 6, "2026-11-15", "1500000", "Sueldo"]);
  assert.match(queries[1].sql, /c\.kind = 'income'/);
  assert.match(queries[1].sql, /'income'/);
});

test("registra transferencias entre cuentas distintas y del mismo hogar", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ transfer_id: "15" }] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/transferencias`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: "50000.25", date: "2026-11-15", sourceAccountId: 4, destinationAccountId: 8, note: " Ahorro ",
    }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(queries[1].params, [7, 3, 4, 8, "2026-11-15", "50000.25", "Ahorro"]);
  assert.match(queries[1].sql, /src\.currency = 'CLP'/);
  assert.match(queries[1].sql, /src\.account_id <> dst\.account_id/);
});

test("edita ingresos y transferencias personales conservando su identificador", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length % 2
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ id: "9007199254740993" }] };
    },
  }, { householdId: 7 });
  const cases = [
    ["/api/ingresos", { id: "9007199254740993", merchant: " Sueldo ", amount: "1500", date: "2026-11-15", accountId: 4, categoryId: 6 },
      [7, 3, 4, 6, "2026-11-15", "1500", "Sueldo", "9007199254740993"], /t\.type = 'income'/],
    ["/api/transferencias", { id: "9007199254740993", amount: "0.25", date: "2026-11-16", sourceAccountId: 4, destinationAccountId: 8, note: " Ahorro " },
      [7, 3, 4, 8, "2026-11-16", "0.25", "Ahorro", "9007199254740993"], /tr\.member_id = m\.member_id/],
  ];
  for (const [path, body, parameters, constraint] of cases) {
    const response = await fetch(`${url}${path}`, {
      method: "PUT", headers: { Origin: url, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    const query = queries.at(-1);
    assert.deepEqual(query.params, parameters);
    assert.match(query.sql, constraint);
    assert.match(query.sql, /household_id = h\.household_id/);
  }
});

test("valida ediciones y rechaza movimientos o cuentas no disponibles", async (t) => {
  const url = await startServer(t, {
    async query(sql) {
      return { rows: sql.includes("SELECT h.household_id, h.name, m.member_id")
        ? [{ household_id: 7, member_id: 3 }] : [] };
    },
  }, { householdId: 7 });
  const income = { id: "1", merchant: "Sueldo", amount: "1500", date: "2026-11-15", accountId: 4, categoryId: 6 };
  const transfer = { id: "1", amount: "50.25", date: "2026-11-16", sourceAccountId: 4, destinationAccountId: 8 };
  const put = (path, body, origin = url) => fetch(`${url}${path}`, {
    method: "PUT", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  for (const [path, body] of [["/api/ingresos", income], ["/api/transferencias", transfer]]) {
    assert.equal((await put(path, body, "https://otro-sitio.example")).status, 403);
    for (const id of [1, "0", "9223372036854775808"]) {
      assert.equal((await put(path, { ...body, id })).status, 400);
    }
    assert.equal((await put(path, body)).status, 400);
  }
  assert.equal((await put("/api/ingresos", { ...income, amount: "1.25" })).status, 400);
  assert.equal((await put("/api/transferencias", { ...transfer, destinationAccountId: 4 })).status, 400);
  assert.equal((await put("/api/transferencias", { ...transfer, amount: "0.00" })).status, 400);
});

test("rechaza transferencias a la misma cuenta y solicitudes externas", async (t) => {
  const url = await startServer(t, { query() { throw new Error("No debe consultar la base"); } }, { householdId: 7 });
  const transfer = (body, origin = url) => fetch(`${url}/api/transferencias`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const valid = {
    amount: "100", date: "2026-11-15", sourceAccountId: 4, destinationAccountId: 8,
  };
  assert.equal((await transfer(valid, "https://otro-sitio.example")).status, 403);
  assert.equal((await transfer({ ...valid, destinationAccountId: 4 })).status, 400);
  assert.equal((await transfer({ ...valid, amount: "0" })).status, 400);
});

test("actualiza saldo inicial con control de concurrencia", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ account_id: 4 }] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/cuentas/saldo-inicial`, {
    method: "PUT",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: 4, amount: "250000.50", expectedAmount: "0.00" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(queries[1].params, [7, 3, 4, "250000.50", "0.00"]);
  assert.match(queries[1].sql, /a\.opening_balance = \$5::numeric/);
});

test("lista ingresos y transferencias del mes con saldo de ingresos", async (t) => {
  const queries = [];
  const rows = [{
    month: "2026-11",
    incomeTotal: "1500000.00",
    movements: [
      { id: "transaction-12", type: "income", amount: "1500000.00" },
      { id: "transfer-15", type: "transfer", amount: "50000.00" },
    ],
  }];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: queries.length === 1 ? [{ household_id: 7, member_id: 3 }] : rows };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/movimientos?mes=2026-11`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { month: "2026-11", ...rows[0] });
  assert.deepEqual(queries[1].params, [7, 3, "2026-11"]);
});

test("devuelve saldos de cuenta calculados con saldo inicial y transferencias", async (t) => {
  const queries = [];
  const data = {
    household: "Yo",
    accounts: [{ id: 4, name: "Cuenta corriente", openingBalance: "1000.00", balance: "800.00" }],
    categories: [{ id: 5, name: "Hogar" }],
    incomeCategories: [{ id: 6, name: "Sueldo" }],
  };
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      if (queries.length === 1) return { rows: [{ household_id: 7, member_id: 3, name: "Yo" }] };
      return { rows: [queries.length === 2 ? data.accounts[0] : queries.length === 3 ? data.categories[0] : data.incomeCategories[0]] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/opciones`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), data);
  assert.deepEqual(queries[1].params, [7, 3]);
  assert.match(queries[1].sql, /a\.opening_balance/);
  assert.match(queries[1].sql, /finance\.account_transfer/);
  assert.match(queries[1].sql, /t\.tx_date <= CURRENT_DATE/);
});

test("elimina ingresos y transferencias solo del integrante personal", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length % 2
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ id: "15" }] };
    },
  }, { householdId: 7 });
  for (const [path, index, sql] of [
    ["/api/transferencias", 1, /DELETE FROM finance\.account_transfer/],
    ["/api/ingresos", 3, /t\.type = 'income'/],
  ]) {
    const response = await fetch(`${url}${path}`, {
      method: "DELETE",
      headers: { Origin: url, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "15" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(queries[index].params, [7, 3, "15"]);
    assert.match(queries[index].sql, sql);
  }
});

test("consulta metas, progreso y aportes solo del perfil personal", async (t) => {
  const queries = [];
  const goals = [{
    id: 8,
    name: "Viaje",
    targetAmount: "500000.00",
    dueDate: "2027-01-01",
    saved: "125000.00",
    contributions: [{ id: "19", date: "2026-11-15", amount: "125000.00", note: "Primer aporte", editable: true }],
  }];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: goals };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/metas`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { goals });
  assert.deepEqual(queries[1].params, [7, 3]);
  assert.match(queries[1].sql, /SUM\(sc\.amount\)/);
  assert.match(queries[1].sql, /sc\.household_id = g\.household_id/);
});

test("crea una meta con fecha opcional y valida sus datos", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ goal_id: 8 }] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/metas`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "  Viaje  ", targetAmount: "500000", dueDate: null }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(queries[1].params, [7, "Viaje", "500000", null, 3]);

  const invalidUrl = await startServer(t, { query() { throw new Error("No debe consultar la base"); } }, { householdId: 7 });
  for (const body of [
    { name: " ", targetAmount: "1000", dueDate: null },
    { name: "Meta", targetAmount: "0", dueDate: null },
    { name: "Meta", targetAmount: "1.5", dueDate: null },
    { name: "Meta", targetAmount: "1000", dueDate: "2026-02-30" },
  ]) {
    const invalid = await fetch(`${invalidUrl}/api/metas`, {
      method: "POST",
      headers: { Origin: invalidUrl, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(invalid.status, 400);
  }
});

test("registra aportes únicamente en metas del perfil personal", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ contribution_id: "19" }] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/metas/aportes`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ goalId: 8, amount: "25000", date: "2026-11-15", note: " Aporte mensual " }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(queries[1].params, [7, 3, 8, "2026-11-15", "25000", "Aporte mensual"]);
  assert.match(queries[1].sql, /g\.household_id = h\.household_id/);

  const invalidUrl = await startServer(t, { query() { throw new Error("No debe consultar la base"); } }, { householdId: 7 });
  for (const body of [
    { goalId: 0, amount: "1000", date: "2026-11-15" },
    { goalId: 8, amount: "0", date: "2026-11-15" },
    { goalId: 8, amount: "1.5", date: "2026-11-15" },
    { goalId: 8, amount: "1000", date: "2026-02-30" },
  ]) {
    const invalid = await fetch(`${invalidUrl}/api/metas/aportes`, {
      method: "POST",
      headers: { Origin: invalidUrl, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(invalid.status, 400);
  }
});

test("elimina únicamente aportes creados por la persona personal", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ contribution_id: "19" }] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/metas/aportes`, {
    method: "DELETE",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "19" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(queries[1].params, [7, 3, "19"]);
  assert.match(queries[1].sql, /sc\.member_id = m\.member_id/);
});

test("consulta categorías personales activas y archivadas", async (t) => {
  const queries = [];
  const categories = [
    { id: 2, name: "Mascotas", active: true },
    { id: 5, name: "Viajes", active: false },
  ];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length === 1
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: categories };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/categorias`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { categories });
  assert.deepEqual(queries[1].params, [7]);
  assert.match(queries[1].sql, /is_active AS active/);
  assert.match(queries[1].sql, /kind = 'expense'/);
});

test("crea, renombra, archiva y restaura categorías personales", async (t) => {
  const queries = [];
  const url = await startServer(t, {
    async query(sql, params) {
      queries.push({ sql, params });
      return queries.length % 2
        ? { rows: [{ household_id: 7, member_id: 3 }] }
        : { rows: [{ category_id: 8 }] };
    },
  }, { householdId: 7 });
  const write = (method, body) => fetch(`${url}/api/categorias`, {
    method,
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  assert.equal((await write("POST", { name: " Mascotas " })).status, 201);
  assert.deepEqual(queries[1].params, [7, "Mascotas", 3]);
  assert.match(queries[1].sql, /ON CONFLICT \(household_id, name\) DO NOTHING/);

  assert.equal((await write("PUT", { id: 8, name: "Animales" })).status, 200);
  assert.deepEqual(queries[3].params, [7, 8, "Animales", 3]);
  assert.match(queries[3].sql, /NOT EXISTS/);

  assert.equal((await write("PATCH", { id: 8, active: false })).status, 200);
  assert.deepEqual(queries[5].params, [7, 8, false, 3]);
  assert.match(queries[5].sql, /SET is_active = \$3/);

  assert.equal((await write("PATCH", { id: 8, active: true })).status, 200);
  assert.deepEqual(queries[7].params, [7, 8, true, 3]);
});

test("valida escrituras de categorías y rechaza solicitudes de otros orígenes", async (t) => {
  const url = await startServer(t, { query() { throw new Error("No debe consultar la base"); } }, { householdId: 7 });
  const write = (method, body, origin = url) => fetch(`${url}/api/categorias`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal((await write("POST", { name: "Mascotas" }, "https://otro-sitio.example")).status, 403);
  for (const body of [null, {}, { name: " " }, { name: "a".repeat(101) }]) {
    assert.equal((await write("POST", body)).status, 400);
  }
  for (const body of [{ id: 0, name: "Gastos" }, { id: 1.5, name: "Gastos" }, { id: 1, name: " " }]) {
    assert.equal((await write("PUT", body)).status, 400);
  }
  for (const body of [{ id: "1", active: false }, { id: 1 }, { id: 1, active: "false" }]) {
    assert.equal((await write("PATCH", body)).status, 400);
  }
});

test("rechaza categorías duplicadas y limita sus cambios al hogar personal", async (t) => {
  let call = 0;
  const url = await startServer(t, {
    async query() {
      call += 1;
      return { rows: call % 2 ? [{ household_id: 7, member_id: 3 }] : [] };
    },
  }, { householdId: 7 });
  const response = await fetch(`${url}/api/categorias`, {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Mascotas" }),
  });
  assert.equal(response.status, 409);

  const noMember = await startServer(t, { async query() { return { rows: [] }; }, }, { householdId: 7 });
  const unavailable = await fetch(`${noMember}/api/categorias`);
  assert.equal(unavailable.status, 409);
});
