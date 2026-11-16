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
      return { rows: [{
        total: "123.50",
        categories: [{ category: "Hogar", total: "123.50", count: 2, grand_total: "123.50" }],
        expenses: [{ date: "2026-11-02", description: "Compra", category: "Hogar", amount: "123.50" }],
      }] };
    },
  };
  const url = await startServer(t, pool);
  const response = await fetch(`${url}/api/gastos?mes=2026-11`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    month: "2026-11",
    total: "123.50",
    categories: [{ category: "Hogar", total: "123.50", count: 2, grand_total: "123.50" }],
    expenses: [{ date: "2026-11-02", description: "Compra", category: "Hogar", amount: "123.50" }],
  });
  assert.deepEqual(queries[0].params, ["[DEMO] Hogar de prueba"]);
  assert.deepEqual(queries[1].params, [42, "2026-11", null]);
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
      return { rows: call === 1 ? [{ household_id: 42 }] : [{ total: "0", categories: [], expenses: [] }] };
    },
  });
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

test("consulta metas, progreso y aportes solo del hogar personal", async (t) => {
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

test("registra aportes únicamente en metas del hogar personal", async (t) => {
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

test("elimina únicamente aportes creados por el integrante personal", async (t) => {
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
