import { expenseShare } from "./chart.js";

const form = document.querySelector("#month-form");
const monthInput = document.querySelector("#month");
const message = document.querySelector("#message");
const results = document.querySelector("#results");
const list = document.querySelector("#categories");
const movements = document.querySelector("#movements");
const movementStatus = document.querySelector("#movement-status");
const expenseForm = document.querySelector("#expense-form");
const formMessage = document.querySelector("#form-message");
const saveButton = document.querySelector("#save-expense");
const cancelEditButton = document.querySelector("#cancel-edit");
const budgetPanel = document.querySelector("#budget-panel");
const budgetList = document.querySelector("#budgets");
const budgetStatus = document.querySelector("#budget-status");
const budgetForm = document.querySelector("#budget-form");
const budgetFormMessage = document.querySelector("#budget-form-message");
const saveBudgetButton = document.querySelector("#save-budget");
const cancelBudgetButton = document.querySelector("#cancel-budget-edit");
const categoryPanel = document.querySelector("#category-panel");
const categoryStatus = document.querySelector("#category-status");
const managedCategories = document.querySelector("#managed-categories");
const categoryForm = document.querySelector("#category-form");
const createCategoryButton = document.querySelector("#create-category");
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
let editingId = null;
let saving = false;
let deleting = false;
let budgetRequest = 0;
let budgetMonth = null;
let displayedBudgetMonth = null;
let editingBudget = null;
let savingBudget = false;
let budgetOptionsAvailable = false;
let categoriesRequest = 0;
let categorySaving = false;

function formatMoney(value) {
  const [whole, fraction = ""] = value.split(".");
  const decimals = fraction.replace(/0+$/, "");
  return `$${formatter.format(BigInt(whole))}${decimals ? `,${decimals}` : ""}`;
}

function updateBudgetForm() {
  const month = editingBudget ? editingBudget.month : budgetMonth;
  document.querySelector("#budget-form-title").textContent = editingBudget ? "Editar presupuesto" : "Crear presupuesto";
  document.querySelector("#budget-form-period").textContent = month ? `Mes del presupuesto: ${month}` : "Consulta un mes para configurar presupuestos.";
  budgetForm.elements.categoryId.disabled = editingBudget !== null;
  saveBudgetButton.textContent = editingBudget ? "Guardar cambios" : "Crear presupuesto";
  saveBudgetButton.disabled = savingBudget || !budgetOptionsAvailable || !month;
  cancelBudgetButton.hidden = editingBudget === null;
  cancelBudgetButton.disabled = savingBudget;
}

function resetBudgetForm() {
  editingBudget = null;
  budgetForm.reset();
  updateBudgetForm();
}

function updateCategoryControls() {
  createCategoryButton.disabled = categorySaving;
  for (const control of managedCategories.querySelectorAll("input, button")) {
    control.disabled = categorySaving || control.dataset.inactive === "true";
  }
}

function renderManagedCategories(categories) {
  managedCategories.replaceChildren();
  for (const category of categories) {
    const categoryName = displayName(category.name);
    const item = document.createElement("li");
    const status = document.createElement("span");
    const form = document.createElement("form");
    const name = document.createElement("input");
    const rename = document.createElement("button");
    const toggle = document.createElement("button");
    item.className = "managed-category";
    status.className = category.active ? "category-state" : "category-state archived";
    status.textContent = category.active ? "Activa" : "Archivada";
    form.className = "category-edit-form";
    name.type = "text";
    name.maxLength = 100;
    name.required = true;
    name.value = categoryName;
    name.setAttribute("aria-label", `Nombre de la categoría ${categoryName}`);
    name.dataset.inactive = String(!category.active);
    rename.type = "submit";
    rename.textContent = "Guardar nombre";
    rename.dataset.inactive = String(!category.active);
    toggle.type = "button";
    toggle.className = category.active ? "delete-button" : "edit-button";
    toggle.textContent = category.active ? "Archivar" : "Restaurar";
    toggle.setAttribute("aria-label", `${category.active ? "Archivar" : "Restaurar"} categoría ${categoryName}`);
    form.append(name, rename);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (name.value.trim() !== categoryName) {
        saveCategory("PUT", { id: category.id, name: name.value });
      }
    });
    toggle.addEventListener("click", () => {
      if (category.active && !confirm(`¿Archivar "${categoryName}"? Sus gastos y presupuestos anteriores se conservarán.`)) return;
      saveCategory("PATCH", { id: category.id, active: !category.active });
    });
    item.append(status, form, toggle);
    managedCategories.append(item);
  }
  updateCategoryControls();
}

async function loadCategories() {
  const requestId = ++categoriesRequest;
  categoryStatus.textContent = "Cargando categorías...";
  try {
    const response = await fetch("/api/categorias");
    const data = await response.json();
    if (requestId !== categoriesRequest) return false;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar las categorías.");
    renderManagedCategories(data.categories);
    categoryStatus.textContent = data.categories.length ? "" : "Todavía no tienes categorías personales.";
    return true;
  } catch (error) {
    if (requestId !== categoriesRequest) return false;
    categoryStatus.textContent = error instanceof Error ? error.message : "No fue posible consultar las categorías.";
    return false;
  }
}

async function saveCategory(method, category) {
  if (categorySaving) return;
  categorySaving = true;
  categoryStatus.textContent = "Guardando categoría...";
  updateCategoryControls();
  try {
    const response = await fetch("/api/categorias", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(category),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible guardar la categoría.");
    if (method === "POST") categoryForm.reset();
    const [categoriesLoaded, optionsLoaded] = await Promise.all([
      loadCategories(),
      loadOptions(),
    ]);
    if (displayedBudgetMonth) await loadBudgets(displayedBudgetMonth);
    categoryStatus.textContent = categoriesLoaded && optionsLoaded
      ? data.message
      : "Categoría guardada, pero no se pudo actualizar la página. Vuelve a consultar.";
  } catch (error) {
    categoryStatus.textContent = error instanceof Error ? error.message : "No fue posible guardar la categoría.";
  } finally {
    categorySaving = false;
    updateCategoryControls();
  }
}

async function loadBudgets(month) {
  const requestId = ++budgetRequest;
  budgetMonth = null;
  budgetList.replaceChildren();
  budgetStatus.textContent = "Cargando presupuestos...";
  updateBudgetForm();
  try {
    const response = await fetch(`/api/presupuestos?mes=${encodeURIComponent(month)}`);
    const data = await response.json();
    if (requestId !== budgetRequest) return;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar los presupuestos.");
    budgetMonth = month;
    document.querySelector("#budget-period").textContent = `Mes consultado: ${month}`;
    for (const category of data.categories) {
      const item = document.createElement("li");
      const detail = document.createElement("div");
      const name = document.createElement("strong");
      const values = document.createElement("p");
      item.className = "budget-item";
      name.textContent = `${displayName(category.category)}${category.isActive === false ? " · Archivada" : ""}`;
      values.textContent = category.budget === null
        ? `Gastado: ${formatMoney(category.spent)} · Sin presupuesto`
        : `Gastado: ${formatMoney(category.spent)} · Límite: ${formatMoney(category.budget)} · ${category.exceeded ? "Excedido" : "Disponible"}: ${formatMoney(category.difference)}`;
      if (category.exceeded) values.className = "budget-exceeded";
      detail.append(name, values);
      item.append(detail);
      if (category.budget !== null && category.isActive !== false) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "edit-button";
        edit.textContent = "Cambiar límite";
        edit.setAttribute("aria-label", `Cambiar límite de ${displayName(category.category)} para ${month}`);
        edit.addEventListener("click", () => {
          if (savingBudget) return;
          if (editingBudget && !confirm("Hay una edición en curso. ¿Descartar esos cambios?")) return;
          editingBudget = { categoryId: category.categoryId, month, expectedAmount: category.budget };
          budgetForm.elements.categoryId.value = String(category.categoryId);
          const [whole, fraction = ""] = category.budget.split(".");
          budgetForm.elements.amount.value = /[^0]/.test(fraction) ? "" : whole;
          budgetFormMessage.textContent = /[^0]/.test(fraction)
            ? "El límite actual tiene centavos; ingresa el nuevo límite en pesos enteros." : "";
          updateBudgetForm();
          budgetForm.elements.amount.focus();
        });
        item.append(edit);
      }
      budgetList.append(item);
    }
    budgetStatus.textContent = data.categories.length ? "" : "No hay categorías de gastos disponibles.";
    updateBudgetForm();
  } catch (error) {
    if (requestId !== budgetRequest) return;
    budgetStatus.textContent = error instanceof Error ? error.message : "No fue posible consultar los presupuestos.";
    updateBudgetForm();
  }
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
  ++budgetRequest;
  budgetMonth = null;
  displayedBudgetMonth = null;
  budgetPanel.hidden = false;
  categoryPanel.hidden = false;
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
    displayedBudgetMonth = month;
    await Promise.all([loadBudgets(month), loadCategories()]);
    if (requestId !== currentRequest) return false;
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
    for (const [select, values] of [
      [expenseForm.elements.accountId, data.accounts],
      [expenseForm.elements.categoryId, data.categories],
      [budgetForm.elements.categoryId, data.categories],
    ]) {
      const selectedValue = select.value;
      const placeholder = select.options[0]?.textContent ?? "Selecciona una opción";
      select.replaceChildren(new Option(placeholder, ""));
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value.id;
        option.textContent = displayName(value.name);
        select.append(option);
      }
      if (values.some((value) => String(value.id) === selectedValue)) select.value = selectedValue;
    }
    budgetOptionsAvailable = data.categories.length > 0;
    updateBudgetForm();
    saveButton.disabled = saving || !data.accounts.length || !data.categories.length;
    if (!data.accounts.length || !data.categories.length) {
      formMessage.textContent = "Para registrar gastos, agrega una cuenta activa en CLP y una categoría de gasto.";
    }
    return true;
  } catch (error) {
    formMessage.textContent = error instanceof Error ? error.message : "No fue posible cargar el formulario.";
    budgetFormMessage.textContent = "No fue posible cargar las categorías para configurar presupuestos.";
    return false;
  }
}

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (categorySaving) return;
  const values = new FormData(categoryForm);
  await saveCategory("POST", { name: values.get("name") });
});

budgetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingBudget) return;
  const month = editingBudget ? editingBudget.month : budgetMonth;
  if (!month || !budgetOptionsAvailable) {
    budgetFormMessage.textContent = "Consulta un mes y verifica que existan categorías de gastos.";
    return;
  }
  const budget = {
    month,
    categoryId: editingBudget ? editingBudget.categoryId : Number(budgetForm.elements.categoryId.value),
    amount: budgetForm.elements.amount.value,
  };
  const isEditing = editingBudget !== null;
  if (isEditing) budget.expectedAmount = editingBudget.expectedAmount;
  savingBudget = true;
  updateBudgetForm();
  budgetFormMessage.textContent = "Guardando presupuesto...";
  try {
    let response;
    let data;
    try {
      response = await fetch("/api/presupuestos", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(budget),
      });
      data = await response.json();
    } catch {
      throw new Error("No se pudo confirmar el cambio. Consulta el presupuesto antes de intentarlo de nuevo.");
    }
    if (!response.ok) throw new Error(data.error || "No fue posible guardar el presupuesto.");
    resetBudgetForm();
    budgetFormMessage.textContent = `Presupuesto de ${month} guardado correctamente.`;
    if (!budgetPanel.hidden && displayedBudgetMonth) await loadBudgets(displayedBudgetMonth);
  } catch (error) {
    budgetFormMessage.textContent = error instanceof Error ? error.message : "No fue posible guardar el presupuesto.";
  } finally {
    savingBudget = false;
    updateBudgetForm();
  }
});

cancelBudgetButton.addEventListener("click", () => {
  resetBudgetForm();
  budgetFormMessage.textContent = "Edición cancelada.";
});

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
  movementStatus.textContent = "";
  loadExpenses();
});
loadExpenses();
loadOptions();
