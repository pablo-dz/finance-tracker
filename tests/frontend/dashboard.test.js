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
  let alertMessage;
  window.alert = (message) => { alertMessage = message; };
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
    categories: [{ id: 2, name: "Groceries", active: true, fixed: false }],
    payments: [],
    dashboardBudgets: null,
    failDashboard: false,
    failExpenses: false,
    failGoals: false,
    failCategories: false,
    failCategorySave: false,
    categorySaveGate: null,
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
    requests.push({ path: url.pathname, method, body, month: url.searchParams.get("mes") });
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
    } else if (url.pathname === "/api/dashboard") {
      if (data.failDashboard) return { ok: false, json: async () => ({ error: "Dashboard no disponible." }) };
      const month = url.searchParams.get("mes");
      const expense = Number(data.expense?.amount ?? 0);
      const income = Number(data.income?.amount ?? 0);
      const budget = data.budget ? Number(data.budget.amount) : null;
      const current = { month, income: String(income), expenses: String(expense),
                        saving: String(income - expense),
                        savingRate: income ? String((income - expense) * 100 / income) : null };
      result = {
        month, today: `${month}-15`, current,
        previous: { income: "0", expenses: "0", saving: "0", savingRate: null },
        monthly: [current],
        categories: expense ? [{ month, id: 2, name: "Groceries",
                                 fixed: data.categories[0].fixed, amount: String(expense) }] : [],
        budgets: data.dashboardBudgets ?? [{ categoryId: 2, category: "Groceries", isActive: true,
                    budget: budget === null ? null : String(budget), spent: String(expense),
                    difference: budget === null ? null : String(Math.abs(budget - expense)),
                    exceeded: budget !== null && expense > budget }],
        daily: expense ? [{ day: 1, budgeted: String(budget === null ? 0 : expense),
                            unbudgeted: String(budget === null ? expense : 0) }] : [],
        goals: data.goals.map((goal) => ({
          name: goal.name, saved: goal.saved, target: goal.targetAmount,
          estimate: { status: "insufficient", date: null },
        })),
        balances: [{ month, balance: account.openingBalance }],
        topExpenses: expense ? [{ name: data.expense.merchant, date: `${month}-01`, amount: String(expense) }] : [],
        merchants: [],
      };
    } else if (url.pathname === "/api/dashboard/categorias") {
      if (method === "PATCH") {
        data.categories.find((item) => item.id === body.id).fixed = body.fixed;
        result = { message: "Guardado." };
      } else {
        if (data.failCategories) return { ok: false, json: async () => ({ error: "Categorías no disponibles." }) };
        result = { categories: data.categories };
      }
    } else if (url.pathname === "/api/recurrentes") {
      if (method === "POST") {
        data.payments.push({ ...body, id: "1" });
      } else if (method === "PUT") {
        data.payments = data.payments.map((payment) => payment.id === body.id ? body : payment);
      } else if (method === "DELETE") {
        data.payments = data.payments.filter((payment) => payment.id !== body.id);
      }
      result = { payments: data.payments };
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
      if (data.failExpenses) return { ok: false, json: async () => ({ error: "Gastos no disponibles." }) };
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
    } else if (url.pathname === "/api/categorias/lote" && method === "POST") {
      if (data.categorySaveGate) await data.categorySaveGate;
      if (data.failCategorySave === "network") throw new Error("Conexión interrumpida");
      if (data.failCategorySave) return { ok: false, json: async () => ({ error: "No se pudo guardar." }) };
      for (const change of body.changes) {
        if (change.id) Object.assign(data.categories.find((item) => item.id === change.id), {
          name: change.name, active: change.active, fixed: change.fixed,
        });
        else data.categories.push({ id: 7, name: change.name, active: change.active, fixed: change.fixed });
      }
      result = { message: "Categorías actualizadas correctamente.", categories: data.categories };
    } else if (url.pathname === "/api/categorias" && method === "POST") {
      data.categories.push({ id: 7, name: body.name, active: true, fixed: false });
      result = { message: "Categoría creada." };
    } else if (url.pathname === "/api/categorias" && method === "PATCH") {
      data.categories.find((item) => item.id === body.id).active = body.active;
      result = { message: "Categoría actualizada." };
    } else if (url.pathname === "/api/categorias" && method === "PUT") {
      data.categories.find((item) => item.id === body.id).name = body.name;
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
      if (data.failGoals) return { ok: false, json: async () => ({ error: "Metas no disponibles." }) };
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
  await waitFor(() => !element("#dashboard-content").hidden);
  assert.equal(element("#user-email").textContent, "test@example.test");
  assert.equal(element("#dashboard-view").hidden, false);
  assert.equal(element("#savings-panel").hidden, true);
  assert.equal(element("#nav-dashboard").getAttribute("aria-current"), "page");
  assert.match(element("#dashboard-summary").textContent, /Sin ingresos/);
  assert.equal(element("#dashboard-trend-chart svg").getAttribute("aria-hidden"), "true");

  data.dashboardBudgets = [
    { category: "Normal", budget: "100.00", spent: "79.99", difference: "20.01", exceeded: false },
    { category: "Alerta", budget: "100.00", spent: "80.00", difference: "20.00", exceeded: false },
    { category: "Límite", budget: "100.00", spent: "100.00", difference: "0.00", exceeded: false },
    { category: "Exceso", budget: "100.00", spent: "150.00", difference: "50.00", exceeded: true },
    { category: "Exceso mínimo", budget: "1000.00", spent: "1000.01", difference: "0.01", exceeded: true },
    { category: "Bajo la alerta", budget: "1000.00", spent: "799.99", difference: "200.01", exceeded: false },
    { category: "Muy pequeño", budget: "999999999999.00", spent: "0.01", difference: "999999999998.99", exceeded: false },
    { category: "Cero con gasto", budget: "0.00", spent: "10.00", difference: "10.00", exceeded: true },
    { category: "Cero sin gasto", budget: "0.00", spent: "0.00", difference: "0.00", exceeded: false },
    { category: "Sin límite", budget: null, spent: "20.00", difference: null, exceeded: false },
  ];
  submit("#month-form");
  await waitFor(() => element("#dashboard-budget-chart").textContent.includes("Cero con gasto")
    && !element("#dashboard-content").hidden);
  const chartItems = [...element("#dashboard-budget-chart").querySelectorAll(".budget-chart-item")];
  assert.deepEqual(chartItems.map((item) => item.querySelector("strong").textContent),
    ["Exceso", "Exceso mínimo", "Límite", "Alerta", "Bajo la alerta", "Normal", "Muy pequeño"]);
  for (const [index, width, level] of [[0, "100%", "exceeded"], [1, "100%", "exceeded"],
                                       [2, "100%", "limit"], [3, "80%", "warning"],
                                       [4, "79.99%", "normal"], [5, "79.99%", "normal"]]) {
    const fill = chartItems[index].querySelector(".dashboard-bar");
    assert.equal(fill.style.width, width);
    assert.ok(fill.classList.contains(`budget-level-${level}`));
  }
  assert.match(chartItems[0].textContent, /150 %.*Excedido: \$50/);
  assert.match(chartItems[1].textContent, />100 %.*Presupuesto excedido/);
  assert.match(chartItems[4].textContent, /79,99 %.*Dentro del presupuesto/);
  assert.match(chartItems[6].textContent, /<0,01 %/);
  assert.match(element("#dashboard-budget-chart").textContent, /Presupuesto cero.*Cero con gasto.*Excedido: \$10.*Cero sin gasto.*Sin gasto/);
  assert.match(element("#dashboard-budget-chart").textContent, /Sin presupuesto.*Sin límite.*Gastado: \$20/);
  assert.equal(element("#dashboard-budgets").closest("details").open, false);
  data.dashboardBudgets = [];
  submit("#month-form");
  await waitFor(() => element("#dashboard-budget-chart").textContent.includes("No hay categorías")
    && !element("#dashboard-content").hidden);
  data.dashboardBudgets = null;
  submit("#month-form");
  await waitFor(() => element("#dashboard-budget-chart").textContent.includes("Sin presupuesto")
    && !element("#dashboard-content").hidden);

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
  assert.match(element("#dashboard-summary").textContent, /Gastos\$1.200/);
  assert.match(element("#dashboard-pace-note").textContent, /Gastos sin presupuesto hasta la fecha: \$1.200/);
  assert.match(element("#dashboard-category-chart").textContent, /Supermercado.*100 %/);
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
  await waitFor(() => element("#dashboard-budgets").textContent.includes("Límite: $1.700"));
  assert.equal(element("#dashboard-pace-chart svg").querySelectorAll("polyline").length, 2);
  assert.match(element("#budgets").textContent, /Disponible: \$500/);
  for (const [spent, expected] of [["1360", "Alerta: 80 % o más"],
                                   ["1700", "Límite alcanzado"],
                                   ["1701", "Presupuesto excedido"]]) {
    data.expense.amount = spent;
    submit("#month-form");
    await waitFor(() => element("#dashboard-budgets").textContent.includes(expected)
      && !element("#dashboard-content").hidden);
  }
  data.budget.amount = "0";
  submit("#month-form");
  await waitFor(() => element("#dashboard-budgets").textContent.includes("Límite: $0")
    && element("#dashboard-budgets").textContent.includes("Presupuesto excedido")
    && !element("#dashboard-content").hidden);
  data.budget.amount = "1700";
  data.expense.amount = "1200";
  submit("#month-form");
  await waitFor(() => element("#dashboard-budgets").textContent.includes("Disponible: $500")
    && !element("#dashboard-content").hidden);
  element('[aria-label^="Cambiar límite de Supermercado"]').click();
  field("#budget-form", "amount", "2000");
  submit("#budget-form");
  await waitFor(() => element("#budget-form-message").textContent === "El presupuesto cambió.");
  assert.ok(requests.some((request) => request.path === "/api/presupuestos" && request.method === "PUT"
    && request.body.expectedAmount === "1700.00"));

  data.failExpenses = true;
  submit("#month-form");
  await waitFor(() => element("#message").textContent === "Gastos no disponibles.");
  element("#nav-categories").click();
  assert.equal(element("#dashboard-view").hidden, true);
  assert.equal(element("#category-panel").hidden, false);
  assert.equal(element("#nav-categories").getAttribute("aria-current"), "page");
  assert.equal(element("#nav-dashboard").hasAttribute("aria-current"), false);
  data.failCategories = true;
  element("#refresh-categories").click();
  await waitFor(() => element("#category-status").textContent === "Categorías no disponibles.");
  assert.equal(element("#managed-categories").children.length, 0);
  data.failCategories = false;
  element("#refresh-categories").click();
  await waitFor(() => element('[aria-label="Tipo de Supermercado"]'));

  const classification = element('[aria-label="Tipo de Supermercado"]');
  classification.value = "true";
  classification.dispatchEvent(new window.Event("change", { bubbles: true }));
  field("#category-form", "name", "Mascotas");
  submit("#category-form");
  assert.ok(element('[aria-label="Quitar categoría Mascotas"]'));
  assert.equal(data.categories[0].fixed, false);
  assert.equal(data.categories.length, 1);
  assert.ok(!requests.some((request) => request.path === "/api/categorias/lote"));
  const leaveWithChanges = new window.Event("beforeunload", { cancelable: true });
  assert.equal(window.dispatchEvent(leaveWithChanges), false);
  element("#nav-savings").click();
  element("#nav-categories").click();
  assert.equal(element('[aria-label="Tipo de Supermercado"]').value, "true");
  assert.ok(element('[aria-label="Quitar categoría Mascotas"]'));
  data.failCategorySave = true;
  element("#save-categories").click();
  await waitFor(() => element("#category-status").textContent === "No se pudo guardar.");
  assert.ok(element('[aria-label="Quitar categoría Mascotas"]'));
  assert.equal(data.categories[0].fixed, false);
  data.failCategorySave = false;
  let releaseCategorySave;
  data.categorySaveGate = new Promise((resolve) => { releaseCategorySave = resolve; });
  element("#save-categories").click();
  element("#logout-button").click();
  assert.match(alertMessage, /Espera a que termine el guardado/);
  assert.ok(!requests.some((request) => request.path === "/api/auth/logout"));
  data.categorySaveGate = null;
  releaseCategorySave();
  await waitFor(() => element("#category-status").textContent === "Categorías actualizadas correctamente.");
  assert.equal(data.categories[0].fixed, true);
  assert.equal(data.categories.length, 2);
  assert.equal(window.dispatchEvent(new window.Event("beforeunload", { cancelable: true })), true);

  const draftType = element('[aria-label="Tipo de Supermercado"]');
  draftType.value = "false";
  draftType.dispatchEvent(new window.Event("change", { bubbles: true }));
  element("#refresh-categories").click();
  await waitFor(() => element('[aria-label="Tipo de Supermercado"]')?.value === "true");
  assert.equal(data.categories[0].fixed, true);

  const uncertainType = element('[aria-label="Tipo de Supermercado"]');
  uncertainType.value = "false";
  uncertainType.dispatchEvent(new window.Event("change", { bubbles: true }));
  data.failCategorySave = "network";
  element("#save-categories").click();
  await waitFor(() => element("#category-status").textContent.includes("No se pudo confirmar el guardado"));
  assert.equal(element("#save-categories").disabled, true);
  data.failCategorySave = false;
  element("#refresh-categories").click();
  await waitFor(() => element('[aria-label="Tipo de Supermercado"]')?.value === "true");

  const rename = element('[aria-label="Nombre de la categoría Mascotas"]');
  rename.value = "Mascotas y salud";
  rename.dispatchEvent(new window.Event("input", { bubbles: true }));
  element('[aria-label="Archivar categoría Mascotas"]').click();
  assert.equal(data.categories[1].name, "Mascotas");
  assert.equal(data.categories[1].active, true);
  element("#save-categories").click();
  await waitFor(() => element('[aria-label="Restaurar categoría Mascotas y salud"]')
    && !element("#expense-form [name=categoryId]").textContent.includes("Mascotas y salud"));
  await waitFor(() => element("#category-status").textContent === "Categorías actualizadas correctamente.");
  element('[aria-label="Restaurar categoría Mascotas y salud"]').click();
  assert.equal(data.categories[1].active, false);
  element("#save-categories").click();
  await waitFor(() => element("#category-status").textContent === "Categorías actualizadas correctamente.");
  assert.ok(element("#expense-form [name=categoryId]").textContent.includes("Mascotas y salud"));

  element("#nav-savings").click();
  assert.equal(element("#dashboard-view").hidden, true);
  assert.equal(element("#savings-panel").hidden, false);
  assert.equal(element("#category-panel").hidden, true);
  assert.equal(element("#nav-savings").getAttribute("aria-current"), "page");
  assert.equal(element("#nav-dashboard").hasAttribute("aria-current"), false);
  field("#savings-goal-form", "name", "Viaje");
  field("#savings-goal-form", "targetAmount", "10000");
  submit("#savings-goal-form");
  await waitFor(() => element("#savings-contribution-form [name=goalId]").options.length === 2);
  data.failGoals = true;
  element("#refresh-savings").click();
  await waitFor(() => element("#savings-status").textContent === "Metas no disponibles.");
  assert.equal(element("#save-contribution").disabled, true);
  data.failGoals = false;
  element("#refresh-savings").click();
  await waitFor(() => element("#savings-contribution-form [name=goalId]").options.length === 2);
  field("#savings-contribution-form", "goalId", "4");
  field("#savings-contribution-form", "amount", "500");
  submit("#savings-contribution-form");
  await waitFor(() => element("#savings-goals").textContent.includes("Ahorrado: $500"));
  assert.match(element("#savings-goals").textContent, /5 %/);
  element('[aria-label="Eliminar aporte de $500 a Viaje"]').click();
  await waitFor(() => element("#savings-goals").textContent.includes("Ahorrado: $0"));
  data.failExpenses = false;
  element("#nav-dashboard").click();
  assert.equal(element("#dashboard-view").hidden, false);
  assert.equal(element("#savings-panel").hidden, true);
  assert.equal(element("#nav-dashboard").getAttribute("aria-current"), "page");
  submit("#month-form");
  await waitFor(() => !element("#results").hidden && !element("#dashboard-content").hidden);

  await waitFor(() => element("#dashboard-fixed").textContent.includes("Fijos: $1.200"));
  assert.match(element("#dashboard-fixed-chart").textContent, /Fijos.*\$1.200/);

  const viewedMonth = element("#month").value;
  element("#month").value = "2020-03";
  element("#nav-categories").click();
  const beforeRename = requests.length;
  const secondRename = element('[aria-label="Nombre de la categoría Mascotas y salud"]');
  secondRename.value = "Mascotas nuevas";
  secondRename.dispatchEvent(new window.Event("input", { bubbles: true }));
  element("#save-categories").click();
  await waitFor(() => element("#category-status").textContent === "Categorías actualizadas correctamente."
    && !element("#create-category").disabled);
  assert.ok(requests.slice(beforeRename).some((request) => request.path === "/api/gastos" && request.month === viewedMonth));
  assert.ok(!requests.slice(beforeRename).some((request) => request.path === "/api/gastos" && request.month === "2020-03"));
  element("#month").value = viewedMonth;
  element("#nav-dashboard").click();

  field("#recurring-form", "name", "Suscripción");
  field("#recurring-form", "amount", "120.01");
  field("#recurring-form", "frequency", "yearly");
  submit("#recurring-form");
  await waitFor(() => element("#recurring-list").textContent.includes("Suscripción"));
  assert.match(element("#recurring-totals").textContent, /\$10.*\$120/);
  element('[aria-label="Editar pago recurrente Suscripción"]').click();
  field("#recurring-form", "amount", "240");
  submit("#recurring-form");
  await waitFor(() => element("#recurring-totals").textContent.includes("$240"));
  element('[aria-label="Eliminar pago recurrente Suscripción"]').click();
  await waitFor(() => element("#recurring-list").textContent.includes("No hay pagos"));

  data.failDashboard = true;
  submit("#month-form");
  await waitFor(() => element("#dashboard-status").textContent === "Dashboard no disponible.");
  assert.equal(element("#dashboard-content").hidden, true);

  element("#logout-button").click();
  await waitFor(() => !element("#auth-panel").hidden);
  assert.equal(element("#auth-status").textContent, "Sesión cerrada.");
});
