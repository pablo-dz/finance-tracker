import {
  monthInput, movementStatus, expenseForm, reportPeriod,
  todayText,
} from "./modules/common.js";
import { initializeAuthentication } from "./modules/auth.js";
import { loadExpenses } from "./modules/expenses.js";
import { loadPersonalReport } from "./modules/reports.js";

const form = document.querySelector("#month-form");

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
