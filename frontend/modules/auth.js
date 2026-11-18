import {
  incomeFormMessage, transferFormMessage,
} from "./common.js?v=19";
import { loadExpenses } from "./expenses.js?v=19";
import { clearMovementHistory, loadOptions, resetIncomeForm, resetTransferForm } from "./movements.js?v=19";
import { loadSavingsGoals } from "./savings.js?v=19";
import { categorySaveInProgress, clearCategoryDrafts, hasUnsavedCategories, loadCategories } from "./planning.js?v=19";

const authPanel = document.querySelector("#auth-panel");
const authStatus = document.querySelector("#auth-status");
const appContent = document.querySelector("#app-content");
const userEmail = document.querySelector("#user-email");
const logoutButton = document.querySelector("#logout-button");
const loginForm = document.querySelector("#login-form");
const loginButton = document.querySelector("#login-button");
const registerForm = document.querySelector("#register-form");
const registerButton = document.querySelector("#register-button");

async function showApplication(user) {
  authPanel.hidden = true;
  appContent.hidden = false;
  userEmail.textContent = user.email;
  userEmail.hidden = false;
  logoutButton.hidden = false;
  await Promise.all([loadExpenses(), loadOptions(), loadSavingsGoals(), loadCategories()]);
}

export async function initializeAuthentication() {
  try {
    const response = await fetch("/api/auth/session");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible consultar la sesión.");
    if (data.user) await showApplication(data.user);
  } catch (error) {
    authStatus.textContent = error instanceof Error ? error.message : "No fue posible consultar la sesión.";
  }
}

async function submitAuthentication(event, formElement, button, path) {
  event.preventDefault();
  const values = new FormData(formElement);
  if (path === "/api/auth/register" && values.get("password") !== values.get("passwordConfirm")) {
    authStatus.textContent = "Las contraseñas no coinciden.";
    return;
  }
  button.disabled = true;
  authStatus.textContent = path === "/api/auth/login" ? "Iniciando sesión..." : "Creando cuenta...";
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: values.get("email"), password: values.get("password") }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible autenticar la cuenta.");
    loginForm.reset();
    registerForm.reset();
    authStatus.textContent = "";
    await showApplication(data.user);
  } catch (error) {
    authStatus.textContent = error instanceof Error ? error.message : "No fue posible autenticar la cuenta.";
  } finally {
    button.disabled = false;
  }
}

loginForm.addEventListener("submit", (event) => {
  submitAuthentication(event, loginForm, loginButton, "/api/auth/login");
});

registerForm.addEventListener("submit", (event) => {
  submitAuthentication(event, registerForm, registerButton, "/api/auth/register");
});

logoutButton.addEventListener("click", async () => {
  if (categorySaveInProgress()) {
    document.defaultView.alert("Espera a que termine el guardado de categorías antes de cerrar sesión.");
    return;
  }
  if (hasUnsavedCategories() && !confirm("Hay cambios de categorías sin guardar. ¿Cerrar sesión y descartarlos?")) return;
  logoutButton.disabled = true;
  appContent.inert = true;
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No fue posible cerrar la sesión.");
    resetIncomeForm();
    resetTransferForm();
    clearMovementHistory();
    clearCategoryDrafts();
    incomeFormMessage.textContent = "";
    transferFormMessage.textContent = "";
    appContent.hidden = true;
    authPanel.hidden = false;
    userEmail.hidden = true;
    logoutButton.hidden = true;
    authStatus.textContent = "Sesión cerrada.";
  } catch (error) {
    authStatus.textContent = error instanceof Error ? error.message : "No fue posible cerrar la sesión.";
  } finally {
    appContent.inert = false;
    logoutButton.disabled = false;
  }
});
