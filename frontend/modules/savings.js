import {
  todayText, formatMoney, moneyInCents, formatCents,
} from "./common.js?v=27";
import { refreshDashboard } from "./analytics.js?v=27";
import { loadMovementHistory, refreshAccounts } from "./movements.js?v=27";

const savingsStatus = document.querySelector("#savings-status");
const savingsEmpty = document.querySelector("#savings-empty");
const savingsGoalsList = document.querySelector("#savings-goals");
const savingsArchivedList = document.querySelector("#savings-archived");
const savingsArchiveEmpty = document.querySelector("#savings-archive-empty");
const savingsGoalForm = document.querySelector("#savings-goal-form");
const savingsGoalMessage = document.querySelector("#savings-goal-message");
const saveGoalButton = document.querySelector("#save-goal");
const savingsContributionForm = document.querySelector("#savings-contribution-form");
const savingsContributionMessage = document.querySelector("#savings-contribution-message");
const saveContributionButton = document.querySelector("#save-contribution");

const percentFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 });

let savingsRequest = 0;
let savingsGoalsAvailable = false;
let savingGoal = false;
let savingContribution = false;
let savingsAccounts = [];
let currentGoals = [];

function updateSavingsContributionForm() {
  const goal = currentGoals.find((item) => String(item.id) === savingsContributionForm.elements.goalId.value);
  const destination = savingsAccounts.find((account) => account.id === goal?.accountId);
  const sources = savingsAccounts.filter((account) => account.id !== destination?.id);
  fillAccountSelect(savingsContributionForm.elements.sourceAccountId, sources);
  document.querySelector("#savings-destination").textContent = destination
    ? `Destino: ${destination.name}` : "Selecciona una meta para ver su cuenta de destino.";
  saveContributionButton.disabled = savingContribution || !savingsGoalsAvailable || !destination || !sources.length;
}

function fillAccountSelect(select, accounts = savingsAccounts) {
  const selected = select.value;
  select.replaceChildren(new Option("Selecciona una cuenta", ""));
  for (const account of accounts) select.append(new Option(account.name, String(account.id)));
  select.value = selected;
}

savingsContributionForm.elements.goalId.addEventListener("change", updateSavingsContributionForm);

async function refreshSavingsViews() {
  await Promise.all([loadSavingsGoals(), refreshDashboard(), refreshAccounts(), loadMovementHistory()]);
}

function accountAssignment(goal, contribution) {
  const form = document.createElement("form");
  form.className = "goal-account-form";
  const label = document.createElement("label");
  const select = document.createElement("select");
  select.name = "sourceAccountId";
  select.required = true;
  fillAccountSelect(select, savingsAccounts.filter((account) => account.id !== goal.accountId));
  label.append(document.createTextNode("Cuenta de origen"), select);
  form.append(label);
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Asignar cuentas";
  button.disabled = !goal.accountId || savingsAccounts.filter((account) => account.id !== goal.accountId).length === 0;
  form.append(button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    if (!confirm(`¿Registrar una transferencia por ${formatMoney(contribution.amount)} con fecha ${contribution.date.split("-").reverse().join("/")} para "${goal.name}"? Cambiará los saldos desde esa fecha. Si ya registraste esa transferencia por separado, se duplicará.`)) return;
    button.disabled = true;
    try {
      const response = await fetch("/api/metas/aportes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: contribution.id, sourceAccountId: Number(values.get("sourceAccountId")),
          destinationAccountId: goal.accountId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible asignar las cuentas.");
      await refreshSavingsViews();
      savingsStatus.textContent = "Cuentas asignadas y transferencia registrada.";
    } catch (error) {
      savingsStatus.textContent = error instanceof Error ? error.message : "No fue posible asignar las cuentas.";
      button.disabled = false;
    }
  });
  return form;
}

function goalAccountAssignment(goal) {
  const form = document.createElement("form");
  form.className = "goal-account-form";
  const label = document.createElement("label");
  const select = document.createElement("select");
  select.name = "accountId";
  select.required = true;
  fillAccountSelect(select, savingsAccounts.filter((account) => account.type === "savings"));
  label.append(document.createTextNode("Cuenta de ahorro de esta meta"), select);
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Asignar cuenta";
  form.append(label, button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const accountId = Number(select.value);
    const account = savingsAccounts.find((item) => item.id === accountId);
    if (!account) return;
    const reversed = goal.contributions.filter((item) => item.sourceAccountId === accountId);
    const warning = reversed.length
      ? ` Se invertirán ${reversed.length} transferencia(s) que salen de esta cuenta, modificando los saldos desde sus fechas:\n${reversed.map((item) => `${item.date}: ${formatMoney(item.amount)} · ${item.sourceAccount} → ${item.destinationAccount}`).join("\n")}`
      : " No hay transferencias que salgan de esta cuenta.";
    if (!confirm(`¿Asignar "${account.name}" como destino de "${goal.name}"?${warning} La cuenta no se podrá cambiar después.`)) return;
    button.disabled = true;
    try {
      const response = await fetch("/api/metas", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: goal.id, accountId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No fue posible asignar la cuenta.");
      await refreshSavingsViews();
      savingsStatus.textContent = "Cuenta asignada y aportes invertidos corregidos.";
    } catch (error) {
      savingsStatus.textContent = error instanceof Error ? error.message : "No fue posible asignar la cuenta.";
      button.disabled = false;
    }
  });
  return form;
}

export async function loadSavingsGoals() {
  const requestId = ++savingsRequest;
  const goalSelect = savingsContributionForm.elements.goalId;
  const selectedGoal = goalSelect.value;
  savingsGoalsAvailable = false;
  savingsGoalsList.replaceChildren();
  savingsArchivedList.replaceChildren();
  goalSelect.replaceChildren(new Option("Selecciona una meta", ""));
  savingsEmpty.hidden = true;
  savingsArchiveEmpty.hidden = true;
  savingsStatus.textContent = "Cargando metas...";
  updateSavingsContributionForm();
  try {
    const [response, accountsResponse] = await Promise.all([fetch("/api/metas"), fetch("/api/opciones")]);
    const [data, options] = await Promise.all([response.json(), accountsResponse.json()]);
    if (requestId !== savingsRequest) return;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar las metas de ahorro.");
    if (!accountsResponse.ok) throw new Error(options.error || "No fue posible consultar las cuentas.");
    savingsAccounts = options.accounts.filter((account) => account.openingConfigured);
    currentGoals = data.goals;
    fillAccountSelect(savingsGoalForm.elements.accountId, savingsAccounts.filter((account) => account.type === "savings"));
    const unassigned = data.goals.filter((goal) => !goal.accountId).length;
    const notice = document.querySelector("#savings-account-notice");
    const noSavings = !savingsAccounts.some((account) => account.type === "savings");
    notice.hidden = !unassigned && !noSavings;
    notice.textContent = [
      noSavings ? "Crea una cuenta de tipo ahorro en «Cuentas» antes de asignarla a una meta." : "",
      unassigned ? `${unassigned} meta(s), incluidas las completadas, necesitan una cuenta de ahorro asignada.` : "",
    ].filter(Boolean).join(" ");

    let activeCount = 0;
    let archivedCount = 0;
    for (const goal of data.goals) {
      const item = document.createElement("li");
      const header = document.createElement("div");
      const name = document.createElement("strong");
      const summary = document.createElement("div");
      const saved = document.createElement("span");
      const progressText = document.createElement("span");
      const progress = document.createElement("progress");
      const dueDate = document.createElement("p");
      const contributionList = document.createElement("ul");
      item.className = "goal-item";
      name.textContent = goal.name;
      const targetCents = moneyInCents(goal.targetAmount);
      const savedCents = moneyInCents(goal.saved);
      const completed = targetCents > 0n && savedCents >= targetCents;
      if (completed) archivedCount++;
      else {
        activeCount++;
        if (goal.accountId) goalSelect.append(new Option(goal.name, String(goal.id)));
      }
      const percent = targetCents > 0n
        ? completed ? 100 : Number((savedCents * 10000n) / targetCents) / 100
        : 0;
      saved.textContent = `Ahorrado: ${formatMoney(goal.saved)} de ${formatMoney(goal.targetAmount)}`;
      progressText.textContent = completed
        ? "Meta alcanzada"
        : `Faltan ${formatCents(targetCents > savedCents ? targetCents - savedCents : 0n)} · ${percentFormatter.format(percent)} %`;
      summary.className = "goal-summary";
      summary.append(saved, progressText);
      progress.className = "goal-progress";
      progress.max = 100;
      progress.value = percent;
      progress.setAttribute("aria-label", `Avance de ${goal.name}`);
      dueDate.className = "goal-due-date";
      dueDate.textContent = goal.dueDate
        ? `Fecha objetivo: ${goal.dueDate.split("-").reverse().join("/")}`
        : "Sin fecha objetivo";
      const destination = document.createElement("p");
      destination.className = "goal-due-date";
      destination.textContent = goal.accountName ? `Cuenta de ahorro: ${goal.accountName}` : "Asigna una cuenta de ahorro para esta meta.";
      contributionList.className = "goal-contributions";
      contributionList.setAttribute("aria-label", `Aportes a ${goal.name}`);
      for (const contribution of goal.contributions) {
        const contributionItem = document.createElement("li");
        const detail = document.createElement("span");
        const amount = document.createElement("strong");
        const date = contribution.date.split("-").reverse().join("/");
        const accounts = contribution.needsAccounts ? "Cuentas pendientes de asignación"
          : contribution.sourceAccount && contribution.destinationAccount
            ? `${contribution.sourceAccount} → ${contribution.destinationAccount}` : "";
        detail.textContent = [date, contribution.note, accounts].filter(Boolean).join(" · ");
        amount.textContent = formatMoney(contribution.amount);
        contributionItem.append(detail, amount);
        if (contribution.editable) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "delete-button";
          remove.textContent = "Eliminar";
          remove.setAttribute("aria-label", `Eliminar aporte de ${formatMoney(contribution.amount)} a ${goal.name}`);
          remove.addEventListener("click", () => deleteSavingsContribution(goal, contribution));
          contributionItem.append(remove);
        }
        if (contribution.needsAccounts && contribution.editable && goal.accountId) contributionItem.append(accountAssignment(goal, contribution));
        contributionList.append(contributionItem);
      }
      const removeGoal = document.createElement("button");
      removeGoal.type = "button";
      removeGoal.className = "delete-button";
      removeGoal.textContent = "Eliminar";
      removeGoal.setAttribute("aria-label", `Eliminar meta ${goal.name}`);
      removeGoal.addEventListener("click", () => deleteSavingsGoal(goal));
      header.className = "goal-header";
      header.append(name, removeGoal);
      item.append(header, summary, progress, dueDate, destination);
      if (!goal.accountId) item.append(goalAccountAssignment(goal));
      if (goal.contributions.length) item.append(contributionList);
      (completed ? savingsArchivedList : savingsGoalsList).append(item);
    }
    goalSelect.value = selectedGoal;
    savingsGoalsAvailable = activeCount > 0;
    savingsEmpty.hidden = savingsGoalsAvailable;
    savingsArchiveEmpty.hidden = archivedCount > 0;
    savingsStatus.textContent = "";
    updateSavingsContributionForm();
  } catch (error) {
    if (requestId !== savingsRequest) return;
    savingsStatus.textContent = error instanceof Error ? error.message : "No fue posible consultar las metas de ahorro.";
    updateSavingsContributionForm();
  }
}

document.querySelector("#refresh-savings").addEventListener("click", loadSavingsGoals);

async function deleteSavingsGoal(goal) {
  if (!confirm(`¿Eliminar la meta "${goal.name}" y todos sus aportes? Se eliminarán las transferencias asociadas y se revertirán sus efectos en los saldos. Esta acción no se puede deshacer.`)) return;
  try {
    const response = await fetch("/api/metas", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: goal.id }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible eliminar la meta.");
    await refreshSavingsViews();
    savingsStatus.textContent = "Meta y aportes eliminados.";
  } catch (error) {
    savingsStatus.textContent = error instanceof Error ? error.message : "No fue posible eliminar la meta.";
  }
}

async function deleteSavingsContribution(goal, contribution) {
  if (!confirm(`¿Eliminar el aporte de ${formatMoney(contribution.amount)} a "${goal.name}"? Se eliminará su transferencia y se revertirán sus efectos en los saldos. Esta acción no se puede deshacer.`)) return;
  try {
    const response = await fetch("/api/metas/aportes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: contribution.id }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible eliminar el aporte.");
    savingsContributionMessage.textContent = "Aporte eliminado correctamente.";
    await refreshSavingsViews();
  } catch (error) {
    savingsContributionMessage.textContent = error instanceof Error ? error.message : "No fue posible eliminar el aporte.";
  }
}

savingsContributionForm.elements.date.value = todayText;
savingsGoalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingGoal) return;
  const values = new FormData(savingsGoalForm);
  savingGoal = true;
  saveGoalButton.disabled = true;
  savingsGoalMessage.textContent = "Guardando meta...";
  try {
    const response = await fetch("/api/metas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.get("name"),
        targetAmount: values.get("targetAmount"),
        dueDate: values.get("dueDate") || null,
        accountId: Number(values.get("accountId")),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible crear la meta.");
    savingsGoalForm.reset();
    savingsGoalMessage.textContent = "Meta creada correctamente.";
    await Promise.all([loadSavingsGoals(), refreshDashboard()]);
  } catch (error) {
    savingsGoalMessage.textContent = error instanceof Error ? error.message : "No fue posible crear la meta.";
  } finally {
    savingGoal = false;
    saveGoalButton.disabled = false;
  }
});

savingsContributionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (savingContribution || !savingsGoalsAvailable) return;
  const values = new FormData(savingsContributionForm);
  const goal = currentGoals.find((item) => String(item.id) === values.get("goalId"));
  if (!goal?.accountId || Number(values.get("sourceAccountId")) === goal.accountId) {
    savingsContributionMessage.textContent = "Selecciona una cuenta de origen distinta de la cuenta de ahorro.";
    return;
  }
  savingContribution = true;
  updateSavingsContributionForm();
  savingsContributionMessage.textContent = "Guardando aporte...";
  try {
    const response = await fetch("/api/metas/aportes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goalId: Number(values.get("goalId")),
        amount: values.get("amount"),
        date: values.get("date"),
        note: values.get("note"),
        sourceAccountId: Number(values.get("sourceAccountId")),
        destinationAccountId: goal.accountId,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible registrar el aporte.");
    savingsContributionForm.reset();
    savingsContributionForm.elements.date.value = todayText;
    savingsContributionMessage.textContent = "Aporte registrado correctamente.";
    await refreshSavingsViews();
  } catch (error) {
    savingsContributionMessage.textContent = error instanceof Error ? error.message : "No fue posible registrar el aporte.";
  } finally {
    savingContribution = false;
    updateSavingsContributionForm();
  }
});
