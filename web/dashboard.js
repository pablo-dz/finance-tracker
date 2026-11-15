const form = document.querySelector("#month-form");
const monthInput = document.querySelector("#month");
const message = document.querySelector("#message");
const results = document.querySelector("#results");
const list = document.querySelector("#categories");
const formatter = new Intl.NumberFormat("es-CL");
const today = new Date();
monthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
let currentRequest = 0;

function formatMoney(value) {
  const [whole, fraction = ""] = value.split(".");
  const decimals = fraction.replace(/0+$/, "");
  return `$${formatter.format(BigInt(whole))}${decimals ? `,${decimals}` : ""}`;
}

async function loadExpenses() {
  const requestId = ++currentRequest;
  const month = monthInput.value;
  results.hidden = true;
  message.textContent = "Cargando gastos...";
  try {
    const response = await fetch(`/api/gastos?mes=${encodeURIComponent(month)}`);
    const data = await response.json();
    if (requestId !== currentRequest) return;
    if (!response.ok) throw new Error(data.error || "No fue posible consultar los gastos.");

    list.replaceChildren();
    let count = 0;
    for (const category of data.categories) {
      count += category.count;
      const item = document.createElement("li");
      const name = document.createElement("span");
      const value = document.createElement("strong");
      name.textContent = category.category;
      value.textContent = formatMoney(category.total);
      item.append(name, value);
      list.append(item);
    }
    document.querySelector("#total").textContent = formatMoney(data.total);
    document.querySelector("#count").textContent = String(count);
    document.querySelector("#empty").hidden = data.categories.length !== 0;
    message.textContent = "";
    results.hidden = false;
  } catch (error) {
    if (requestId !== currentRequest) return;
    message.textContent = error instanceof Error ? error.message : "No fue posible consultar los gastos.";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadExpenses();
});
loadExpenses();
