export const monthInput = document.querySelector("#month");
export const movementStatus = document.querySelector("#movement-status");
export const expenseForm = document.querySelector("#expense-form");
export const formMessage = document.querySelector("#form-message");
export const saveButton = document.querySelector("#save-expense");
export const incomeFormMessage = document.querySelector("#income-form-message");
export const transferFormMessage = document.querySelector("#transfer-form-message");
const formatter = new Intl.NumberFormat("es-CL");
const labels = {
  Rent: "Arriendo", Utilities: "Servicios", Groceries: "Supermercado",
  Transport: "Transporte", "Dining out": "Comidas fuera", Subscriptions: "Suscripciones",
  Health: "Salud", Leisure: "Ocio",
};
export const displayName = (name) => Object.hasOwn(labels, name) ? labels[name] : name;
const today = new Date();
export const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

export function formatMoney(value) {
  const [whole, fraction = ""] = value.split(".");
  const decimals = fraction.replace(/0+$/, "");
  const formattedWhole = formatter.format(BigInt(whole));
  return `${whole.startsWith("-") ? "-" : ""}$${formattedWhole.replace("-", "")}${decimals ? `,${decimals}` : ""}`;
}

export function moneyInCents(value) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function formatCents(value) {
  const whole = value / 100n;
  const fraction = String(value % 100n).padStart(2, "0");
  return formatMoney(`${whole}.${fraction}`);
}
export const state = {
  saving: false,
  budgetRequest: 0,
  budgetMonth: null,
  displayedBudgetMonth: null,
};
