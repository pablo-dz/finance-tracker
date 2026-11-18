import {
  monthInput, movementStatus, expenseForm, formMessage,
  saveButton, todayText,
  formatMoney, state,
} from "./common.js?v=19";
import { loadMovementHistory, refreshAccounts } from "./movements.js?v=19";
import { beginBudgetLoad, budgetLoadFailed, loadBudgets, selectMovementMonth } from "./planning.js?v=19";
import { loadDashboard } from "./analytics.js?v=19";

const message = document.querySelector("#message");
const results = document.querySelector("#results");
const cancelEditButton = document.querySelector("#cancel-edit");

let currentRequest = 0;
let editingId = null;
let deleting = false;

function resetExpenseForm() {
  editingId = null;
  expenseForm.reset();
  expenseForm.elements.date.value = todayText;
  document.querySelector("#form-title").textContent = "Registrar egreso";
  saveButton.textContent = "Guardar gasto";
  cancelEditButton.hidden = true;
}

export function editExpense(expense) {
  document.querySelector("#registration").open = true;
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
  document.querySelector("#form-title").textContent = "Editar egreso";
  saveButton.textContent = "Guardar cambios";
  cancelEditButton.hidden = false;
  formMessage.textContent = expense.merchant && expenseForm.elements.categoryId.value && expenseForm.elements.accountId.value
    ? "Editando un gasto personal."
    : "Completa la descripción y selecciona una cuenta y categoría disponibles.";
  document.querySelector("#registration").scrollIntoView({ behavior: "smooth" });
  expenseForm.elements.merchant.focus();
}

export async function deleteExpense(expense, button) {
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

export async function loadExpenses(month = state.displayedBudgetMonth || state.budgetMonth || monthInput.value) {
  const requestId = ++currentRequest;
  const historyRequest = loadMovementHistory();
  beginBudgetLoad(month);
  state.displayedBudgetMonth = null;
  results.hidden = true;
  message.textContent = "Cargando gastos...";
  try {
    const response = await fetch(`/api/gastos?mes=${encodeURIComponent(month)}`);
    const data = await response.json();
    if (requestId !== currentRequest) return false;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar los gastos.");

    message.textContent = "";
    results.hidden = false;
    state.displayedBudgetMonth = month;
    const [budgetsLoaded, historyLoaded] = await Promise.all([
      loadBudgets(month),
      historyRequest,
      loadDashboard(month),
    ]);
    if (requestId !== currentRequest) return false;
    return budgetsLoaded && historyLoaded;
  } catch (error) {
    if (requestId !== currentRequest) return false;
    message.textContent = error instanceof Error ? error.message : "No fue posible consultar los gastos.";
    budgetLoadFailed(month);
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
    selectMovementMonth(expense.date.slice(0, 7));
    await loadExpenses(monthInput.value);
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
