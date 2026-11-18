import { displayName, monthInput, state } from "./common.js?v=24";
import { loadOptions } from "./movements.js?v=24";
import { loadExpenses } from "./expenses.js?v=24";
const budgetPeriod = document.querySelector("#budget-period");
const categoryStatus = document.querySelector("#category-status");
const managedCategories = document.querySelector("#managed-categories");
const categoryForm = document.querySelector("#category-form");
const createCategoryButton = document.querySelector("#create-category");
const refreshCategoriesButton = document.querySelector("#refresh-categories");
const saveCategoriesButton = document.querySelector("#save-categories");

let categoriesRequest = 0;
let categorySaving = false;
let categoriesLoaded = false;
let categoryUncertain = false;
let categoryDrafts = [];
let budgetValues = new Map();
let budgetReady = false;

function budgetText(value) {
  if (value === null) return "";
  const [whole, fraction = ""] = value.split(".");
  return /[^0]/.test(fraction) ? value : whole;
}

function changedBudget(category) {
  return category.budget !== budgetText(category.originalBudget);
}

function updateCategoryControls() {
  const unavailable = categorySaving || !categoriesLoaded || categoryUncertain;
  createCategoryButton.disabled = unavailable;
  categoryForm.elements.name.disabled = unavailable;
  refreshCategoriesButton.disabled = categorySaving;
  saveCategoriesButton.disabled = unavailable || !hasUnsavedCategories()
    || (!budgetReady && categoryDrafts.some(changedBudget));
  monthInput.disabled = categorySaving;
  document.querySelector("#month-form button").disabled = categorySaving;
  for (const control of managedCategories.querySelectorAll("input, button, select")) {
    control.disabled = unavailable || control.dataset.inactive === "true"
      || (control.dataset.budget === "true" && !budgetReady);
  }
}

function changedCategory(category) {
  const original = category.original;
  return !original || category.name.trim() !== displayName(original.name)
    || category.fixed !== original.fixed || category.active !== original.active || changedBudget(category);
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
  ++state.budgetRequest;
  state.budgetMonth = null;
  state.displayedBudgetMonth = null;
  budgetValues = new Map();
  budgetReady = false;
  budgetPeriod.textContent = "Consulta un mes para configurar presupuestos.";
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
    const budgetLabel = document.createElement("label");
    const budget = document.createElement("input");
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
      if (category.original && category.active && changedBudget(category)) {
        categoryStatus.textContent = "Guarda o descarta el cambio de presupuesto antes de archivar esta categoría.";
        return;
      }
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
    budgetLabel.className = "category-budget";
    budgetLabel.textContent = "Presupuesto (CLP)";
    budget.type = "text";
    budget.inputMode = "numeric";
    budget.value = category.budget;
    budget.placeholder = "Sin límite";
    budget.dataset.budget = "true";
    budget.dataset.inactive = String(!category.active);
    budget.setAttribute("aria-label", `Presupuesto de ${categoryName}`);
    budget.addEventListener("input", () => {
      category.budget = budget.value.trim();
      status.textContent = `${category.active ? "Activa" : "Archivada"}${changedCategory(category) ? " · Pendiente" : ""}`;
      categoryStatus.textContent = hasUnsavedCategories() ? "Tienes cambios sin guardar." : "";
      updateCategoryControls();
    });
    budgetLabel.append(budget);
    item.append(status, name, typeLabel, budgetLabel, toggle);
    managedCategories.append(item);
  }
  updateCategoryControls();
}

function setCategoryDrafts(categories) {
  categoryDrafts = categories.map((category) => {
    const originalBudget = budgetValues.get(category.id) ?? null;
    return { original: category, name: displayName(category.name), active: category.active,
      fixed: category.fixed, originalBudget, budget: budgetText(originalBudget) };
  });
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
  categoryDrafts.push({ original: null, name, active: true, fixed: false, originalBudget: null, budget: "" });
  categoryForm.reset();
  renderManagedCategories();
  categoryStatus.textContent = "Categoría agregada a los cambios sin guardar.";
  return true;
}

async function saveCategories() {
  if (categorySaving || !categoriesLoaded || categoryUncertain) return;
  if (categoryForm.elements.name.value.trim() && !addCategory()) return;
  if (categoryDrafts.some((category) => changedBudget(category)
      && category.budget !== "" && !/^(?:0|[1-9][0-9]{0,11})$/.test(category.budget))) {
    categoryStatus.textContent = "Ingresa presupuestos en pesos enteros no negativos, o deja el campo vacío.";
    return;
  }
  if (!budgetReady && categoryDrafts.some(changedBudget)) {
    categoryStatus.textContent = "Consulta los presupuestos antes de guardar sus cambios.";
    return;
  }
  const changes = categoryDrafts.filter(changedCategory).map((category) => {
    const original = category.original;
    const name = original && category.name.trim() === displayName(original.name)
      ? original.name : category.name.trim();
    const change = { name, active: category.active, fixed: category.fixed };
    if (original) {
      change.id = original.id;
      change.expected = { name: original.name, active: original.active, fixed: original.fixed };
    }
    if (changedBudget(category)) {
      change.budget = { month: state.budgetMonth, amount: category.budget || null,
        expectedAmount: category.originalBudget };
    }
    return change;
  });
  if (changes.some((category) => !category.name)) {
    categoryStatus.textContent = "Ingresa un nombre para cada categoría.";
    return;
  }
  if (!changes.length) return;
  const month = state.budgetMonth || state.displayedBudgetMonth;
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
    budgetReady = false;
    budgetPeriod.textContent = month ? "Actualizando presupuestos..." : "Consulta un mes para configurar presupuestos.";
    setCategoryDrafts(data.categories);
    const optionsLoaded = await loadOptions();
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
  if (state.budgetMonth) loadBudgets(state.budgetMonth);
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

export function prepareBudgetMonth(month) {
  if (categorySaving) return false;
  if (state.budgetMonth && month !== state.budgetMonth && categoryDrafts.some(changedBudget)
      && !confirm("Hay presupuestos sin guardar. ¿Descartar esos cambios y cambiar de mes?")) return false;
  if (month !== state.budgetMonth) {
    for (const category of categoryDrafts) {
      category.originalBudget = null;
      category.budget = "";
    }
    budgetValues = new Map();
    budgetReady = false;
    state.budgetMonth = null;
    renderManagedCategories();
  }
  return true;
}

export function selectMovementMonth(month) {
  const selected = hasUnsavedCategories() || categorySaving
    ? (state.displayedBudgetMonth || state.budgetMonth || monthInput.value) : month;
  prepareBudgetMonth(selected);
  monthInput.value = selected;
}

export function beginBudgetLoad(month) {
  ++state.budgetRequest;
  if (state.budgetMonth !== month) {
    budgetReady = false;
    budgetPeriod.textContent = `Cargando presupuestos de ${month}...`;
    updateCategoryControls();
  }
}

export function budgetLoadFailed(month) {
  if (!budgetReady || state.budgetMonth !== month) {
    budgetPeriod.textContent = "No fue posible consultar los presupuestos. Vuelve a consultar el mes.";
  }
}

export async function loadBudgets(month) {
  const requestId = ++state.budgetRequest;
  try {
    const response = await fetch(`/api/presupuestos?mes=${encodeURIComponent(month)}`);
    const data = await response.json();
    if (requestId !== state.budgetRequest) return;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar los presupuestos.");
    const sameMonth = state.budgetMonth === month;
    budgetValues = new Map(data.categories.map((category) => [category.categoryId, category.budget]));
    for (const category of categoryDrafts) {
      if (sameMonth && changedBudget(category)) continue;
      category.originalBudget = budgetValues.get(category.original?.id) ?? null;
      category.budget = budgetText(category.originalBudget);
    }
    state.budgetMonth = month;
    budgetReady = true;
    budgetPeriod.textContent = `Presupuestos del mes: ${month}`;
    renderManagedCategories();
    return true;
  } catch (error) {
    if (requestId !== state.budgetRequest) return;
    budgetReady = false;
    budgetPeriod.textContent = error instanceof Error ? error.message : "No fue posible consultar los presupuestos.";
    updateCategoryControls();
    return false;
  }
}

categoryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!categorySaving && categoriesLoaded && !categoryUncertain) addCategory();
});
