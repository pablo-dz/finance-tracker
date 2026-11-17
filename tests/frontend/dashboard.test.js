import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("los módulos coordinan la sesión, los movimientos y la planificación", async (t) => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "http://127.0.0.1:3000/" });
  const { window } = dom;
  const originalGlobals = new Map(
    ["document", "FormData", "Option", "confirm", "fetch"]
      .map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const setGlobal = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  for (const name of ["document", "FormData", "Option"]) {
    setGlobal(name, window[name]);
  }
  setGlobal("confirm", () => true);
  window.HTMLElement.prototype.scrollIntoView = () => {};
  t.after(() => {
    dom.window.close();
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });

  const data = {
    user: null,
    expense: null,
    income: null,
    transfer: null,
    budget: null,
    goals: [],
    categories: [{ id: 2, name: "Groceries", active: true }],
  };
  const requests = [];
  const account = { id: 1, name: "Cuenta principal", openingBalance: "0.00", balance: "0.00" };
  const secondAccount = { id: 6, name: "Ahorro", openingBalance: "0.00", balance: "0.00" };
  const category = { id: 2, name: "Groceries" };
  const incomeCategory = { id: 3, name: "Salary" };
  setGlobal("fetch", async (path, options = {}) => {
    const url = new URL(path, "http://127.0.0.1:3000");
    const method = options.method ?? "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path: url.pathname, method, body });
    let result;
    if (url.pathname === "/api/auth/session") {
      result = { user: data.user };
    } else if (url.pathname === "/api/auth/register" || url.pathname === "/api/auth/login") {
      data.user = { email: body.email };
      result = { user: data.user };
    } else if (url.pathname === "/api/auth/logout") {
      data.user = null;
      result = { message: "Sesión cerrada." };
    } else if (url.pathname === "/api/opciones") {
      result = { accounts: [account, secondAccount], categories: data.categories.filter((item) => item.active),
                 incomeCategories: [incomeCategory] };
    } else if (url.pathname === "/api/cuentas/saldo-inicial") {
      account.openingBalance = body.amount;
      result = { message: "Guardado." };
    } else if (url.pathname === "/api/gastos" && method !== "GET") {
      if (body.merchant === "Rechazado") {
        return { ok: false, json: async () => ({ error: "No se pudo guardar el gasto." }) };
      }
      data.expense = { ...body, id: "1", description: body.merchant, category: category.name, editable: true };
      result = { message: "Guardado." };
    } else if (url.pathname === "/api/gastos") {
      const expense = data.expense;
      result = {
        total: expense ? `${expense.amount}.00` : "0",
        categories: expense ? [{ category: category.name, total: `${expense.amount}.00`, count: 1 }] : [],
        expenses: expense ? [{ ...expense, amount: `${expense.amount}.00` }] : [],
      };
    } else if (url.pathname === "/api/ingresos" && method !== "GET") {
      data.income = body;
      result = { message: "Guardado." };
    } else if (url.pathname === "/api/transferencias" && method !== "GET") {
      data.transfer = body;
      result = { message: "Guardado." };
    } else if (url.pathname === "/api/movimientos") {
      result = {
        incomeTotal: data.income ? `${data.income.amount}.00` : "0",
        movements: [...(data.income ? [{
          ...data.income, id: "transaction-2", type: "income", description: data.income.merchant,
          amount: `${data.income.amount}.00`, account: account.name, category: incomeCategory.name,
        }] : []), ...(data.transfer ? [{
          ...data.transfer, id: "transfer-3", type: "transfer", description: data.transfer.note,
          amount: data.transfer.amount, account: account.name, destinationAccount: secondAccount.name,
        }] : [])],
      };
    } else if (url.pathname === "/api/categorias" && method === "POST") {
      data.categories.push({ id: 7, name: body.name, active: true });
      result = { message: "Categoría creada." };
    } else if (url.pathname === "/api/categorias" && method === "PATCH") {
      data.categories.find((item) => item.id === body.id).active = body.active;
      result = { message: "Categoría actualizada." };
    } else if (url.pathname === "/api/categorias") {
      result = { categories: data.categories };
    } else if (url.pathname === "/api/presupuestos" && method !== "GET") {
      if (method === "PUT") {
        return { ok: false, json: async () => ({ error: "El presupuesto cambió." }) };
      }
      data.budget = body;
      result = { message: "Guardado." };
    } else if (url.pathname === "/api/presupuestos") {
      result = { categories: [{
        categoryId: category.id, category: category.name, isActive: true,
        budget: data.budget ? `${data.budget.amount}.00` : null,
        spent: data.expense ? `${data.expense.amount}.00` : "0",
        difference: "500.00", exceeded: false,
      }] };
    } else if (url.pathname === "/api/metas" && method === "POST") {
      data.goals.push({ id: 4, name: body.name, targetAmount: `${body.targetAmount}.00`,
                        dueDate: body.dueDate, saved: "0", contributions: [] });
      result = { message: "Guardado." };
    } else if (url.pathname === "/api/metas") {
      result = { goals: data.goals };
    } else if (url.pathname === "/api/metas/aportes" && method === "POST") {
      data.goals[0].saved = `${body.amount}.00`;
      data.goals[0].contributions.push({ id: "5", date: body.date, amount: `${body.amount}.00`,
                                        note: body.note, editable: true });
      result = { message: "Guardado." };
    } else if (url.pathname === "/api/metas/aportes" && method === "DELETE") {
      data.goals[0].saved = "0";
      data.goals[0].contributions = [];
      result = { message: "Eliminado." };
    } else if (url.pathname === "/api/reportes") {
      result = { total: data.expense ? `${data.expense.amount}.00` : "0", average: "0",
                 monthly: [], categories: [] };
    } else {
      throw new Error(`Solicitud inesperada: ${method} ${url.pathname}`);
    }
    return { ok: true, json: async () => result };
  });

  const element = (selector) => window.document.querySelector(selector);
  const field = (form, name, value) => { element(`${form} [name="${name}"]`).value = value; };
  const submit = (selector) => element(selector).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("La interfaz no alcanzó el estado esperado");
  };

  await import("../../frontend/dashboard.js");
  field("#register-form", "email", "test@example.test");
  field("#register-form", "password", "contraseña de prueba");
  field("#register-form", "passwordConfirm", "contraseña distinta");
  submit("#register-form");
  assert.equal(element("#auth-status").textContent, "Las contraseñas no coinciden.");
  assert.ok(!requests.some((request) => request.path === "/api/auth/register"));
  field("#register-form", "passwordConfirm", "contraseña de prueba");
  submit("#register-form");
  await waitFor(() => element("#expense-form [name=categoryId]").options.length === 2);
  assert.equal(element("#user-email").textContent, "test@example.test");

  field("#expense-form", "merchant", "Compra");
  field("#expense-form", "amount", "1500");
  field("#expense-form", "accountId", "1");
  field("#expense-form", "categoryId", "2");
  submit("#expense-form");
  await waitFor(() => element("#movements").textContent.includes("Compra") && !element("#save-expense").disabled);
  assert.equal(element("#total").textContent, "$1.500");
  assert.match(element("#categories").textContent, /Supermercado.*100 %/);
  element('[aria-label="Editar Compra"]').click();
  field("#expense-form", "amount", "1200");
  submit("#expense-form");
  await waitFor(() => element("#total").textContent === "$1.200" && !element("#save-expense").disabled);
  assert.ok(requests.some((request) => request.path === "/api/gastos" && request.method === "PUT" && request.body.id === "1"));

  field("#expense-form", "merchant", "Rechazado");
  field("#expense-form", "amount", "200");
  field("#expense-form", "accountId", "1");
  field("#expense-form", "categoryId", "2");
  submit("#expense-form");
  await waitFor(() => element("#form-message").textContent === "No se pudo guardar el gasto.");
  assert.equal(element("#total").textContent, "$1.200");
  assert.equal(element('#expense-form [name="merchant"]').value, "Rechazado");

  field("#income-form", "merchant", "Sueldo");
  field("#income-form", "amount", "3000");
  field("#income-form", "accountId", "1");
  field("#income-form", "categoryId", "3");
  submit("#income-form");
  await waitFor(() => element("#income-movements").textContent.includes("Sueldo") && !element("#save-income").disabled);
  assert.equal(element("#income-total").textContent, "$3.000");

  field("#transfer-form", "amount", "200.50");
  field("#transfer-form", "sourceAccountId", "1");
  field("#transfer-form", "destinationAccountId", "6");
  field("#transfer-form", "note", "Ahorro");
  submit("#transfer-form");
  await waitFor(() => element("#income-movements").textContent.includes("Ahorro") && !element("#save-transfer").disabled);
  element('[aria-label="Editar transferencia Ahorro"]').click();
  field("#transfer-form", "amount", "300.50");
  submit("#transfer-form");
  await waitFor(() => element("#transfer-form-message").textContent === "Transferencia actualizada correctamente.");
  assert.ok(requests.some((request) => request.path === "/api/transferencias" && request.method === "PUT"
    && request.body.id === "3" && request.body.amount === "300.50"));

  field("#opening-balance-form", "amount", "1000");
  submit("#opening-balance-form");
  await waitFor(() => element("#opening-balance-message").textContent === "Saldo inicial actualizado correctamente.");
  assert.ok(requests.some((request) => request.path === "/api/cuentas/saldo-inicial"
    && request.body.expectedAmount === "0.00"));

  field("#budget-form", "categoryId", "2");
  field("#budget-form", "amount", "1700");
  submit("#budget-form");
  await waitFor(() => element("#budgets").textContent.includes("Límite: $1.700"));
  assert.match(element("#budgets").textContent, /Disponible: \$500/);
  element('[aria-label^="Cambiar límite de Supermercado"]').click();
  field("#budget-form", "amount", "2000");
  submit("#budget-form");
  await waitFor(() => element("#budget-form-message").textContent === "El presupuesto cambió.");
  assert.ok(requests.some((request) => request.path === "/api/presupuestos" && request.method === "PUT"
    && request.body.expectedAmount === "1700.00"));

  field("#category-form", "name", "Mascotas");
  submit("#category-form");
  await waitFor(() => element('[aria-label="Archivar categoría Mascotas"]'));
  element('[aria-label="Archivar categoría Mascotas"]').click();
  await waitFor(() => element('[aria-label="Restaurar categoría Mascotas"]')
    && !element("#expense-form [name=categoryId]").textContent.includes("Mascotas"));
  assert.ok(!element("#expense-form [name=categoryId]").textContent.includes("Mascotas"));

  field("#savings-goal-form", "name", "Viaje");
  field("#savings-goal-form", "targetAmount", "10000");
  submit("#savings-goal-form");
  await waitFor(() => element("#savings-contribution-form [name=goalId]").options.length === 2);
  field("#savings-contribution-form", "goalId", "4");
  field("#savings-contribution-form", "amount", "500");
  submit("#savings-contribution-form");
  await waitFor(() => element("#savings-goals").textContent.includes("Ahorrado: $500"));
  assert.match(element("#savings-goals").textContent, /5 %/);
  element('[aria-label="Eliminar aporte de $500 a Viaje"]').click();
  await waitFor(() => element("#savings-goals").textContent.includes("Ahorrado: $0"));

  element("#logout-button").click();
  await waitFor(() => !element("#auth-panel").hidden);
  assert.equal(element("#auth-status").textContent, "Sesión cerrada.");
});
