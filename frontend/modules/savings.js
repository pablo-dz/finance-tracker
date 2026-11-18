import {
  todayText, formatMoney, moneyInCents, formatCents,
} from "./common.js?v=7";
import { refreshDashboard } from "./analytics.js?v=7";

const savingsStatus = document.querySelector("#savings-status");
const savingsEmpty = document.querySelector("#savings-empty");
const savingsGoalsList = document.querySelector("#savings-goals");
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

function updateSavingsContributionForm() {
  saveContributionButton.disabled = savingContribution || !savingsGoalsAvailable;
}

export async function loadSavingsGoals() {
  const requestId = ++savingsRequest;
  const goalSelect = savingsContributionForm.elements.goalId;
  const selectedGoal = goalSelect.value;
  savingsGoalsAvailable = false;
  savingsGoalsList.replaceChildren();
  goalSelect.replaceChildren(new Option("Selecciona una meta", ""));
  savingsEmpty.hidden = true;
  savingsStatus.textContent = "Cargando metas...";
  updateSavingsContributionForm();
  try {
    const response = await fetch("/api/metas");
    const data = await response.json();
    if (requestId !== savingsRequest) return;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar las metas de ahorro.");

    for (const goal of data.goals) {
      goalSelect.append(new Option(goal.name, String(goal.id)));
      const item = document.createElement("li");
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
      contributionList.className = "goal-contributions";
      contributionList.setAttribute("aria-label", `Aportes a ${goal.name}`);
      for (const contribution of goal.contributions) {
        const contributionItem = document.createElement("li");
        const detail = document.createElement("span");
        const amount = document.createElement("strong");
        const date = contribution.date.split("-").reverse().join("/");
        detail.textContent = contribution.note ? `${date} · ${contribution.note}` : date;
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
        contributionList.append(contributionItem);
      }
      item.append(name, summary, progress, dueDate);
      if (goal.contributions.length) item.append(contributionList);
      savingsGoalsList.append(item);
    }
    goalSelect.value = selectedGoal;
    savingsGoalsAvailable = data.goals.length > 0;
    savingsEmpty.hidden = savingsGoalsAvailable;
    savingsStatus.textContent = "";
    updateSavingsContributionForm();
  } catch (error) {
    if (requestId !== savingsRequest) return;
    savingsStatus.textContent = error instanceof Error ? error.message : "No fue posible consultar las metas de ahorro.";
    updateSavingsContributionForm();
  }
}

document.querySelector("#refresh-savings").addEventListener("click", loadSavingsGoals);

async function deleteSavingsContribution(goal, contribution) {
  if (!confirm(`¿Eliminar el aporte de ${formatMoney(contribution.amount)} a "${goal.name}"? Esta acción no se puede deshacer.`)) return;
  try {
    const response = await fetch("/api/metas/aportes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: contribution.id }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible eliminar el aporte.");
    savingsContributionMessage.textContent = "Aporte eliminado correctamente.";
    await Promise.all([loadSavingsGoals(), refreshDashboard()]);
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
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible registrar el aporte.");
    savingsContributionForm.reset();
    savingsContributionForm.elements.date.value = todayText;
    savingsContributionMessage.textContent = "Aporte registrado correctamente.";
    await Promise.all([loadSavingsGoals(), refreshDashboard()]);
  } catch (error) {
    savingsContributionMessage.textContent = error instanceof Error ? error.message : "No fue posible registrar el aporte.";
  } finally {
    savingContribution = false;
    updateSavingsContributionForm();
  }
});
