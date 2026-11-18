import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("los módulos del frontend comparten una versión que evita archivos cacheados incompatibles", async () => {
  const html = await readFile(new URL("../../frontend/index.html", import.meta.url), "utf8");
  const entry = html.match(/<script src="(\/dashboard\.js\?v=([^"]+))" type="module">/);
  assert.ok(entry, "El módulo principal debe tener una versión.");
  const pending = [new URL(`../../frontend${entry[1]}`, import.meta.url)];
  const visited = new Set();
  while (pending.length) {
    const url = pending.pop();
    if (visited.has(url.href)) continue;
    visited.add(url.href);
    const source = await readFile(url, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.[^"']+\.js(?:\?[^"']*)?)["']/g)) {
      const dependency = new URL(match[1], url);
      assert.equal(dependency.searchParams.get("v"), entry[2], `${url.pathname}: ${match[1]}`);
      pending.push(dependency);
    }
  }
});

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
    otherBudgets: {},
    goals: [],
    categories: [{ id: 2, name: "Groceries", active: true, fixed: false }],
    payments: [],
    dashboardBudgets: null,
    dashboardCategories: null,
    dashboardMonthly: null,
    failDashboard: false,
    failExpenses: false,
    failGoals: false,
    failCategories: false,
    failCategorySave: false,
    categorySaveGate: null,
    categoryLoadGate: null,
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
        monthly: data.dashboardMonthly ?? [current],
        categories: data.dashboardCategories ?? (expense ? [{ month, id: 2, name: "Groceries",
                                 fixed: data.categories[0].fixed, amount: String(expense) }] : []),
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
        if (data.categoryLoadGate) await data.categoryLoadGate;
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
        if (change.budget) {
          const id = change.id ?? 7;
          if (id === 2) data.budget = change.budget.amount === null ? null : { amount: change.budget.amount };
          else data.otherBudgets[id] = change.budget.amount;
        }
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
      result = { categories: data.categories.map((item) => ({
        categoryId: item.id, category: item.name, isActive: item.active,
        budget: item.id === 2 ? (data.budget ? (data.budget.amount.includes(".") ? data.budget.amount : `${data.budget.amount}.00`) : null)
          : (data.otherBudgets[item.id] == null ? null : `${data.otherBudgets[item.id]}.00`),
        spent: data.expense ? `${data.expense.amount}.00` : "0",
        difference: "500.00", exceeded: false,
      })) };
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
  data.budget = { amount: "350" };
  let releaseCategoryLoad;
  data.categoryLoadGate = new Promise((resolve) => { releaseCategoryLoad = resolve; });
  submit("#register-form");
  await waitFor(() => element("#budget-period").textContent.startsWith("Presupuestos del mes:"));
  data.categoryLoadGate = null;
  releaseCategoryLoad();
  await waitFor(() => element('[aria-label="Presupuesto de Supermercado"]') && !element('[aria-label="Presupuesto de Supermercado"]').disabled);
  assert.equal(element('[aria-label="Presupuesto de Supermercado"]').value, "350");
  data.budget = null;
  submit("#month-form");
  await waitFor(() => element('[aria-label="Presupuesto de Supermercado"]')?.value === "");
  await waitFor(() => element("#expense-form [name=categoryId]").options.length === 2);
  await waitFor(() => !element("#dashboard-content").hidden);
  assert.equal(element("#user-email").textContent, "test@example.test");
  assert.equal(element("#dashboard-view").hidden, false);
  assert.equal(element("#savings-panel").hidden, true);
  assert.equal(element("#nav-dashboard").getAttribute("aria-current"), "page");
  assert.equal(element("#budget-panel"), null);
  assert.match(element("#dashboard-summary").textContent, /Sin ingresos/);
  assert.deepEqual([...element('[aria-label="Desglose de gastos"]').querySelectorAll(".expense-breakdown-row")]
    .map((row) => row.textContent), ["Fijos$0", "Variables$0"]);
  assert.equal(element("#dashboard-fixed-chart"), null);
  assert.equal([...window.document.querySelectorAll("summary")].some((item) => item.textContent === "Gastos fijos y variables"), false);
  assert.equal(element("#dashboard-trend-chart svg").getAttribute("aria-hidden"), "true");
  for (const selector of ["#dashboard-trend-chart", "#dashboard-balance-chart"]) {
    assert.equal(element(`${selector} .visualization-axis-x`).textContent, "Mes");
    assert.equal(element(`${selector} .visualization-axis-y`).textContent, "Monto (CLP)");
  }

  const initialMonth = element("#month").value;
  element("#month").value = "2024-12";
  data.dashboardMonthly = Array.from({ length: 12 }, (_, index) => ({
    month: `2024-${String(index + 1).padStart(2, "0")}`, income: index === 0 ? "100" : "0",
    expenses: index === 0 ? "60" : "0", saving: index === 0 ? "40" : "0",
  }));
  data.dashboardCategories = [
    { id: 2, name: "Groceries", month: "2024-01", amount: "20", fixed: false },
    { id: 2, name: "Groceries", month: "2024-12", amount: "75", fixed: false },
    { id: null, name: "Sin categoría", month: "2024-11", amount: "40", fixed: null },
    { id: null, name: "Sin categoría", month: "2024-12", amount: "25", fixed: null },
    { id: 10, name: "Servicio", month: "2024-12", amount: "12.34", fixed: true },
    { id: 9, name: "Histórica", month: "2024-02", amount: "15", fixed: false },
  ];
  submit("#month-form");
  await waitFor(() => element("#category-evolution-title").textContent === "Evolución: Supermercado"
    && !element("#dashboard-content").hidden);
  const expensesMetric = element('[aria-label="Desglose de gastos"]').closest(".dashboard-metric");
  assert.equal(expensesMetric.querySelector("span").textContent, "Gastos");
  assert.deepEqual([...expensesMetric.querySelectorAll(".expense-breakdown-row")].map((row) => row.textContent),
    ["Fijos$12,34", "Variables$75", "Sin clasificar$25"]);
  assert.ok(expensesMetric.querySelector("small").textContent.includes("frente al mes anterior"));
  assert.ok(element("#dashboard-trend").classList.contains("visually-hidden"));
  assert.equal([...window.document.querySelectorAll("summary")].some((item) => item.textContent === "Ver datos mensuales"), false);
  const trendPoint = element("#dashboard-trend-chart .visualization-point-target");
  trendPoint.dispatchEvent(new window.MouseEvent("mouseenter"));
  assert.match(element("#dashboard-trend-chart .line-tooltip").textContent,
    /2024-01.*Ingresos: \$100.*Gastos: \$60.*Ahorro neto: \$40/);
  assert.match(element("#dashboard-trend").textContent, /2024-01: Ingresos: \$100.*Gastos: \$60.*Ahorro neto: \$40/);
  assert.equal(element("#category-evolution-values").children.length, 12);
  assert.equal(element("#category-evolution-chart .visualization-axis-x").textContent, "Mes");
  assert.equal(element("#category-evolution-chart .visualization-axis-y").textContent, "Monto (CLP)");
  assert.deepEqual([...element("#category-evolution-chart").querySelectorAll(".visualization-y-tick")]
    .map((tick) => tick.textContent), ["$80", "$60", "$40", "$20", "$0"]);
  assert.ok(element("#category-evolution-values").classList.contains("visually-hidden"));
  assert.equal(element("#dashboard-category-trend"), null);
  assert.match(element("#category-evolution-values").textContent, /2024-01: \$20.*2024-02: \$0/);
  assert.equal(element("#category-evolution-chart").querySelectorAll("circle").length, 12);
  const evolutionPoints = element("#category-evolution-chart").querySelectorAll(".visualization-point-target");
  assert.equal(evolutionPoints.length, 12);
  evolutionPoints[0].dispatchEvent(new window.MouseEvent("mouseenter"));
  assert.match(element("#category-evolution-chart .line-tooltip").textContent, /2024-01.*Supermercado: \$20/);
  evolutionPoints[1].focus();
  assert.match(element("#category-evolution-chart .line-tooltip").textContent, /2024-02.*Supermercado: \$0/);
  assert.deepEqual([...element("#category-evolution-chart").querySelectorAll("svg text")].map((tick) => tick.textContent),
    ["2024-01", "2024-03", "2024-05", "2024-07", "2024-09", "2024-12"]);
  const choices = [...window.document.querySelectorAll(".category-pie-choice")];
  const assertEvolutionColor = (choice) => {
    const color = choice.querySelector(".visualization-marker").style.backgroundColor;
    const chart = element("#category-evolution-chart");
    const normalizeColor = (value) => {
      const marker = window.document.createElement("span");
      marker.style.backgroundColor = value;
      return marker.style.backgroundColor;
    };
    assert.equal(chart.querySelector(".visualization-marker").style.backgroundColor, color);
    assert.equal(normalizeColor(chart.querySelector("polyline").getAttribute("stroke")), color);
    assert.equal(normalizeColor(chart.querySelector("circle").getAttribute("fill")), color);
  };
  assertEvolutionColor(choices[0]);
  choices[1].dispatchEvent(new window.MouseEvent("mouseenter"));
  assert.equal(element("#category-evolution-title").textContent, "Evolución: Sin categoría");
  assert.deepEqual([...element("#category-evolution-chart").querySelectorAll(".visualization-y-tick")]
    .map((tick) => tick.textContent), ["$40", "$30", "$20", "$10", "$0"]);
  assert.notEqual(choices[0].querySelector(".visualization-marker").style.backgroundColor,
    choices[1].querySelector(".visualization-marker").style.backgroundColor);
  assertEvolutionColor(choices[1]);
  assert.match(element("#category-evolution-values").textContent, /2024-11: \$40.*2024-12: \$25/);
  element("#category-evolution-chart").querySelectorAll(".visualization-point-target")[11].click();
  assert.match(element("#category-evolution-chart .line-tooltip").textContent, /2024-12.*Sin categoría: \$25/);
  element("#dashboard-period").value = "6";
  element("#dashboard-period").dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(element("#category-evolution-title").textContent, "Evolución: Sin categoría");
  assert.equal(element("#category-evolution-values").children.length, 6);
  assertEvolutionColor(element('.category-pie-choice[aria-pressed="true"]'));
  element("#dashboard-period").value = "12";
  element("#dashboard-period").dispatchEvent(new window.Event("change", { bubbles: true }));
  const historicalChoice = [...window.document.querySelectorAll(".category-pie-choice")]
    .find((button) => button.textContent.includes("Histórica"));
  assert.match(historicalChoice.textContent, /Sin gasto este mes/);
  historicalChoice.click();
  assert.equal(element("#category-evolution-title").textContent, "Evolución: Histórica");
  assertEvolutionColor(historicalChoice);
  assert.match(element("#category-evolution-values").textContent, /2024-02: \$15/);
  element("#category-evolution-chart").querySelectorAll(".visualization-point-target")[1].click();
  assert.match(element("#category-evolution-chart .line-tooltip").textContent, /2024-02.*Histórica: \$15/);
  data.dashboardCategories = [{ id: 9, name: "Histórica", month: "2024-11", amount: "15", fixed: false }];
  submit("#month-form");
  await waitFor(() => element("#dashboard-category-chart").textContent.includes("No hay gastos para el mes seleccionado")
    && !element("#dashboard-content").hidden);
  assert.match(element("#dashboard-category-chart").textContent, /Histórica.*Sin gasto este mes/);
  assert.equal(element("#category-evolution-title").textContent, "Evolución: Histórica");
  assertEvolutionColor(element('.category-pie-choice[aria-pressed="true"]'));
  assert.match(element("#category-evolution-values").textContent, /2024-11: \$15/);
  data.dashboardMonthly = null;
  data.dashboardCategories = null;
  element("#dashboard-period").value = "12";
  element("#month").value = initialMonth;
  submit("#month-form");
  await waitFor(() => !element("#dashboard-content").hidden
    && element("#dashboard-category-chart").textContent.includes("No hay gastos"));

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
  const chart = element("#dashboard-budget-chart");
  assert.deepEqual([...chart.querySelectorAll(".budget-plot-labels span")].map((item) => item.textContent),
    ["Cero con gasto", "Exceso", "Exceso mínimo", "Límite", "Alerta", "Bajo la alerta", "Normal", "Muy pequeño", "Cero sin gasto"]);
  const columns = [...chart.querySelectorAll(".budget-column-exceeded, .budget-column-within")];
  assert.deepEqual(columns.map((column) => column.getAttribute("class")),
    ["budget-column-exceeded", "budget-column-exceeded", "budget-column-exceeded",
     "budget-column-within", "budget-column-within", "budget-column-within",
     "budget-column-within", "budget-column-within", "budget-column-within"]);
  const descriptions = [...chart.querySelectorAll(".budget-bar-target")].map((target) => target.getAttribute("aria-label"));
  assert.match(descriptions[1], /150 %.*Presupuesto excedido/);
  assert.match(descriptions[2], />100 %.*Presupuesto excedido/);
  assert.match(descriptions[5], /79,99 %.*Dentro del presupuesto/);
  assert.match(descriptions[7], /<0,01 %/);
  assert.match(descriptions[0], /Cero con gasto.*Excedido: \$10/);
  assert.match(element("#dashboard-budget-chart").textContent, /Sin presupuesto.*Sin límite.*Gastado: \$20/);
  assert.equal(element("#dashboard-budgets"), null);
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

  element("#nav-categories").click();
  assert.equal(element("#month-form").hidden, false);
  assert.equal(element("#dashboard-view").hidden, true);
  element("#month").value = "2024-12";
  submit("#month-form");
  await waitFor(() => element("#budget-period").textContent === "Presupuestos del mes: 2024-12");
  assert.ok(requests.some((request) => request.path === "/api/presupuestos" && request.month === "2024-12"));
  element("#month").value = initialMonth;
  submit("#month-form");
  await waitFor(() => element("#budget-period").textContent === `Presupuestos del mes: ${initialMonth}`);
  const budgetInput = element('[aria-label="Presupuesto de Supermercado"]');
  budgetInput.value = "1700";
  budgetInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  element("#save-categories").click();
  await waitFor(() => element("#category-status").textContent === "Categorías actualizadas correctamente.");
  assert.ok(requests.some((request) => request.path === "/api/categorias/lote"
    && request.body.changes[0].budget.amount === "1700"));
  await waitFor(() => element("#dashboard-budget-chart .budget-bar-target")?.getAttribute("aria-label").includes("Límite: $1.700"));
  element("#nav-dashboard").click();
  assert.equal(element("#category-panel").hidden, true);
  assert.equal(element("#dashboard-view").hidden, false);
  assert.equal(element("#dashboard-pace-chart svg").querySelectorAll("polyline").length, 2);
  assert.equal(element("#dashboard-pace-chart .visualization-axis-x").textContent, "Día del mes");
  assert.equal(element("#dashboard-pace-chart .visualization-axis-y").textContent, "Monto (CLP)");
  assert.ok(element("#dashboard-pace").classList.contains("visually-hidden"));
  assert.equal([...window.document.querySelectorAll("summary")].some((item) => item.textContent === "Ver datos diarios"), false);
  const pacePoints = element("#dashboard-pace-chart").querySelectorAll(".visualization-point-target");
  assert.equal(pacePoints.length, 32);
  pacePoints[3].dispatchEvent(new window.MouseEvent("mouseenter"));
  const paceTooltip = element("#dashboard-pace-chart .line-tooltip");
  assert.match(paceTooltip.textContent, /Día 3.*Gasto acumulado: \$1.200.*Ritmo ideal: \$/);
  for (const value of paceTooltip.querySelectorAll("span")) {
    assert.ok(element("#dashboard-pace").children[2].textContent.includes(value.textContent));
  }
  assert.match(pacePoints[3].getAttribute("aria-label"), /Día 3.*Gasto acumulado: \$1.200.*Ritmo ideal: \$/);
  pacePoints[0].focus();
  assert.match(paceTooltip.textContent, /Día 0.*Gasto acumulado: \$0.*Ritmo ideal: \$0/);
  pacePoints[3].click();
  assert.match(paceTooltip.textContent, /Día 3.*Gasto acumulado: \$1.200/);
  pacePoints[19].click();
  assert.match(paceTooltip.textContent, /Día 3.*Gasto acumulado: \$1.200.*Ritmo ideal: \$/);
  for (const [spent, expected] of [["1360", "Alerta: 80 % o más"],
                                   ["1700", "Límite alcanzado"],
                                   ["1701", "Presupuesto excedido"]]) {
    data.expense.amount = spent;
    submit("#month-form");
    await waitFor(() => element("#dashboard-budget-chart .budget-bar-target")?.getAttribute("aria-label").includes(expected)
      && !element("#dashboard-content").hidden);
  }
  data.budget.amount = "0";
  submit("#month-form");
  await waitFor(() => element("#dashboard-budget-chart .budget-bar-target")?.getAttribute("aria-label").includes("Límite: $0")
    && element("#dashboard-budget-chart .budget-bar-target")?.getAttribute("aria-label").includes("Presupuesto excedido")
    && !element("#dashboard-content").hidden);
  data.budget.amount = "1700";
  data.expense.amount = "1200";
  submit("#month-form");
  await waitFor(() => element("#dashboard-budget-chart .budget-bar-target")?.getAttribute("aria-label").includes("Disponible: $500")
    && !element("#dashboard-content").hidden);
  element("#nav-categories").click();
  const editedBudget = element('[aria-label="Presupuesto de Supermercado"]');
  editedBudget.value = "2000";
  editedBudget.dispatchEvent(new window.Event("input", { bubbles: true }));
  setGlobal("confirm", () => false);
  element("#month").value = "2024-12";
  submit("#month-form");
  assert.equal(element("#month").value, initialMonth);
  assert.equal(editedBudget.value, "2000");
  setGlobal("confirm", () => true);
  field("#income-form", "merchant", "Ingreso anterior");
  field("#income-form", "amount", "200");
  field("#income-form", "date", "2023-01-01");
  field("#income-form", "accountId", "1");
  field("#income-form", "categoryId", "3");
  submit("#income-form");
  await waitFor(() => element("#income-form-message").textContent === "Ingreso registrado correctamente."
    && !element("#save-income").disabled);
  assert.equal(element("#month").value, initialMonth);
  assert.equal(element('[aria-label="Presupuesto de Supermercado"]').value, "2000");
  data.budget.amount = "1750";
  const budgetRequests = requests.filter((request) => request.path === "/api/presupuestos").length;
  submit("#month-form");
  await waitFor(() => requests.filter((request) => request.path === "/api/presupuestos").length > budgetRequests
    && element('[aria-label="Presupuesto de Supermercado"]')?.value === "2000");
  assert.equal(element("#save-categories").disabled, false);
  data.failCategorySave = true;
  element("#save-categories").click();
  await waitFor(() => element("#category-status").textContent === "No se pudo guardar.");
  assert.deepEqual(requests.filter((request) => request.path === "/api/categorias/lote").at(-1).body.changes[0].budget,
    { month: initialMonth, amount: "2000", expectedAmount: "1700.00" });
  data.failCategorySave = false;
  data.budget.amount = "1700";
  element('[aria-label="Archivar categoría Supermercado"]').click();
  assert.match(element("#category-status").textContent, /antes de archivar/);
  assert.ok(element('[aria-label="Archivar categoría Supermercado"]'));
  element("#month").value = "2024-12";
  submit("#month-form");
  await waitFor(() => element("#budget-period").textContent === "Presupuestos del mes: 2024-12");
  assert.equal(element('[aria-label="Presupuesto de Supermercado"]').value, "1700");
  element("#month").value = initialMonth;
  submit("#month-form");
  await waitFor(() => element("#budget-period").textContent === `Presupuestos del mes: ${initialMonth}`);
  data.budget.amount = "1700.50";
  submit("#month-form");
  await waitFor(() => element('[aria-label="Presupuesto de Supermercado"]')?.value === "1700.50");
  const historicalType = element('[aria-label="Tipo de Supermercado"]');
  historicalType.value = "true";
  historicalType.dispatchEvent(new window.Event("change", { bubbles: true }));
  element("#save-categories").click();
  await waitFor(() => element("#category-status").textContent === "Categorías actualizadas correctamente.");
  assert.equal(data.budget.amount, "1700.50");
  assert.ok(!requests.filter((request) => request.path === "/api/categorias/lote").at(-1).body.changes[0].budget);
  const deleteBudget = element('[aria-label="Presupuesto de Supermercado"]');
  deleteBudget.value = "";
  deleteBudget.dispatchEvent(new window.Event("input", { bubbles: true }));
  element("#save-categories").click();
  await waitFor(() => element("#category-status").textContent === "Categorías actualizadas correctamente.");
  assert.equal(data.budget, null);
  assert.deepEqual(requests.filter((request) => request.path === "/api/categorias/lote").at(-1).body.changes[0].budget,
    { month: initialMonth, amount: null, expectedAmount: "1700.50" });

  data.failExpenses = true;
  submit("#month-form");
  await waitFor(() => element("#message").textContent === "Gastos no disponibles.");
  element("#nav-categories").click();
  assert.equal(element("#dashboard-view").hidden, true);
  assert.equal(element("#category-panel").hidden, false);
  assert.equal(element("#budget-panel"), null);
  assert.equal(element("#message").hidden, false);
  assert.equal(element("#nav-categories").getAttribute("aria-current"), "page");
  assert.equal(element("#nav-dashboard").hasAttribute("aria-current"), false);
  data.failExpenses = false;
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
  const newBudget = element('[aria-label="Presupuesto de Mascotas"]');
  newBudget.value = "0";
  newBudget.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(data.categories[0].fixed, true);
  assert.equal(data.categories.length, 1);
  const savesBeforeFailure = requests.filter((request) => request.path === "/api/categorias/lote").length;
  const leaveWithChanges = new window.Event("beforeunload", { cancelable: true });
  assert.equal(window.dispatchEvent(leaveWithChanges), false);
  element("#nav-savings").click();
  assert.equal(element("#month-form").hidden, true);
  element("#nav-categories").click();
  assert.equal(element('[aria-label="Tipo de Supermercado"]').value, "true");
  assert.ok(element('[aria-label="Quitar categoría Mascotas"]'));
  data.failCategorySave = true;
  element("#save-categories").click();
  await waitFor(() => element("#category-status").textContent === "No se pudo guardar.");
  assert.ok(element('[aria-label="Quitar categoría Mascotas"]'));
  assert.equal(data.categories[0].fixed, true);
  assert.equal(requests.filter((request) => request.path === "/api/categorias/lote").length, savesBeforeFailure + 1);
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
  assert.equal(data.otherBudgets[7], "0");
  assert.ok(requests.some((request) => request.path === "/api/categorias/lote"
    && request.body.changes.some((change) => change.name === "Mascotas"
      && change.budget?.amount === "0" && change.budget.expectedAmount === null)));
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

  await waitFor(() => element('[aria-label="Desglose de gastos"]').textContent.includes("Fijos$1.200"));
  assert.deepEqual([...element('[aria-label="Desglose de gastos"]').querySelectorAll(".expense-breakdown-row")]
    .map((row) => row.textContent), ["Fijos$1.200", "Variables$0"]);

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
