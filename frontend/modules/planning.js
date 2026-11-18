import {
  budgetPanel, budgetForm, budgetFormMessage, displayName,
  formatMoney, state,
} from "./common.js";
import { loadOptions } from "./movements.js";
import { loadExpenses } from "./expenses.js";
import { loadDashboard } from "./analytics.js";

const budgetList = document.querySelector("#budgets");
const budgetStatus = document.querySelector("#budget-status");
const saveBudgetButton = document.querySelector("#save-budget");
const cancelBudgetButton = document.querySelector("#cancel-budget-edit");
const categoryStatus = document.querySelector("#category-status");
const managedCategories = document.querySelector("#managed-categories");
const categoryForm = document.querySelector("#category-form");
const createCategoryButton = document.querySelector("#create-category");
const refreshCategoriesButton = document.querySelector("#refresh-categories");
const saveCategoriesButton = document.querySelector("#save-categories");

let editingBudget = null;
let savingBudget = false;
let categoriesRequest = 0;
let categorySaving = false;
let categoriesLoaded = false;
let categoryUncertain = false;
let categoryDrafts = [];

export function updateBudgetForm() {
  const month = editingBudget ? editingBudget.month : state.budgetMonth;
  document.querySelector("#budget-form-title").textContent = editingBudget ? "Editar presupuesto" : "Crear presupuesto";
  document.querySelector("#budget-form-period").textContent = month ? `Mes del presupuesto: ${month}` : "Consulta un mes para configurar presupuestos.";
  budgetForm.elements.categoryId.disabled = editingBudget !== null;
  saveBudgetButton.textContent = editingBudget ? "Guardar cambios" : "Crear presupuesto";
  saveBudgetButton.disabled = savingBudget || !state.budgetOptionsAvailable || !month;
  cancelBudgetButton.hidden = editingBudget === null;
  cancelBudgetButton.disabled = savingBudget;
}

function resetBudgetForm() {
  editingBudget = null;
  budgetForm.reset();
  updateBudgetForm();
}

function updateCategoryControls() {
  const unavailable = categorySaving || !categoriesLoaded || categoryUncertain;
  createCategoryButton.disabled = unavailable;
  categoryForm.elements.name.disabled = unavailable;
  refreshCategoriesButton.disabled = categorySaving;
  saveCategoriesButton.disabled = unavailable || !hasUnsavedCategories();
  for (const control of managedCategories.querySelectorAll("input, button, select")) {
    control.disabled = unavailable || control.dataset.inactive === "true";
  }
}

function changedCategory(category) {
  const original = category.original;
  return !original || category.name.trim() !== displayName(original.name)
    || category.fixed !== original.fixed || category.active !== original.active;
}

export function hasUnsavedCategories() {
  return categoryDrafts.some(changedCategory) || !!categoryForm.elements.name.value.trim();
}

export function categorySaveInProgress() {
  return categorySaving;
}

export function clearCategoryDrafts() {
  ++categoriesRequest;
  categoryDrafts = [];
  categoriesLoaded = false;
  categoryUncertain = false;
  categoryForm.reset();
  managedCategories.replaceChildren();
  categoryStatus.textContent = "";
  updateCategoryControls();
}

function renderManagedCategories() {
  managedCategories.replaceChildren();
  for (const category of categoryDrafts) {
    const categoryName = category.name;
    const item = document.createElement("li");
    const status = document.createElement("span");
    const name = document.createElement("input");
    const toggle = document.createElement("button");
    const typeLabel = document.createElement("label");
    const type = document.createElement("select");
    item.className = "managed-category";
    status.className = category.active ? "category-state" : "category-state archived";
    status.textContent = `${category.active ? "Activa" : "Archivada"}${changedCategory(category) ? " · Pendiente" : ""}`;
    name.type = "text";
    name.maxLength = 100;
    name.required = true;
    name.value = categoryName;
    name.setAttribute("aria-label", `Nombre de la categoría ${categoryName}`);
    name.dataset.inactive = String(!category.active);
    name.addEventListener("input", () => {
      category.name = name.value;
      status.textContent = `${category.active ? "Activa" : "Archivada"}${changedCategory(category) ? " · Pendiente" : ""}`;
      categoryStatus.textContent = hasUnsavedCategories() ? "Tienes cambios sin guardar." : "";
      updateCategoryControls();
    });
    toggle.type = "button";
    toggle.className = category.active || !category.original ? "delete-button" : "edit-button";
    toggle.textContent = category.original ? (category.active ? "Archivar" : "Restaurar") : "Quitar";
    toggle.setAttribute("aria-label", `${toggle.textContent} categoría ${categoryName}`);
    toggle.addEventListener("click", () => {
      if (category.original) category.active = !category.active;
      else categoryDrafts = categoryDrafts.filter((entry) => entry !== category);
      renderManagedCategories();
      categoryStatus.textContent = hasUnsavedCategories() ? "Tienes cambios sin guardar." : "";
    });
    typeLabel.className = "category-type";
    typeLabel.textContent = "Tipo";
    type.setAttribute("aria-label", `Tipo de ${categoryName}`);
    type.append(new Option("Variable", "false"), new Option("Fija", "true"));
    type.value = String(category.fixed);
    type.addEventListener("change", () => {
      category.fixed = type.value === "true";
      status.textContent = `${category.active ? "Activa" : "Archivada"}${changedCategory(category) ? " · Pendiente" : ""}`;
      categoryStatus.textContent = hasUnsavedCategories() ? "Tienes cambios sin guardar." : "";
      updateCategoryControls();
    });
    typeLabel.append(type);
    item.append(status, name, typeLabel, toggle);
    managedCategories.append(item);
  }
  updateCategoryControls();
}

function setCategoryDrafts(categories) {
  categoryDrafts = categories.map((category) => ({
    original: category, name: displayName(category.name), active: category.active, fixed: category.fixed,
  }));
  categoriesLoaded = true;
  categoryUncertain = false;
  renderManagedCategories();
}

export async function loadCategories() {
  const requestId = ++categoriesRequest;
  categoriesLoaded = false;
  categoryDrafts = [];
  categoryForm.reset();
  managedCategories.replaceChildren();
  categoryStatus.textContent = "Cargando categorías...";
  updateCategoryControls();
  try {
    const response = await fetch("/api/dashboard/categorias");
    const data = await response.json();
    if (requestId !== categoriesRequest) return false;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar las categorías.");
    setCategoryDrafts(data.categories);
    categoryStatus.textContent = data.categories.length ? "" : "Todavía no tienes categorías personales.";
    return true;
  } catch (error) {
    if (requestId !== categoriesRequest) return false;
    categoryStatus.textContent = error instanceof Error ? error.message : "No fue posible consultar las categorías.";
    return false;
  }
}

function addCategory() {
  const name = categoryForm.elements.name.value.trim();
  if (!name || name.length > 100) {
    categoryStatus.textContent = "Ingresa un nombre válido para la categoría.";
    return false;
  }
  categoryDrafts.push({ original: null, name, active: true, fixed: false });
  categoryForm.reset();
  renderManagedCategories();
  categoryStatus.textContent = "Categoría agregada a los cambios sin guardar.";
  return true;
}

async function saveCategories() {
  if (categorySaving || !categoriesLoaded || categoryUncertain) return;
  if (categoryForm.elements.name.value.trim() && !addCategory()) return;
  const changes = categoryDrafts.filter(changedCategory).map((category) => {
    const original = category.original;
    const name = original && category.name.trim() === displayName(original.name)
      ? original.name : category.name.trim();
    const change = { name, active: category.active, fixed: category.fixed };
    if (original) {
      change.id = original.id;
      change.expected = { name: original.name, active: original.active, fixed: original.fixed };
    }
    return change;
  });
  if (changes.some((category) => !category.name)) {
    categoryStatus.textContent = "Ingresa un nombre para cada categoría.";
    return;
  }
  if (!changes.length) return;
  categorySaving = true;
  categoryStatus.textContent = "Guardando categorías...";
  updateCategoryControls();
  try {
    let response;
    let data;
    try {
      response = await fetch("/api/categorias/lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      data = await response.json();
    } catch {
      categoryUncertain = true;
      throw new Error("No se pudo confirmar el guardado. Recarga las categorías antes de volver a intentarlo.");
    }
    if (!response.ok) throw new Error(data.error || "No fue posible guardar las categorías.");
    setCategoryDrafts(data.categories);
    const optionsLoaded = await loadOptions();
    const month = state.displayedBudgetMonth;
    const expensesLoaded = month ? await loadExpenses(month) : true;
    categoryStatus.textContent = optionsLoaded && expensesLoaded
      ? data.message
      : "Categorías guardadas, pero no se pudo actualizar la página. Vuelve a consultar.";
  } catch (error) {
    categoryStatus.textContent = error instanceof Error ? error.message : "No fue posible guardar las categorías.";
  } finally {
    categorySaving = false;
    updateCategoryControls();
  }
}

saveCategoriesButton.addEventListener("click", saveCategories);
refreshCategoriesButton.addEventListener("click", () => {
  if (hasUnsavedCategories() && !confirm("¿Descartar los cambios sin guardar y recargar las categorías?")) return;
  loadCategories();
});
categoryForm.elements.name.addEventListener("input", () => {
  categoryStatus.textContent = hasUnsavedCategories() ? "Tienes cambios sin guardar." : "";
  updateCategoryControls();
});
document.defaultView.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedCategories()) return;
  event.preventDefault();
  event.returnValue = "";
});

export async function loadBudgets(month) {
  const requestId = ++state.budgetRequest;
  state.budgetMonth = null;
  budgetList.replaceChildren();
  budgetStatus.textContent = "Cargando presupuestos...";
  updateBudgetForm();
  try {
    const response = await fetch(`/api/presupuestos?mes=${encodeURIComponent(month)}`);
    const data = await response.json();
    if (requestId !== state.budgetRequest) return;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar los presupuestos.");
    state.budgetMonth = month;
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
    if (requestId !== state.budgetRequest) return;
    budgetStatus.textContent = error instanceof Error ? error.message : "No fue posible consultar los presupuestos.";
    updateBudgetForm();
  }
}

categoryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!categorySaving && categoriesLoaded && !categoryUncertain) addCategory();
});

budgetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingBudget) return;
  const month = editingBudget ? editingBudget.month : state.budgetMonth;
  if (!month || !state.budgetOptionsAvailable) {
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
    if (!budgetPanel.hidden && state.displayedBudgetMonth) {
      await Promise.all([loadBudgets(state.displayedBudgetMonth), loadDashboard(state.displayedBudgetMonth)]);
    }
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
