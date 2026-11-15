import { expenseShare } from "./chart.js";

const form = document.querySelector("#month-form");
const monthInput = document.querySelector("#month");
const viewInput = document.querySelector("#view");
const message = document.querySelector("#message");
const results = document.querySelector("#results");
const list = document.querySelector("#categories");
const movements = document.querySelector("#movements");
const movementStatus = document.querySelector("#movement-status");
const expenseForm = document.querySelector("#expense-form");
const formMessage = document.querySelector("#form-message");
const saveButton = document.querySelector("#save-expense");
const cancelEditButton = document.querySelector("#cancel-edit");
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
let editingId = null;
let saving = false;
let deleting = false;

function formatMoney(value) {
  const [whole, fraction = ""] = value.split(".");
  const decimals = fraction.replace(/0+$/, "");
  return `$${formatter.format(BigInt(whole))}${decimals ? `,${decimals}` : ""}`;
}

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
  if (saving || deleting) {
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
      if (view === "personal" && expense.editable) {
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
    return true;
  } catch (error) {
    if (requestId !== currentRequest) return false;
    message.textContent = error instanceof Error ? error.message : "No fue posible consultar los gastos.";
    return false;
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
  saving = true;
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
    viewInput.value = "personal";
    await loadExpenses();
  } catch (error) {
    formMessage.textContent = error instanceof Error ? error.message : "No fue posible guardar el gasto.";
  } finally {
    saveButton.disabled = false;
    saving = false;
    cancelEditButton.disabled = false;
  }
});

cancelEditButton.addEventListener("click", () => {
  resetExpenseForm();
  formMessage.textContent = "Edición cancelada.";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  viewTouched = true;
  movementStatus.textContent = "";
  loadExpenses();
});
viewInput.addEventListener("change", () => {
  viewTouched = true;
  movementStatus.textContent = "";
  loadExpenses();
});
loadExpenses();
loadOptions();
