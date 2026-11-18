import {
  monthInput, movementStatus, expenseForm, formMessage,
  saveButton, incomeFormMessage,
  transferFormMessage, displayName, todayText, formatMoney,
  state,
} from "./common.js?v=7";
import { loadExpenses } from "./expenses.js?v=7";
import { selectMovementMonth } from "./planning.js?v=7";
import { refreshDashboard } from "./analytics.js?v=7";

const incomeForm = document.querySelector("#income-form");
const saveIncomeButton = document.querySelector("#save-income");
const cancelIncomeEditButton = document.querySelector("#cancel-income-edit");
const transferForm = document.querySelector("#transfer-form");
const saveTransferButton = document.querySelector("#save-transfer");
const cancelTransferEditButton = document.querySelector("#cancel-transfer-edit");
const openingBalanceForm = document.querySelector("#opening-balance-form");
const openingBalanceMessage = document.querySelector("#opening-balance-message");
const saveOpeningBalanceButton = document.querySelector("#save-opening-balance");
const accountList = document.querySelector("#accounts");
const accountStatus = document.querySelector("#accounts-status");
const incomeMovements = document.querySelector("#income-movements");
const incomeMovementsEmpty = document.querySelector("#income-movements-empty");

let accounts = [];
let openingBalanceExpected = null;
let savingIncome = false;
let savingTransfer = false;
let editingIncomeId = null;
let editingTransferId = null;
let savingOpeningBalance = false;
let incomeOptionsAvailable = false;

export function resetIncomeForm() {
  editingIncomeId = null;
  incomeForm.reset();
  incomeForm.elements.date.value = todayText;
  document.querySelector("#income-form-title").textContent = "Registrar ingreso";
  saveIncomeButton.textContent = "Guardar ingreso";
  cancelIncomeEditButton.hidden = true;
}

export function resetTransferForm() {
  editingTransferId = null;
  transferForm.reset();
  transferForm.elements.date.value = todayText;
  document.querySelector("#transfer-form-title").textContent = "Transferir entre cuentas";
  saveTransferButton.textContent = "Guardar transferencia";
  cancelTransferEditButton.hidden = true;
}

function renderAccounts(values) {
  accounts = values;
  accountList.replaceChildren();
  for (const account of accounts) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const balance = document.createElement("strong");
    item.className = "account-item";
    name.textContent = account.name;
    balance.textContent = formatMoney(account.balance);
    item.append(name, balance);
    accountList.append(item);
  }

  const selected = openingBalanceForm.elements.accountId.value;
  const accountSelect = openingBalanceForm.elements.accountId;
  accountSelect.replaceChildren(new Option("Selecciona una cuenta", ""));
  for (const account of accounts) {
    accountSelect.append(new Option(account.name, String(account.id)));
  }
  const selectedAccount = accounts.find((account) => String(account.id) === selected) ?? accounts[0];
  if (selectedAccount) {
    accountSelect.value = String(selectedAccount.id);
    openingBalanceExpected = selectedAccount.openingBalance;
    openingBalanceForm.elements.amount.value = selectedAccount.openingBalance;
  } else {
    openingBalanceExpected = null;
    openingBalanceForm.elements.amount.value = "";
  }
  saveOpeningBalanceButton.disabled = !accounts.length || savingOpeningBalance;
  saveTransferButton.disabled = accounts.length < 2 || savingTransfer;
}

export async function refreshAccounts() {
  try {
    const response = await fetch("/api/opciones");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible consultar las cuentas.");
    renderAccounts(data.accounts);
    accountStatus.textContent = "";
  } catch (error) {
    accountStatus.textContent = error instanceof Error ? error.message : "No fue posible consultar las cuentas.";
  }
}

export async function loadMovements(month) {
  try {
    const response = await fetch(`/api/movimientos?mes=${encodeURIComponent(month)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible consultar los movimientos.");
    document.querySelector("#income-total").textContent = formatMoney(data.incomeTotal);
    incomeMovements.replaceChildren();
    const otherMovements = data.movements.filter((movement) => movement.type !== "expense");
    for (const movement of otherMovements) {
      const item = document.createElement("li");
      const detail = document.createElement("div");
      const description = document.createElement("strong");
      const metadata = document.createElement("div");
      const amount = document.createElement("strong");
      const actions = document.createElement("div");
      const edit = document.createElement("button");
      const remove = document.createElement("button");
      item.className = "other-movement";
      description.textContent = movement.description;
      metadata.className = "other-movement-meta";
      const date = movement.date.split("-").reverse().join("/");
      const type = movement.type === "income" ? "Ingreso" : "Transferencia";
      const account = movement.destinationAccount
        ? `${movement.account} → ${movement.destinationAccount}`
        : movement.account;
      const category = movement.category ? ` · ${displayName(movement.category)}` : "";
      metadata.textContent = `${date} · ${type} · ${account}${category}`;
      detail.append(description, metadata);
      amount.textContent = formatMoney(movement.amount);
      actions.className = "movement-actions";
      actions.append(amount);
      edit.type = "button";
      edit.className = "edit-button";
      edit.textContent = "Editar";
      edit.setAttribute("aria-label", `Editar ${type.toLowerCase()} ${movement.description}`);
      edit.addEventListener("click", () => editOtherMovement(movement));
      actions.append(edit);
      remove.type = "button";
      remove.className = "delete-button";
      remove.textContent = "Eliminar";
      remove.setAttribute("aria-label", `Eliminar ${type.toLowerCase()} ${movement.description}`);
      remove.addEventListener("click", () => deleteOtherMovement(movement));
      actions.append(remove);
      item.append(detail, actions);
      incomeMovements.append(item);
    }
    incomeMovementsEmpty.hidden = otherMovements.length !== 0;
  } catch (error) {
    movementStatus.textContent = error instanceof Error ? error.message : "No fue posible consultar los movimientos.";
  }
}

function editOtherMovement(movement) {
  const isIncome = movement.type === "income";
  const formElement = isIncome ? incomeForm : transferForm;
  const formStatus = isIncome ? incomeFormMessage : transferFormMessage;
  if ((isIncome ? saveIncomeButton : saveTransferButton).disabled) {
    formStatus.textContent = "Espera a que el formulario esté disponible para editar.";
    return;
  }
  const [whole, fraction = ""] = movement.amount.split(".");
  if (isIncome && /[^0]/.test(fraction)) {
    formStatus.textContent = "Este ingreso tiene centavos; la edición solo admite pesos enteros.";
    document.querySelector("#income-registration").scrollIntoView({ behavior: "smooth" });
    return;
  }
  if ((isIncome ? editingIncomeId : editingTransferId) !== null
    && !confirm("Hay una edición en curso. ¿Descartar esos cambios?")) return;
  const id = movement.id.slice(movement.id.indexOf("-") + 1);
  formElement.elements.date.value = movement.date;
  formElement.elements.amount.value = isIncome ? whole : movement.amount;
  if (isIncome) {
    editingIncomeId = id;
    formElement.elements.merchant.value = movement.merchant ?? "";
    formElement.elements.accountId.value = String(movement.accountId ?? "");
    formElement.elements.categoryId.value = String(movement.categoryId ?? "");
    document.querySelector("#income-form-title").textContent = "Editar ingreso";
    saveIncomeButton.textContent = "Guardar cambios";
    cancelIncomeEditButton.hidden = false;
    formStatus.textContent = formElement.elements.merchant.value && formElement.elements.accountId.value && formElement.elements.categoryId.value
      ? "Editando un ingreso personal."
      : "Completa la descripción y selecciona una cuenta y categoría disponibles.";
  } else {
    editingTransferId = id;
    formElement.elements.sourceAccountId.value = String(movement.sourceAccountId ?? "");
    formElement.elements.destinationAccountId.value = String(movement.destinationAccountId ?? "");
    formElement.elements.note.value = movement.note ?? "";
    document.querySelector("#transfer-form-title").textContent = "Editar transferencia";
    saveTransferButton.textContent = "Guardar cambios";
    cancelTransferEditButton.hidden = false;
    formStatus.textContent = formElement.elements.sourceAccountId.value && formElement.elements.destinationAccountId.value
      ? "Editando una transferencia."
      : "Selecciona cuentas de origen y destino disponibles.";
  }
  document.querySelector(isIncome ? "#income-registration" : "#transfer-registration").scrollIntoView({ behavior: "smooth" });
  formElement.elements[isIncome ? "merchant" : "amount"].focus();
}

async function deleteOtherMovement(movement) {
  const type = movement.type === "income" ? "ingreso" : "transferencia";
  const isIncome = movement.type === "income";
  const id = movement.id.slice(movement.id.indexOf("-") + 1);
  if (isIncome ? savingIncome : savingTransfer) {
    movementStatus.textContent = "Espera a que termine la operación en curso.";
    return;
  }
  const isEditing = id === (isIncome ? editingIncomeId : editingTransferId);
  const warning = isEditing ? " También se descartará la edición en curso." : "";
  if (!confirm(`¿Eliminar este ${type} de ${formatMoney(movement.amount)}? Esta acción no se puede deshacer.${warning}`)) return;
  const path = isIncome ? "/api/ingresos" : "/api/transferencias";
  try {
    const response = await fetch(path, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `No fue posible eliminar el ${type}.`);
    if (isEditing) {
      if (isIncome) resetIncomeForm();
      else resetTransferForm();
      (isIncome ? incomeFormMessage : transferFormMessage).textContent = "La edición se canceló porque el movimiento fue eliminado.";
    }
    movementStatus.textContent = `${type[0].toUpperCase()}${type.slice(1)} eliminado correctamente.`;
    await loadExpenses();
    await refreshAccounts();
  } catch (error) {
    movementStatus.textContent = error instanceof Error ? error.message : `No fue posible eliminar el ${type}.`;
  }
}

export async function loadOptions() {
  try {
    const response = await fetch("/api/opciones");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible cargar el formulario.");
    for (const [select, values] of [
      [expenseForm.elements.accountId, data.accounts],
      [expenseForm.elements.categoryId, data.categories],
      [incomeForm.elements.accountId, data.accounts],
      [incomeForm.elements.categoryId, data.incomeCategories],
      [transferForm.elements.sourceAccountId, data.accounts],
      [transferForm.elements.destinationAccountId, data.accounts],
    ]) {
      const selectedValue = select.value;
      const placeholder = select.options[0]?.textContent ?? "Selecciona una opción";
      select.replaceChildren(new Option(placeholder, ""));
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value.id;
        option.textContent = value.name ? displayName(value.name) : "";
        select.append(option);
      }
      if (values.some((value) => String(value.id) === selectedValue)) select.value = selectedValue;
    }
    renderAccounts(data.accounts);
    incomeOptionsAvailable = data.incomeCategories.length > 0;
    saveButton.disabled = state.saving || !data.accounts.length || !data.categories.length;
    saveIncomeButton.disabled = savingIncome || !data.accounts.length || !incomeOptionsAvailable;
    if (!data.accounts.length || !data.categories.length) {
      formMessage.textContent = "Para registrar gastos, agrega una cuenta activa en CLP y una categoría de gasto.";
    }
    if (!data.accounts.length || !data.incomeCategories.length) {
      incomeFormMessage.textContent = "Para registrar ingresos, agrega una cuenta activa en CLP y una categoría de ingreso.";
    }
    if (data.accounts.length < 2) {
      transferFormMessage.textContent = "Necesitas al menos dos cuentas activas en CLP para transferir dinero.";
    }
    return true;
  } catch (error) {
    formMessage.textContent = error instanceof Error ? error.message : "No fue posible cargar el formulario.";
    return false;
  }
}

openingBalanceForm.elements.accountId.addEventListener("change", () => {
  const account = accounts.find((item) => String(item.id) === openingBalanceForm.elements.accountId.value);
  openingBalanceExpected = account?.openingBalance ?? null;
  openingBalanceForm.elements.amount.value = account?.openingBalance ?? "";
});

openingBalanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingOpeningBalance || openingBalanceExpected === null) return;
  savingOpeningBalance = true;
  saveOpeningBalanceButton.disabled = true;
  openingBalanceMessage.textContent = "Guardando saldo inicial...";
  try {
    const response = await fetch("/api/cuentas/saldo-inicial", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: Number(openingBalanceForm.elements.accountId.value),
        amount: openingBalanceForm.elements.amount.value,
        expectedAmount: openingBalanceExpected,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible guardar el saldo inicial.");
    openingBalanceMessage.textContent = "Saldo inicial actualizado correctamente.";
    await refreshAccounts();
    await refreshDashboard();
  } catch (error) {
    openingBalanceMessage.textContent = error instanceof Error ? error.message : "No fue posible guardar el saldo inicial.";
  } finally {
    savingOpeningBalance = false;
    saveOpeningBalanceButton.disabled = !accounts.length;
  }
});

incomeForm.elements.date.value = todayText;
incomeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingIncome) return;
  const values = new FormData(incomeForm);
  const isEditing = editingIncomeId !== null;
  savingIncome = true;
  saveIncomeButton.disabled = true;
  cancelIncomeEditButton.disabled = true;
  incomeFormMessage.textContent = "Guardando ingreso...";
  try {
    let response;
    let data;
    try {
      response = await fetch("/api/ingresos", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: values.get("merchant"),
          amount: values.get("amount"),
          date: values.get("date"),
          categoryId: Number(values.get("categoryId")),
          accountId: Number(values.get("accountId")),
          ...(isEditing ? { id: editingIncomeId } : {}),
        }),
      });
      data = await response.json();
    } catch {
      throw new Error("No se pudo confirmar el cambio. Consulta los movimientos antes de intentarlo de nuevo.");
    }
    if (!response.ok) throw new Error(data.error || "No fue posible guardar el ingreso.");
    const date = values.get("date");
    resetIncomeForm();
    incomeFormMessage.textContent = isEditing ? "Ingreso actualizado correctamente." : "Ingreso registrado correctamente.";
    selectMovementMonth(date.slice(0, 7));
    await loadExpenses(monthInput.value);
    await refreshAccounts();
  } catch (error) {
    incomeFormMessage.textContent = error instanceof Error ? error.message : "No fue posible guardar el ingreso.";
  } finally {
    savingIncome = false;
    saveIncomeButton.disabled = !accounts.length || !incomeOptionsAvailable;
    cancelIncomeEditButton.disabled = false;
  }
});

cancelIncomeEditButton.addEventListener("click", () => {
  resetIncomeForm();
  incomeFormMessage.textContent = "Edición cancelada.";
});

transferForm.elements.date.value = todayText;
transferForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingTransfer) return;
  const values = new FormData(transferForm);
  const isEditing = editingTransferId !== null;
  savingTransfer = true;
  saveTransferButton.disabled = true;
  cancelTransferEditButton.disabled = true;
  transferFormMessage.textContent = "Guardando transferencia...";
  try {
    let response;
    let data;
    try {
      response = await fetch("/api/transferencias", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: values.get("amount"),
          date: values.get("date"),
          sourceAccountId: Number(values.get("sourceAccountId")),
          destinationAccountId: Number(values.get("destinationAccountId")),
          note: values.get("note"),
          ...(isEditing ? { id: editingTransferId } : {}),
        }),
      });
      data = await response.json();
    } catch {
      throw new Error("No se pudo confirmar el cambio. Consulta los movimientos antes de intentarlo de nuevo.");
    }
    if (!response.ok) throw new Error(data.error || "No fue posible guardar la transferencia.");
    const date = values.get("date");
    resetTransferForm();
    transferFormMessage.textContent = isEditing ? "Transferencia actualizada correctamente." : "Transferencia registrada correctamente.";
    selectMovementMonth(date.slice(0, 7));
    await loadExpenses(monthInput.value);
    await refreshAccounts();
  } catch (error) {
    transferFormMessage.textContent = error instanceof Error ? error.message : "No fue posible guardar la transferencia.";
  } finally {
    savingTransfer = false;
    saveTransferButton.disabled = accounts.length < 2;
    cancelTransferEditButton.disabled = false;
  }
});

cancelTransferEditButton.addEventListener("click", () => {
  resetTransferForm();
  transferFormMessage.textContent = "Edición cancelada.";
});
