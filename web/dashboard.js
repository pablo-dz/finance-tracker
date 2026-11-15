import { expenseShare } from "./chart.js";

const form = document.querySelector("#month-form");
const monthInput = document.querySelector("#month");
const viewInput = document.querySelector("#view");
const message = document.querySelector("#message");
const results = document.querySelector("#results");
const list = document.querySelector("#categories");
const movements = document.querySelector("#movements");
const expenseForm = document.querySelector("#expense-form");
const formMessage = document.querySelector("#form-message");
const saveButton = document.querySelector("#save-expense");
const formatter = new Intl.NumberFormat("es-CL");
const labels = {
  Rent: "Arriendo", Utilities: "Servicios", Groceries: "Supermercado",
  Transport: "Transporte", "Dining out": "Comidas fuera", Subscriptions: "Suscripciones",
  Health: "Salud", Leisure: "Ocio",
};
const displayName = (name) => Object.hasOwn(labels, name) ? labels[name] : name;
const today = new Date();
const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
monthInput.value = todayText.slice(0, 7);
expenseForm.elements.date.value = todayText;
let currentRequest = 0;
let viewTouched = false;

function formatMoney(value) {
  const [whole, fraction = ""] = value.split(".");
  const decimals = fraction.replace(/0+$/, "");
  return `$${formatter.format(BigInt(whole))}${decimals ? `,${decimals}` : ""}`;
}

async function loadExpenses() {
  const requestId = ++currentRequest;
  const month = monthInput.value;
  const view = viewInput.value;
  document.querySelector("#registration").hidden = view !== "personal";
  document.querySelector("#notice").textContent = view === "demo"
    ? "Vista de prueba: estos datos son ficticios y están separados de tu hogar personal."
    : "Hogar personal: los gastos que registres aquí son reales. La aplicación es local y no tiene autenticación.";
  results.hidden = true;
  message.textContent = "Cargando gastos...";
  try {
    const response = await fetch(`/api/gastos?mes=${encodeURIComponent(month)}&vista=${view}`);
    const data = await response.json();
    if (requestId !== currentRequest) return;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar los gastos.");

    list.replaceChildren();
    let count = 0;
    for (const category of data.categories) {
      count += category.count;
      const share = expenseShare(category.total, data.total);
      const item = document.createElement("li");
      const detail = document.createElement("div");
      const name = document.createElement("span");
      const value = document.createElement("strong");
      const percent = document.createElement("span");
      const track = document.createElement("div");
      const bar = document.createElement("div");
      name.textContent = displayName(category.category);
      value.textContent = formatMoney(category.total);
      percent.textContent = ` · ${share.label}`;
      percent.className = "category-percent";
      value.append(percent);
      detail.className = "category-detail";
      detail.append(name, value);
      track.className = "chart-track";
      track.setAttribute("aria-hidden", "true");
      bar.className = "chart-bar";
      bar.style.width = `${share.width}%`;
      track.append(bar);
      item.append(detail, track);
      list.append(item);
    }
    document.querySelector("#total").textContent = formatMoney(data.total);
    document.querySelector("#count").textContent = String(count);
    document.querySelector("#empty").hidden = data.categories.length !== 0;
    movements.replaceChildren();
    for (const expense of data.expenses) {
      const item = document.createElement("li");
      const detail = document.createElement("div");
      const description = document.createElement("strong");
      const metadata = document.createElement("div");
      const date = document.createElement("time");
      const category = document.createElement("span");
      const amount = document.createElement("strong");
      item.className = "movement";
      detail.className = "movement-detail";
      metadata.className = "movement-meta";
      description.textContent = expense.description;
      date.dateTime = expense.date;
      date.textContent = expense.date.split("-").reverse().join("/");
      category.textContent = displayName(expense.category);
      metadata.append(date, document.createTextNode(" · "), category);
      detail.append(description, metadata);
      amount.textContent = formatMoney(expense.amount);
      amount.className = "movement-amount";
      item.append(detail, amount);
      movements.append(item);
    }
    document.querySelector("#movements-empty").hidden = data.expenses.length !== 0;
    message.textContent = "";
    results.hidden = false;
  } catch (error) {
    if (requestId !== currentRequest) return;
    message.textContent = error instanceof Error ? error.message : "No fue posible consultar los gastos.";
  }
}

async function loadOptions() {
  try {
    const response = await fetch("/api/opciones");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible cargar el formulario.");
    for (const [field, values] of [["accountId", data.accounts], ["categoryId", data.categories]]) {
      const select = expenseForm.elements[field];
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value.id;
        option.textContent = displayName(value.name);
        select.append(option);
      }
    }
    if (!data.accounts.length || !data.categories.length) {
      throw new Error("El hogar necesita una cuenta activa en CLP y categorías de gastos.");
    }
    saveButton.disabled = false;
    if (!viewTouched) {
      viewInput.value = "personal";
      loadExpenses();
    }
  } catch (error) {
    formMessage.textContent = error instanceof Error ? error.message : "No fue posible cargar el formulario.";
  }
}

expenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(expenseForm);
  const expense = {
    merchant: values.get("merchant"),
    amount: values.get("amount"),
    date: values.get("date"),
    categoryId: Number(values.get("categoryId")),
    accountId: Number(values.get("accountId")),
  };
  saveButton.disabled = true;
  formMessage.textContent = "Guardando gasto...";
  try {
    let response;
    try {
      response = await fetch("/api/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expense),
      });
    } catch {
      throw new Error("No se pudo confirmar el registro. Revisa tus gastos antes de intentarlo de nuevo.");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible guardar el gasto.");
    expenseForm.reset();
    expenseForm.elements.date.value = todayText;
    formMessage.textContent = "Gasto registrado correctamente.";
    monthInput.value = expense.date.slice(0, 7);
    viewInput.value = "personal";
    await loadExpenses();
  } catch (error) {
    formMessage.textContent = error instanceof Error ? error.message : "No fue posible guardar el gasto.";
  } finally {
    saveButton.disabled = false;
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  viewTouched = true;
  loadExpenses();
});
viewInput.addEventListener("change", () => {
  viewTouched = true;
  loadExpenses();
});
loadExpenses();
loadOptions();
