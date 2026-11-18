import { displayName, formatMoney, state } from "./common.js?v=24";
import { budgetChart, horizontalBarChart, lineChart, pieChart3D } from "./visualizations.js?v=24";

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
const goalControls = document.querySelector("#goal-projection-controls");
const goalSelect = document.querySelector("#goal-projection-select");
const goalStatus = document.querySelector("#goal-projection-status");
const goalChart = document.querySelector("#goal-projection-chart");
const goalValues = document.querySelector("#goal-projection-values");
const balanceList = document.querySelector("#dashboard-balances");
const balanceChart = document.querySelector("#dashboard-balance-chart");
const topChart = document.querySelector("#dashboard-top-chart");

let requestId = 0;
let dashboardData = null;
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
  const totals = { fixed: 0n, variable: 0n, unknown: 0n };
  for (const row of data.categories.filter((entry) => entry.month === data.month)) {
    totals[row.fixed === null ? "unknown" : row.fixed ? "fixed" : "variable"] += cents(row.amount);
  }
  const expenses = metric("Gastos", formatMoney(current.expenses), delta(current.expenses, previous.expenses));
  const breakdown = node("dl", undefined, "expense-breakdown");
  breakdown.setAttribute("aria-label", "Desglose de gastos");
  const entries = [["Fijos", totals.fixed], ["Variables", totals.variable]];
  if (totals.unknown !== 0n) entries.push(["Sin clasificar", totals.unknown]);
  for (const [label, value] of entries) {
    const row = node("div", undefined, "expense-breakdown-row");
    row.append(node("dt", label), node("dd", money(value)));
    breakdown.append(row);
  }
  expenses.insertBefore(breakdown, expenses.querySelector("small"));
  summary.replaceChildren(
    metric("Ingresos", formatMoney(current.income), delta(current.income, previous.income)),
    expenses,
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

function projectionDate(today, offset) {
  const [year, month, day] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}

function renderSelectedGoal(data) {
  const goal = data.goals.find((item) => item.estimate.status !== "achieved" && String(item.id) === goalSelect.value);
  lineChart(goalChart, [], [], money);
  goalValues.replaceChildren();
  if (!goal) {
    goalStatus.textContent = data.goals.length ? "No hay metas de ahorro pendientes." : "No hay metas de ahorro.";
    return;
  }
  const messages = {
    insufficient: "Sin suficientes aportes para estimar una fecha",
    out_of_range: "La fecha estimada está fuera del rango disponible",
  };
  const estimate = goal.estimate.status === "estimated"
    ? `Fecha estimada: ${goal.estimate.date.split("-").reverse().join("/")}`
    : messages[goal.estimate.status];
  goalStatus.textContent = `Ahorrado: ${formatMoney(goal.saved)} de ${formatMoney(goal.target)} · ${estimate}.`;
  if (goal.estimate.status !== "estimated") return;

  const [year, month] = data.today.split("-").map(Number);
  const [endYear, endMonth] = goal.estimate.date.split("-").map(Number);
  const months = (endYear - year) * 12 + endMonth - month;
  const count = Math.min(months + 1, 13);
  const offsets = Array.from({ length: count }, (_, index) => Math.round(index * months / (count - 1)));
  const dates = offsets.map((offset) => projectionDate(data.today, offset));
  const target = cents(goal.target);
  const saved = cents(goal.saved);
  const recent = cents(goal.recent);
  const projected = offsets.map((offset) => {
    const value = saved + recent * BigInt(offset) / 3n;
    return value > target ? target : value;
  });
  const labels = dates.map((date) => date.split("-").reverse().join("/"));
  lineChart(goalChart, labels, [
    { name: "Proyección", values: projected, dash: "8 4" },
    { name: "Meta", values: offsets.map(() => target), dash: "2 4" },
  ], money, { xLabel: "Fecha", pointDetails: true, xValues: offsets,
    labelStep: Math.max(1, Math.ceil((count - 1) / 3)) });
  for (const [index, label] of labels.entries()) {
    goalValues.append(node("li", `${label}: Proyección: ${money(projected[index])} · Meta: ${money(target)}`));
  }
}

function renderGoals(data) {
  const selected = goalSelect.value;
  const pending = data.goals.filter((goal) => goal.estimate.status !== "achieved");
  goalSelect.replaceChildren(...pending.map((goal) => new Option(goal.name, String(goal.id))));
  if (pending.some((goal) => String(goal.id) === selected)) goalSelect.value = selected;
  goalControls.hidden = !pending.length;
  renderSelectedGoal(data);
}

function renderBalances(data) {
  const rows = data.balances.slice(-Number(period.value));
  const accounts = new Map();
  for (const row of rows) {
    for (const account of row.accounts) accounts.set(account.id, account.name);
  }
  const series = [
    { name: "Saldo total", values: rows.map((row) => cents(row.balance)) },
    ...[...accounts].map(([id, name]) => ({
      name, values: rows.map((row) => {
        const account = row.accounts.find((entry) => entry.id === id);
        return account && account.balance !== null ? cents(account.balance) : null;
      }),
    })),
  ];
  lineChart(balanceChart, rows.map((row) => row.month), series, money, { pointDetails: true });
  balanceList.replaceChildren();
  for (const [index, row] of rows.entries()) {
    const details = series.map((entry) => `${entry.name}: ${entry.values[index] === null ? "Sin datos" : money(entry.values[index])}`);
    balanceList.append(node("li", `${row.month}: ${details.join(" · ")}`));
  }
}

function renderTop(data) {
  horizontalBarChart(topChart, data.topExpenses.map((entry) => ({
    name: entry.name, value: cents(entry.amount),
    detail: [`Fecha: ${entry.date.split("-").reverse().join("/")}`, `Monto: ${formatMoney(entry.amount)}`],
  })), money);
  if (!data.topExpenses.length) topChart.append(node("p", "No hay gastos para este mes.", "dashboard-empty"));
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
    const data = await request(`/api/dashboard?mes=${encodeURIComponent(month)}`);
    if (current !== requestId) return;
    dashboardData = data;
    renderSummary(data);
    renderBudgets(data.budgets);
    renderTrend(data);
    renderCategories(data);
    renderPace(data);
    renderGoals(data);
    renderBalances(data);
    renderTop(data);
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

goalSelect.addEventListener("change", () => {
  if (dashboardData) renderSelectedGoal(dashboardData);
});
