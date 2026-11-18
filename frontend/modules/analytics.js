import { displayName, formatMoney, state } from "./common.js?v=6";
import { budgetChart, lineChart, donutChart, pieChart3D } from "./visualizations.js?v=6";

const status = document.querySelector("#dashboard-status");
const content = document.querySelector("#dashboard-content");
const period = document.querySelector("#dashboard-period");
const summary = document.querySelector("#dashboard-summary");
const budgetChartContainer = document.querySelector("#dashboard-budget-chart");
const trendList = document.querySelector("#dashboard-trend");
const trendChart = document.querySelector("#dashboard-trend-chart");
const categoryChart = document.querySelector("#dashboard-category-chart");
const categoryEvolutionTitle = document.querySelector("#category-evolution-title");
const categoryEvolutionChart = document.querySelector("#category-evolution-chart");
const categoryEvolutionValues = document.querySelector("#category-evolution-values");
const paceNote = document.querySelector("#dashboard-pace-note");
const paceList = document.querySelector("#dashboard-pace");
const paceChart = document.querySelector("#dashboard-pace-chart");
const fixedList = document.querySelector("#dashboard-fixed");
const fixedChart = document.querySelector("#dashboard-fixed-chart");
const recurringList = document.querySelector("#recurring-list");
const recurringStatus = document.querySelector("#recurring-status");
const recurringTotals = document.querySelector("#recurring-totals");
const recurringForm = document.querySelector("#recurring-form");
const saveRecurring = document.querySelector("#save-recurring");
const cancelRecurring = document.querySelector("#cancel-recurring");
const goalList = document.querySelector("#dashboard-goals");
const balanceList = document.querySelector("#dashboard-balances");
const balanceChart = document.querySelector("#dashboard-balance-chart");
const topList = document.querySelector("#dashboard-top");
const merchantsList = document.querySelector("#dashboard-merchants");

let requestId = 0;
let dashboardData = null;
let editingPayment = null;
let savingPayment = false;
let selectedCategoryKey = null;

function cents(value) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -result : result;
}

function money(value) {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  return formatMoney(`${negative ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`);
}

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function empty(list, message) {
  list.replaceChildren(node("li", message, "dashboard-empty"));
}

function bar(value, max, className = "") {
  const track = node("div", undefined, "dashboard-bar-track");
  const fill = node("div", undefined, `dashboard-bar ${className}`);
  const magnitude = value < 0n ? -value : value;
  fill.style.width = max > 0n ? `${Number((magnitude * 10000n) / max) / 100}%` : "0%";
  track.setAttribute("aria-hidden", "true");
  track.append(fill);
  return track;
}

function metric(title, value, comparison) {
  const item = node("article", undefined, "dashboard-metric");
  item.append(node("span", title), node("strong", value), node("small", comparison));
  return item;
}

function delta(current, previous) {
  const difference = cents(current) - cents(previous);
  return `${difference > 0n ? "+" : ""}${money(difference)} frente al mes anterior`;
}

function renderSummary(data) {
  const { current, previous } = data;
  const rate = current.savingRate === null ? "Sin ingresos" : `${current.savingRate.replace(".", ",")} %`;
  const previousRate = previous.savingRate === null ? "Sin ingresos el mes anterior"
    : `${previous.savingRate.replace(".", ",")} % el mes anterior`;
  summary.replaceChildren(
    metric("Ingresos", formatMoney(current.income), delta(current.income, previous.income)),
    metric("Gastos", formatMoney(current.expenses), delta(current.expenses, previous.expenses)),
    metric("Ahorro neto", formatMoney(current.saving), delta(current.saving, previous.saving)),
    metric("Tasa de ahorro", rate, previousRate),
  );
}

function renderBudgets(rows) {
  budgetChart(budgetChartContainer, [], money);
  if (!rows.length) {
    budgetChartContainer.append(node("p", "No hay categorías para este mes.", "dashboard-empty"));
    return;
  }
  const withLimit = rows.filter((row) => row.budget !== null);
  const withoutLimit = rows.filter((row) => row.budget === null);
  withLimit.sort((a, b) => {
    const aZero = cents(a.budget) === 0n;
    const bZero = cents(b.budget) === 0n;
    const rank = (row, zero) => zero ? (cents(row.spent) > 0n ? 2 : 0) : 1;
    const rankDifference = rank(b, bZero) - rank(a, aZero);
    if (rankDifference || aZero || bZero) return rankDifference;
    const difference = cents(a.spent) * cents(b.budget) - cents(b.spent) * cents(a.budget);
    return difference > 0n ? -1 : difference < 0n ? 1 : 0;
  });
  if (withLimit.length) {
    budgetChart(budgetChartContainer, withLimit.map((row) => {
      const limit = cents(row.budget);
      const spent = cents(row.spent);
      const difference = `${row.exceeded ? "Excedido" : "Disponible"}: ${formatMoney(row.difference)}`;
      const percent = limit > 0n ? `${budgetPercentage(spent, limit)} · ` : "";
      return {
        name: displayName(row.category) + (row.isActive === false ? " · Archivada" : ""),
        limit, spent,
        detail: [
          `Gastado: ${formatMoney(row.spent)}`,
          `Límite: ${formatMoney(row.budget)}`,
          difference,
          `${percent}${budgetLabel(budgetLevel(spent, limit))}`,
        ],
      };
    }), money);
  } else {
    budgetChartContainer.append(node("p", "No hay categorías con presupuesto.", "dashboard-empty"));
  }
  if (withoutLimit.length) {
    const section = node("section", undefined, "budget-chart-exceptions");
    const list = node("ul");
    section.append(node("h4", "Sin presupuesto"), list);
    for (const row of withoutLimit) {
      const name = displayName(row.category) + (row.isActive === false ? " · Archivada" : "");
      const item = node("li");
      item.append(node("strong", name), node("span", `Gastado: ${formatMoney(row.spent)}`));
      list.append(item);
    }
    budgetChartContainer.append(section);
  }
}

function budgetPercentage(spent, limit) {
  const hundredths = spent * 10000n / limit;
  const fraction = String(hundredths % 100n).padStart(2, "0").replace(/0+$/, "");
  if (spent > 0n && hundredths === 0n) return "<0,01 %";
  if (spent > limit && hundredths === 10000n) return ">100 %";
  return `${new Intl.NumberFormat("es-CL").format(hundredths / 100n)}${fraction ? `,${fraction}` : ""} %`;
}

function budgetLevel(spent, limit) {
  return limit === 0n ? (spent > 0n ? "exceeded" : "normal")
    : spent > limit ? "exceeded" : spent === limit ? "limit"
      : spent * 100n >= limit * 80n ? "warning" : "normal";
}

function budgetLabel(level) {
  return { normal: "Dentro del presupuesto", warning: "Alerta: 80 % o más",
           limit: "Límite alcanzado", exceeded: "Presupuesto excedido" }[level];
}

function renderTrend(data) {
  const rows = data.monthly.slice(-Number(period.value));
  lineChart(trendChart, rows.map((row) => row.month), [
    { name: "Ingresos", values: rows.map((row) => cents(row.income)) },
    { name: "Gastos", values: rows.map((row) => cents(row.expenses)) },
    { name: "Ahorro neto", values: rows.map((row) => cents(row.saving)) },
  ], money, { pointDetails: true });
  trendList.replaceChildren();
  for (const row of rows) {
    trendList.append(node("li", `${row.month}: Ingresos: ${formatMoney(row.income)} · Gastos: ${formatMoney(row.expenses)} · Ahorro neto: ${formatMoney(row.saving)}`));
  }
}

function renderCategories(data) {
  const months = data.monthly.slice(-Number(period.value)).map((row) => row.month);
  const groups = new Map();
  for (const row of data.categories) {
    if (!months.includes(row.month)) continue;
    const key = row.id === null ? "uncategorized" : String(row.id);
    if (!groups.has(key)) groups.set(key, { name: row.name, months: new Map() });
    groups.get(key).months.set(row.month, cents(row.amount));
  }
  const current = data.categories.filter((row) => row.month === data.month)
    .map((row) => ({
      key: row.id === null ? "uncategorized" : String(row.id),
      name: displayName(row.name), value: cents(row.amount),
    }));
  const currentKeys = new Set(current.map((entry) => entry.key));
  const historical = [...groups.entries()]
    .filter(([key]) => !currentKeys.has(key))
    .map(([key, group]) => ({ key, name: displayName(group.name), value: 0n }));
  lineChart(categoryEvolutionChart, [], [], money);
  categoryEvolutionValues.replaceChildren();
  categoryEvolutionTitle.textContent = "Evolución por categoría";
  pieChart3D(categoryChart, [...current, ...historical], money, (entry, color) => {
    selectedCategoryKey = entry.key;
    const group = groups.get(entry.key);
    const values = months.map((month) => group?.months.get(month) ?? 0n);
    categoryEvolutionTitle.textContent = `Evolución: ${entry.name}`;
    lineChart(categoryEvolutionChart, months, [{ name: entry.name, values, color }], money,
      { labelStep: Math.max(1, Math.ceil(months.length / 6)), pointDetails: true });
    categoryEvolutionValues.replaceChildren(...months.map((month, index) =>
      node("li", `${month}: ${money(values[index])}`)));
  }, selectedCategoryKey);
  if (!current.some((entry) => entry.value > 0n)) {
    categoryChart.append(node("p", "No hay gastos para el mes seleccionado.", "dashboard-empty"));
    if (!historical.length) {
      categoryEvolutionChart.append(node("p", "No hay categorías en el período para mostrar.", "dashboard-empty"));
    }
  }
}

function renderPace(data) {
  const budgets = data.budgets.filter((row) => row.budget !== null);
  paceList.replaceChildren();
  lineChart(paceChart, [], [], money);
  if (!budgets.length) {
    const unbudgeted = data.daily.reduce((sum, row) => sum + cents(row.unbudgeted), 0n);
    paceNote.textContent = `Configura al menos un presupuesto para comparar el ritmo. Gastos sin presupuesto hasta la fecha: ${money(unbudgeted)}.`;
    return;
  }
  const total = budgets.reduce((sum, row) => sum + cents(row.budget), 0n);
  const [year, month] = data.month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const currentMonth = data.today.slice(0, 7);
  const elapsed = data.month < currentMonth ? daysInMonth
    : data.month === currentMonth ? Number(data.today.slice(8, 10)) : 0;
  const byDay = new Map(data.daily.map((row) => [row.day, row]));
  let spent = 0n;
  let unbudgeted = 0n;
  const actual = [0n];
  const idealValues = [0n];
  for (let day = 1; day <= elapsed; day++) {
    const row = byDay.get(day);
    if (row) {
      spent += cents(row.budgeted);
      unbudgeted += cents(row.unbudgeted);
    }
    const ideal = total * BigInt(day) / BigInt(daysInMonth);
    actual.push(spent);
    idealValues.push(ideal);
    paceList.append(node("li", `Día ${day}: Gasto acumulado: ${money(spent)} · Ritmo ideal: ${money(ideal)}`));
  }
  paceNote.textContent = elapsed === 0 ? "El mes aún no comienza."
    : `Presupuesto total: ${money(total)} · Gastos sin presupuesto hasta la fecha: ${money(unbudgeted)}.`;
  if (elapsed) {
    const labels = actual.map((_, day) => day === 0 || day === elapsed || day % 5 === 0 ? String(day) : "");
    lineChart(paceChart, labels, [
      { name: "Gasto acumulado", values: actual },
      { name: "Ritmo ideal", values: idealValues },
    ], money, { xLabel: "Día del mes", pointDetails: true,
                pointLabels: actual.map((_, day) => `Día ${day}`) });
  }
}

function renderFixed(data) {
  const totals = { fixed: 0n, variable: 0n, unknown: 0n };
  for (const row of data.categories.filter((entry) => entry.month === data.month)) {
    totals[row.fixed === null ? "unknown" : row.fixed ? "fixed" : "variable"] += cents(row.amount);
  }
  fixedList.replaceChildren();
  const max = totals.fixed + totals.variable + totals.unknown;
  donutChart(fixedChart, [
    { name: "Fijos", value: totals.fixed },
    { name: "Variables", value: totals.variable },
    { name: "Sin clasificar", value: totals.unknown },
  ], money);
  for (const [label, value] of [["Fijos", totals.fixed], ["Variables", totals.variable], ["Sin clasificar", totals.unknown]]) {
    const item = node("li", undefined, "dashboard-chart-item");
    item.append(node("strong", `${label}: ${money(value)}`), bar(value, max));
    fixedList.append(item);
  }
}

function renderGoals(goals) {
  goalList.replaceChildren();
  if (!goals.length) return empty(goalList, "No hay metas de ahorro.");
  const messages = {
    achieved: "Meta alcanzada",
    insufficient: "Sin suficientes aportes para estimar una fecha",
    out_of_range: "La fecha estimada está fuera del rango disponible",
  };
  for (const goal of goals) {
    const estimate = goal.estimate.status === "estimated"
      ? `Fecha estimada: ${goal.estimate.date.split("-").reverse().join("/")}`
      : messages[goal.estimate.status];
    const item = node("li", undefined, "dashboard-chart-item");
    item.append(node("strong", goal.name),
      node("p", `Ahorrado: ${formatMoney(goal.saved)} de ${formatMoney(goal.target)} · ${estimate}`),
      bar(cents(goal.saved) > cents(goal.target) ? cents(goal.target) : cents(goal.saved), cents(goal.target)));
    goalList.append(item);
  }
}

function renderBalances(data) {
  const rows = data.balances.slice(-Number(period.value));
  lineChart(balanceChart, rows.map((row) => row.month),
    [{ name: "Saldo total", values: rows.map((row) => cents(row.balance)) }], money);
  const max = rows.map((row) => cents(row.balance)).reduce((value, amount) => {
    const magnitude = amount < 0n ? -amount : amount;
    return magnitude > value ? magnitude : value;
  }, 0n);
  balanceList.replaceChildren();
  for (const row of rows) {
    const item = node("li", undefined, "dashboard-chart-item");
    item.append(node("strong", `${row.month}: ${formatMoney(row.balance)}`),
      bar(cents(row.balance), max, cents(row.balance) < 0n ? "expense" : ""));
    balanceList.append(item);
  }
}

function renderTop(data) {
  topList.replaceChildren();
  if (!data.topExpenses.length) empty(topList, "No hay gastos para este mes.");
  const maxExpense = data.topExpenses.reduce((max, entry) => cents(entry.amount) > max ? cents(entry.amount) : max, 0n);
  for (const entry of data.topExpenses) {
    const item = node("li", `${entry.name} · ${entry.date.split("-").reverse().join("/")} · ${formatMoney(entry.amount)}`);
    item.append(bar(cents(entry.amount), maxExpense, "expense"));
    topList.append(item);
  }
  merchantsList.replaceChildren();
  if (!data.merchants.length) empty(merchantsList, "No hay comercios para este mes.");
  const maxMerchant = data.merchants.reduce((max, entry) => cents(entry.amount) > max ? cents(entry.amount) : max, 0n);
  for (const entry of data.merchants) {
    const item = node("li", `${entry.name} · ${entry.count} ${entry.count === 1 ? "gasto" : "gastos"} · ${formatMoney(entry.amount)}`);
    item.append(bar(cents(entry.amount), maxMerchant));
    merchantsList.append(item);
  }
}

function resetRecurringForm() {
  editingPayment = null;
  recurringForm.reset();
  saveRecurring.textContent = "Agregar pago";
  cancelRecurring.hidden = true;
}

function renderRecurring(payments) {
  recurringList.replaceChildren();
  let annual = 0n;
  if (!payments.length) empty(recurringList, "No hay pagos recurrentes registrados.");
  for (const payment of payments) {
    const amount = cents(payment.amount);
    const yearly = payment.frequency === "monthly" ? amount * 12n : amount;
    annual += yearly;
    const item = node("li", undefined, "dashboard-recurring");
    const detail = node("div");
    detail.append(node("strong", payment.name),
      node("p", `Mensual: ${money((yearly + 6n) / 12n)} · Anual: ${money(yearly)}${payment.frequency === "yearly" ? " · Promedio mensual" : ""}`));
    const edit = node("button", "Editar", "edit-button");
    edit.type = "button";
    edit.setAttribute("aria-label", `Editar pago recurrente ${payment.name}`);
    edit.addEventListener("click", () => {
      editingPayment = payment.id;
      recurringForm.elements.name.value = payment.name;
      recurringForm.elements.amount.value = payment.amount;
      recurringForm.elements.frequency.value = payment.frequency;
      saveRecurring.textContent = "Guardar cambios";
      cancelRecurring.hidden = false;
      recurringForm.elements.name.focus();
    });
    const remove = node("button", "Eliminar", "delete-button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Eliminar pago recurrente ${payment.name}`);
    remove.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar el pago recurrente "${payment.name}"?`)) return;
      remove.disabled = true;
      try {
        await request("/api/recurrentes", {
          method: "DELETE", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: payment.id }),
        });
        if (editingPayment === payment.id) resetRecurringForm();
        await refreshDashboard();
        recurringStatus.textContent = "Pago recurrente eliminado.";
      } catch (error) {
        recurringStatus.textContent = error instanceof Error ? error.message : "No se pudo eliminar el pago.";
      } finally {
        remove.disabled = false;
      }
    });
    item.append(detail, edit, remove);
    recurringList.append(item);
  }
  recurringTotals.textContent = `Total mensual aproximado: ${money((annual + 6n) / 12n)} · Total anual: ${money(annual)}.`;
}

async function request(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No fue posible consultar el dashboard.");
  return data;
}

export async function loadDashboard(month) {
  const current = ++requestId;
  status.textContent = "Cargando dashboard...";
  content.hidden = true;
  try {
    const [data, payments] = await Promise.all([
      request(`/api/dashboard?mes=${encodeURIComponent(month)}`),
      request("/api/recurrentes"),
    ]);
    if (current !== requestId) return;
    dashboardData = data;
    renderSummary(data);
    renderBudgets(data.budgets);
    renderTrend(data);
    renderCategories(data);
    renderPace(data);
    renderFixed(data);
    renderGoals(data.goals);
    renderBalances(data);
    renderTop(data);
    renderRecurring(payments.payments);
    content.hidden = false;
    status.textContent = "";
  } catch (error) {
    if (current !== requestId) return;
    dashboardData = null;
    status.textContent = error instanceof Error ? error.message : "No fue posible consultar el dashboard.";
  }
}

export async function refreshDashboard() {
  if (state.displayedBudgetMonth) await loadDashboard(state.displayedBudgetMonth);
}

period.addEventListener("change", () => {
  if (dashboardData) {
    renderTrend(dashboardData);
    renderCategories(dashboardData);
    renderBalances(dashboardData);
  }
});

recurringForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingPayment) return;
  savingPayment = true;
  saveRecurring.disabled = true;
  cancelRecurring.disabled = true;
  const values = new FormData(recurringForm);
  const body = { name: values.get("name"), amount: values.get("amount"), frequency: values.get("frequency") };
  if (editingPayment !== null) body.id = editingPayment;
  try {
    await request("/api/recurrentes", {
      method: editingPayment === null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    resetRecurringForm();
    await refreshDashboard();
    recurringStatus.textContent = "Pago recurrente guardado.";
  } catch (error) {
    recurringStatus.textContent = error instanceof Error ? error.message : "No se pudo guardar el pago.";
  } finally {
    savingPayment = false;
    saveRecurring.disabled = false;
    cancelRecurring.disabled = false;
  }
});

cancelRecurring.addEventListener("click", resetRecurringForm);
