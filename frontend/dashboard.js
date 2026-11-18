import {
  monthInput, movementStatus, expenseForm,
  todayText, state,
} from "./modules/common.js?v=10";
import { initializeAuthentication } from "./modules/auth.js?v=10";
import { loadExpenses } from "./modules/expenses.js?v=10";
import { prepareBudgetMonth } from "./modules/planning.js?v=10";

const form = document.querySelector("#month-form");
const views = [
  [document.querySelector("#nav-dashboard"), document.querySelector("#dashboard-view")],
  [document.querySelector("#nav-movements"), document.querySelector("#movements-view")],
  [document.querySelector("#nav-savings"), document.querySelector("#savings-panel")],
  [document.querySelector("#nav-categories"), document.querySelector("#category-panel")],
];

function showView(selected) {
  for (const [button, view] of views) {
    view.hidden = button !== selected;
    if (button === selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  form.hidden = selected.id === "nav-savings" || selected.id === "nav-movements";
  document.querySelector("#message").hidden = form.hidden;
}

for (const [button] of views) button.addEventListener("click", () => showView(button));

monthInput.value = todayText.slice(0, 7);
expenseForm.elements.date.value = todayText;
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const previousMonth = state.budgetMonth || state.displayedBudgetMonth;
  if (!prepareBudgetMonth(monthInput.value)) {
    if (previousMonth) monthInput.value = previousMonth;
    return;
  }
  movementStatus.textContent = "";
  loadExpenses(monthInput.value);
});
initializeAuthentication();
