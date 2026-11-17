import {
  monthInput, movementStatus, expenseForm, formMessage,
  saveButton, budgetPanel, displayName, todayText,
  formatMoney, state,
} from "./common.js";
import { loadMovements, refreshAccounts } from "./movements.js";
import { updateBudgetForm, loadBudgets, loadCategories } from "./planning.js";
import { loadSavingsGoals } from "./savings.js";
import { loadPersonalReport } from "./reports.js";
import { expenseShare } from "../chart.js";

const message = document.querySelector("#message");
const results = document.querySelector("#results");
const list = document.querySelector("#categories");
const movements = document.querySelector("#movements");
const cancelEditButton = document.querySelector("#cancel-edit");
const incomeMovementsPanel = document.querySelector("#income-movements-panel");
const savingsPanel = document.querySelector("#savings-panel");
const categoryPanel = document.querySelector("#category-panel");
const reportPanel = document.querySelector("#report-panel");

let currentRequest = 0;
let editingId = null;
let deleting = false;

function resetExpenseForm() {
  editingId = null;
  expenseForm.reset();
  expenseForm.elements.date.value = todayText;
  document.querySelector("#form-title").textContent = "Registrar gasto";
  saveButton.textContent = "Guardar gasto";
  cancelEditButton.hidden = true;
}

function editExpense(expense) {
  if (deleting) {
    movementStatus.textContent = "Espera a que termine la eliminación.";
    return;
  }
  if (saveButton.disabled) {
    formMessage.textContent = "Espera a que el formulario esté disponible para editar.";
    return;
  }
  const [whole, fraction = ""] = expense.amount.split(".");
  if (/[^0]/.test(fraction)) {
    formMessage.textContent = "Este gasto tiene centavos; la edición solo admite pesos enteros.";
    document.querySelector("#registration").scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (editingId !== null && !confirm("Hay una edición en curso. ¿Descartar esos cambios?")) return;
  editingId = expense.id;
  expenseForm.elements.merchant.value = expense.merchant ?? "";
  expenseForm.elements.amount.value = whole;
  expenseForm.elements.date.value = expense.date;
  expenseForm.elements.categoryId.value = String(expense.categoryId ?? "");
  expenseForm.elements.accountId.value = String(expense.accountId);
  document.querySelector("#form-title").textContent = "Editar gasto";
  saveButton.textContent = "Guardar cambios";
  cancelEditButton.hidden = false;
  formMessage.textContent = expense.merchant && expenseForm.elements.categoryId.value && expenseForm.elements.accountId.value
    ? "Editando un gasto personal."
    : "Completa la descripción y selecciona una cuenta y categoría disponibles.";
  document.querySelector("#registration").scrollIntoView({ behavior: "smooth" });
  expenseForm.elements.merchant.focus();
}

async function deleteExpense(expense, button) {
  if (state.saving || deleting) {
    movementStatus.textContent = "Espera a que termine la operación en curso.";
    return;
  }
  const date = expense.date.split("-").reverse().join("/");
  const editWarning = editingId === expense.id ? " También se descartará la edición en curso." : "";
  if (!confirm(`¿Eliminar "${expense.description}" del ${date} por ${formatMoney(expense.amount)}? Esta acción no se puede deshacer.${editWarning}`)) return;
  deleting = true;
  button.disabled = true;
  movementStatus.textContent = "Eliminando gasto...";
  try {
    let response;
    let data;
    try {
      response = await fetch("/api/gastos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: expense.id }),
      });
      data = await response.json();
    } catch {
      throw new Error("No se pudo confirmar la eliminación. Actualiza la lista antes de intentarlo de nuevo.");
    }
    if (!response.ok) throw new Error(data.error || "No fue posible eliminar el gasto.");
    if (editingId === expense.id) {
      resetExpenseForm();
      formMessage.textContent = "La edición se canceló porque el gasto fue eliminado.";
    }
    const refreshed = await loadExpenses();
    await refreshAccounts();
    movementStatus.textContent = refreshed
      ? "Gasto eliminado correctamente."
      : "Gasto eliminado, pero no se pudo actualizar la lista. Vuelve a consultar.";
  } catch (error) {
    movementStatus.textContent = error instanceof Error ? error.message : "No fue posible eliminar el gasto.";
  } finally {
    deleting = false;
    button.disabled = false;
  }
}

export async function loadExpenses() {
  const requestId = ++currentRequest;
  ++state.reportRequest;
  const month = monthInput.value;
  ++state.budgetRequest;
  state.budgetMonth = null;
  state.displayedBudgetMonth = null;
  budgetPanel.hidden = false;
  categoryPanel.hidden = false;
  incomeMovementsPanel.hidden = false;
  document.querySelector("#accounts-panel").hidden = false;
  document.querySelector("#income-card").hidden = false;
  savingsPanel.hidden = false;
  reportPanel.hidden = false;
  updateBudgetForm();
  results.hidden = true;
  message.textContent = "Cargando gastos...";
  try {
    const response = await fetch(`/api/gastos?mes=${encodeURIComponent(month)}`);
    const data = await response.json();
    if (requestId !== currentRequest) return false;
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
      const actions = document.createElement("div");
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
      actions.className = "movement-actions";
      actions.append(amount);
      if (expense.editable) {
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "edit-button";
        editButton.textContent = "Editar";
        editButton.setAttribute("aria-label", `Editar ${expense.description}`);
        editButton.addEventListener("click", () => editExpense(expense));
        actions.append(editButton);
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "delete-button";
        deleteButton.textContent = "Eliminar";
        deleteButton.setAttribute("aria-label", `Eliminar ${expense.description} del ${expense.date.split("-").reverse().join("/")} por ${formatMoney(expense.amount)}`);
        deleteButton.addEventListener("click", () => deleteExpense(expense, deleteButton));
        actions.append(deleteButton);
      }
      item.append(detail, actions);
      movements.append(item);
    }
    document.querySelector("#movements-empty").hidden = data.expenses.length !== 0;
    message.textContent = "";
    results.hidden = false;
    state.displayedBudgetMonth = month;
    await Promise.all([
      loadMovements(month),
      loadBudgets(month),
      loadSavingsGoals(),
      loadPersonalReport(month),
      loadCategories(),
    ]);
    if (requestId !== currentRequest) return false;
    return true;
  } catch (error) {
    if (requestId !== currentRequest) return false;
    message.textContent = error instanceof Error ? error.message : "No fue posible consultar los gastos.";
    return false;
  }
}

expenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (deleting) {
    formMessage.textContent = "Espera a que termine la eliminación.";
    return;
  }
  const values = new FormData(expenseForm);
  const expense = {
    merchant: values.get("merchant"),
    amount: values.get("amount"),
    date: values.get("date"),
    categoryId: Number(values.get("categoryId")),
    accountId: Number(values.get("accountId")),
  };
  const isEditing = editingId !== null;
  if (isEditing) expense.id = editingId;
  saveButton.disabled = true;
  state.saving = true;
  cancelEditButton.disabled = true;
  formMessage.textContent = "Guardando gasto...";
  try {
    let response;
    try {
      response = await fetch("/api/gastos", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expense),
      });
    } catch {
      throw new Error("No se pudo confirmar el registro. Revisa tus gastos antes de intentarlo de nuevo.");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible guardar el gasto.");
    resetExpenseForm();
    formMessage.textContent = isEditing ? "Gasto actualizado correctamente." : "Gasto registrado correctamente.";
    movementStatus.textContent = "";
    monthInput.value = expense.date.slice(0, 7);
    await loadExpenses();
    await refreshAccounts();
  } catch (error) {
    formMessage.textContent = error instanceof Error ? error.message : "No fue posible guardar el gasto.";
  } finally {
    saveButton.disabled = false;
    state.saving = false;
    cancelEditButton.disabled = false;
  }
});

cancelEditButton.addEventListener("click", () => {
  resetExpenseForm();
  formMessage.textContent = "Edición cancelada.";
});
