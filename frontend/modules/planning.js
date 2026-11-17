import {
  budgetPanel, budgetForm, budgetFormMessage, displayName,
  formatMoney, state,
} from "./common.js";
import { loadOptions } from "./movements.js";

const budgetList = document.querySelector("#budgets");
const budgetStatus = document.querySelector("#budget-status");
const saveBudgetButton = document.querySelector("#save-budget");
const cancelBudgetButton = document.querySelector("#cancel-budget-edit");
const categoryStatus = document.querySelector("#category-status");
const managedCategories = document.querySelector("#managed-categories");
const categoryForm = document.querySelector("#category-form");
const createCategoryButton = document.querySelector("#create-category");

let editingBudget = null;
let savingBudget = false;
let categoriesRequest = 0;
let categorySaving = false;

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

export async function loadCategories() {
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
    if (state.displayedBudgetMonth) await loadBudgets(state.displayedBudgetMonth);
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

categoryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (categorySaving) return;
  const values = new FormData(categoryForm);
  await saveCategory("POST", { name: values.get("name") });
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
    if (!budgetPanel.hidden && state.displayedBudgetMonth) await loadBudgets(state.displayedBudgetMonth);
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
