import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { budgetChart, donutChart, lineChart } from "../../frontend/modules/visualizations.js";

test("el gráfico de presupuestos superpone barras en una escala monetaria común", () => {
  const dom = new JSDOM("<div></div>");
  const container = dom.window.document.querySelector("div");
  budgetChart(container, [
    { name: "Dentro", limit: 100n, spent: 50n },
    { name: "Igual", limit: 100n, spent: 100n },
    { name: "Excedido", limit: 100n, spent: 200n },
    { name: "Cero", limit: 0n, spent: 0n },
  ], String);
  const limits = [...container.querySelectorAll(".budget-column-limit")];
  const spends = [...container.querySelectorAll(".budget-column-within, .budget-column-exceeded")];
  assert.deepEqual(limits.map((item) => Number(item.getAttribute("height"))), [120, 120, 120, 0]);
  assert.deepEqual(spends.map((item) => Number(item.getAttribute("height"))), [60, 120, 240, 0]);
  assert.deepEqual(spends.map((item) => item.getAttribute("class")), [
    "budget-column-within", "budget-column-within", "budget-column-exceeded", "budget-column-within",
  ]);
  assert.equal(Number(limits[0].getAttribute("x")) + Number(limits[0].getAttribute("width")) / 2,
    Number(spends[0].getAttribute("x")) + Number(spends[0].getAttribute("width")) / 2);
  assert.deepEqual([...container.querySelectorAll(".budget-y-axis span:not(.budget-axis-width)")].map((item) => item.textContent),
    ["200", "100", "0"]);
  assert.deepEqual([...container.querySelectorAll(".budget-plot-labels span")].map((item) => item.textContent),
    ["Dentro", "Igual", "Excedido", "Cero"]);
  assert.match(spends[2].textContent, /Excedido · Gastado: 200/);
  budgetChart(container, [{ name: "Cero", limit: 0n, spent: 0n }], String);
  assert.equal(container.querySelector(".budget-column-within").getAttribute("height"), "0");
  assert.equal(container.querySelectorAll(".budget-y-axis span:not(.budget-axis-width)").length, 1);
  budgetChart(container, [], String);
  assert.equal(container.childNodes.length, 0);
  dom.window.close();
});

test("el gráfico temporal representa valores positivos y negativos sobre una escala común", () => {
  const dom = new JSDOM("<div></div>");
  const container = dom.window.document.querySelector("div");
  lineChart(container, ["Ene", "Feb", "Mar"], [
    { name: "Saldo", values: [100n, 0n, -100n] },
    { name: "Referencia", values: [0n, 0n, 0n] },
  ], String);
  const lines = container.querySelectorAll("polyline");
  assert.equal(lines[0].getAttribute("points"), "30,20 360,105 690,190");
  assert.equal(lines[1].getAttribute("points"), "30,105 360,105 690,105");
  assert.equal(container.querySelector(".visualization-zero").getAttribute("y1"), "105");
  assert.match(container.textContent, /Máximo: 100 · Punto medio: 0 · Mínimo: -100/);
  lineChart(container, ["Ene"], [{ name: "Saldo", values: [0n] }], String);
  assert.equal(container.querySelector("circle").getAttribute("cy"), "190");
  dom.window.close();
});

test("el gráfico de composición conserva cantidades y proporciones y admite ausencia de datos", () => {
  const dom = new JSDOM("<div></div>");
  const container = dom.window.document.querySelector("div");
  donutChart(container, [
    { name: "A", value: 1n },
    { name: "B", value: 3n },
    { name: "Sin gasto", value: 0n },
  ], String);
  assert.equal(container.querySelectorAll("circle").length, 2);
  assert.match(container.textContent, /A1 · 25 %/);
  assert.match(container.textContent, /B3 · 75 %/);
  assert.ok(!container.textContent.includes("Sin gasto"));
  const lengths = [...container.querySelectorAll("circle")]
    .map((circle) => Number(circle.getAttribute("stroke-dasharray").split(" ")[0]));
  assert.ok(Math.abs(lengths[1] / lengths[0] - 3) < 0.00001);
  donutChart(container, [{ name: "A", value: 0n }], String);
  assert.equal(container.childNodes.length, 0);
  dom.window.close();
});
