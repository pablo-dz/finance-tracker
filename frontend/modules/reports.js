import {
  reportPeriod, displayName, formatMoney, moneyInCents,
  state,
} from "./common.js";

const reportStatus = document.querySelector("#report-status");
const reportMonthly = document.querySelector("#report-monthly");
const reportCategories = document.querySelector("#report-categories");

const monthFormatter = new Intl.DateTimeFormat("es-CL", { month: "short", year: "numeric", timeZone: "UTC" });

function appendReportBar(list, label, amount, maximum) {
  const item = document.createElement("li");
  const detail = document.createElement("div");
  const name = document.createElement("span");
  const value = document.createElement("strong");
  const track = document.createElement("div");
  const bar = document.createElement("div");
  const cents = moneyInCents(amount);
  const maxCents = moneyInCents(maximum);
  const width = maxCents > 0n && cents > 0n
    ? Math.max(0.5, Number((cents * 10000n) / maxCents) / 100)
    : 0;
  item.className = "report-item";
  detail.className = "report-detail";
  name.textContent = label;
  value.textContent = formatMoney(amount);
  detail.append(name, value);
  track.className = "chart-track";
  track.setAttribute("aria-hidden", "true");
  bar.className = "report-bar";
  bar.style.width = `${width}%`;
  track.append(bar);
  item.append(detail, track);
  list.append(item);
}

export async function loadPersonalReport(month) {
  const requestId = ++state.reportRequest;
  reportStatus.textContent = "Cargando reporte...";
  reportMonthly.replaceChildren();
  reportCategories.replaceChildren();
  try {
    const months = reportPeriod.value;
    const response = await fetch(`/api/reportes?mes=${encodeURIComponent(month)}&meses=${encodeURIComponent(months)}`);
    const data = await response.json();
    if (requestId !== state.reportRequest) return false;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar el reporte personal.");

    document.querySelector("#report-total").textContent = formatMoney(data.total);
    document.querySelector("#report-average").textContent = formatMoney(data.average);
    const maxMonthly = data.monthly.reduce((maximum, entry) =>
      moneyInCents(entry.total) > moneyInCents(maximum) ? entry.total : maximum, "0");
    for (const entry of data.monthly) {
      const monthDate = new Date(`${entry.month}-01T00:00:00Z`);
      appendReportBar(reportMonthly, monthFormatter.format(monthDate), entry.total, maxMonthly);
    }

    const maxCategory = data.categories.reduce((maximum, entry) =>
      moneyInCents(entry.total) > moneyInCents(maximum) ? entry.total : maximum, "0");
    for (const entry of data.categories) {
      appendReportBar(reportCategories, displayName(entry.category), entry.total, maxCategory);
    }
    document.querySelector("#report-empty").hidden = data.categories.length > 0;
    reportStatus.textContent = "";
    return true;
  } catch (error) {
    if (requestId !== state.reportRequest) return false;
    reportStatus.textContent = error instanceof Error ? error.message : "No fue posible consultar el reporte personal.";
    return false;
  }
}
