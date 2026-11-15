import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createDashboardServer } from "../server.js";

async function startServer(t, pool, options) {
  const server = createDashboardServer(pool, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

test("consulta solo el hogar de prueba y el mes seleccionado", async (t) => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (queries.length === 1) return { rows: [{ household_id: 42 }] };
      return { rows: [{ category: "Hogar", total: "123.50", count: 2, grand_total: "123.50" }] };
    },
  };
  const url = await startServer(t, pool);
  const response = await fetch(`${url}/api/gastos?mes=2026-11`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    month: "2026-11",
    total: "123.50",
    categories: [{ category: "Hogar", total: "123.50", count: 2, grand_total: "123.50" }],
  });
  assert.deepEqual(queries[0].params, ["[DEMO] Hogar de prueba"]);
  assert.deepEqual(queries[1].params, [42, "2026-11"]);
});

test("rechaza meses inválidos y métodos de escritura antes de consultar la base", async (t) => {
  const url = await startServer(t, { query() { throw new Error("No debe consultar la base"); } });
  for (const month of ["2026-13", "2026-1", "1899-12", "2026-11&mes=2026-10"]) {
    assert.equal((await fetch(`${url}/api/gastos?mes=${month}`)).status, 400);
  }
  assert.equal((await fetch(`${url}/api/gastos?mes=2026-11`, { method: "DELETE" })).status, 405);
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

test("informa si el hogar de prueba no existe o está duplicado", async (t) => {
  for (const rows of [[], [{ household_id: 1 }, { household_id: 2 }]]) {
    const url = await startServer(t, { async query() { return { rows }; } });
    const response = await fetch(`${url}/api/gastos?mes=2026-11`);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /exactamente un hogar/);
  }
});

test("un mes sin gastos devuelve total cero", async (t) => {
  let call = 0;
  const url = await startServer(t, {
    async query() {
      call += 1;
      return { rows: call === 1 ? [{ household_id: 42 }] : [] };
    },
  });
  const response = await fetch(`${url}/api/gastos?mes=2025-01`);
  assert.deepEqual(await response.json(), { month: "2025-01", total: "0", categories: [] });
});
