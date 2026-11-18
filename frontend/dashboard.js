import {
  monthInput, movementStatus, expenseForm, reportPeriod,
  todayText,
} from "./modules/common.js";
import { initializeAuthentication } from "./modules/auth.js";
import { loadExpenses } from "./modules/expenses.js";
import { loadPersonalReport } from "./modules/reports.js";

const form = document.querySelector("#month-form");
const views = [
  [document.querySelector("#nav-dashboard"), document.querySelector("#dashboard-view")],
  [document.querySelector("#nav-savings"), document.querySelector("#savings-panel")],
  [document.querySelector("#nav-categories"), document.querySelector("#category-panel")],
];

function showView(selected) {
  for (const [button, view] of views) {
    view.hidden = button !== selected;
    if (button === selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

for (const [button] of views) button.addEventListener("click", () => showView(button));

monthInput.value = todayText.slice(0, 7);
expenseForm.elements.date.value = todayText;
form.addEventListener("submit", (event) => {
  event.preventDefault();
  movementStatus.textContent = "";
  loadExpenses();
});
reportPeriod.addEventListener("change", () => {
  loadPersonalReport(monthInput.value);
});
initializeAuthentication();
