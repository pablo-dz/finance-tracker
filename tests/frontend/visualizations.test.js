import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { budgetChart, donutChart, horizontalBarChart, lineChart, pieChart3D } from "../../frontend/modules/visualizations.js";

test("el gráfico circular 3D selecciona categorías con mouse, teclado o toque", () => {
  const dom = new JSDOM("<div></div>");
  const container = dom.window.document.querySelector("div");
  const selections = [];
  const entries = [
    { key: "a", name: "Arriendo", value: 75n },
    { key: "b", name: "Comida", value: 25n },
    { key: "c", name: "Sin gasto", value: 0n },
  ];
  pieChart3D(container, entries, String, (entry) => selections.push(entry.key), "b");
  const buttons = container.querySelectorAll(".category-pie-choice");
  assert.equal(buttons.length, 3);
  assert.match(buttons[0].textContent, /Arriendo.*75.*75 %/);
  assert.match(buttons[1].textContent, /Comida.*25.*25 %/);
  assert.equal(buttons[1].getAttribute("aria-pressed"), "true");
  assert.match(buttons[2].textContent, /Sin gasto.*Sin gasto este mes/);
  assert.deepEqual(selections, ["b"]);
  buttons[0].dispatchEvent(new dom.window.MouseEvent("mouseenter"));
  assert.equal(buttons[0].getAttribute("aria-pressed"), "true");
  assert.equal(buttons[1].getAttribute("aria-pressed"), "false");
  assert.equal(container.querySelectorAll(".category-pie-slice.is-selected").length, 2);
  buttons[1].focus();
  assert.equal(selections.at(-1), "b");
  const top = container.querySelector(".category-pie-top");
  top.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(selections.at(-1), "a");
  buttons[2].click();
  assert.equal(selections.at(-1), "c");
  assert.equal(container.querySelectorAll(".category-pie-slice.is-selected").length, 0);
  pieChart3D(container, [{ key: "only", name: "Única", value: 10n }], String, () => {}, null);
  assert.equal(container.querySelector(".category-pie-top").getAttribute("d").match(/ A /g).length, 2);
  assert.match(container.textContent, /Única.*100 %/);
  pieChart3D(container, [{ key: "none", name: "Vacía", value: 0n }], String, () => {}, null);
  assert.equal(container.querySelector("svg"), null);
  assert.match(container.textContent, /Vacía.*Sin gasto este mes/);
  dom.window.close();
});

test("el gráfico de presupuestos superpone barras en una escala monetaria común", () => {
  const dom = new JSDOM("<div></div>");
  const container = dom.window.document.querySelector("div");
  budgetChart(container, [
    { name: "Dentro", limit: 100n, spent: 50n, detail: ["Gastado: 50", "Límite: 100"] },
    { name: "Igual", limit: 100n, spent: 100n, detail: ["Gastado: 100", "Límite: 100"] },
    { name: "Excedido", limit: 100n, spent: 200n, detail: ["Gastado: 200", "Límite: 100", "Excedido: 100"] },
    { name: "Cero", limit: 0n, spent: 0n, detail: ["Gastado: 0", "Límite: 0"] },
  ], String);
  assert.equal(container.querySelector(".visualization-axis-y").textContent, "Monto (CLP)");
  assert.equal(container.querySelector(".visualization-axis-x").textContent, "Categoría");
  const limits = [...container.querySelectorAll(".budget-column-limit")];
  const spends = [...container.querySelectorAll(".budget-column-within, .budget-column-exceeded")];
  for (const [actual, expected] of limits.map((item) => Number(item.getAttribute("height")))
    .map((height, index) => [height, [100, 100, 100, 0][index] / 220 * 240])) {
    assert.ok(Math.abs(actual - expected) < 0.001);
  }
  for (const [actual, expected] of spends.map((item) => Number(item.getAttribute("height")))
    .map((height, index) => [height, [50, 100, 200, 0][index] / 220 * 240])) {
    assert.ok(Math.abs(actual - expected) < 0.001);
  }
  assert.deepEqual(spends.map((item) => item.getAttribute("class")), [
    "budget-column-within", "budget-column-within", "budget-column-exceeded", "budget-column-within",
  ]);
  assert.equal(Number(limits[0].getAttribute("x")) + Number(limits[0].getAttribute("width")) / 2,
    Number(spends[0].getAttribute("x")) + Number(spends[0].getAttribute("width")) / 2);
  assert.deepEqual([...container.querySelectorAll(".budget-y-axis .visualization-y-tick")].map((item) => item.textContent),
    ["220", "200", "150", "100", "50", "0"]);
  assert.deepEqual([...container.querySelectorAll(".budget-plot-labels span")].map((item) => item.textContent),
    ["Dentro", "Igual", "Excedido", "Cero"]);
  const targets = container.querySelectorAll(".budget-bar-target");
  const tooltip = container.querySelector(".budget-tooltip");
  targets[2].dispatchEvent(new dom.window.MouseEvent("mouseenter"));
  assert.ok(tooltip.classList.contains("is-visible"));
  assert.match(tooltip.textContent, /Excedido.*Gastado: 200.*Límite: 100.*Excedido: 100/);
  targets[2].dispatchEvent(new dom.window.MouseEvent("mouseleave", { relatedTarget: tooltip }));
  assert.ok(tooltip.classList.contains("is-visible"));
  tooltip.dispatchEvent(new dom.window.MouseEvent("mouseleave", { relatedTarget: container }));
  assert.ok(!tooltip.classList.contains("is-visible"));
  targets[2].dispatchEvent(new dom.window.MouseEvent("mouseenter"));
  targets[2].dispatchEvent(new dom.window.MouseEvent("mouseleave"));
  assert.ok(!tooltip.classList.contains("is-visible"));
  targets[0].focus();
  assert.ok(tooltip.classList.contains("is-visible"));
  assert.match(targets[0].getAttribute("aria-label"), /Dentro.*Gastado: 50.*Límite: 100/);
  targets[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.ok(!tooltip.classList.contains("is-visible"));
  targets[3].click();
  assert.match(tooltip.textContent, /Cero.*Gastado: 0.*Límite: 0/);
  container.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  assert.ok(!tooltip.classList.contains("is-visible"));
  budgetChart(container, [{ name: "Cero", limit: 0n, spent: 0n, detail: ["Gastado: 0"] }], String);
  assert.equal(container.querySelector(".budget-column-within").getAttribute("height"), "0");
  assert.deepEqual([...container.querySelectorAll(".budget-y-axis .visualization-y-tick")].map((item) => item.textContent), ["0"]);
  budgetChart(container, [], String);
  assert.equal(container.childNodes.length, 0);
  dom.window.close();
});

test("las barras horizontales ordenan gastos y muestran detalles con mouse, teclado o toque", () => {
  const dom = new JSDOM("<div></div><div id='outside'></div>");
  const container = dom.window.document.querySelector("div");
  horizontalBarChart(container, [
    { name: "Menor", value: 5000n, detail: ["Fecha: 02/06/2020", "Monto: 50"] },
    { name: "Mayor", value: 10000n, detail: ["Fecha: 01/06/2020", "Monto: 100"] },
    { name: "Igual", value: 5000n, detail: ["Fecha: 03/06/2020", "Monto: 50"] },
  ], String);
  const rows = [...container.querySelectorAll(".horizontal-bar-item")];
  assert.deepEqual(rows.map((row) => row.querySelector(".horizontal-bar-label span").textContent), ["Mayor", "Menor", "Igual"]);
  const bars = rows.map((row) => row.querySelector("button"));
  assert.deepEqual(bars.map((bar) => bar.style.width), ["100%", "50%", "50%"]);
  const tooltip = container.querySelector(".horizontal-bar-tooltip");
  bars[0].dispatchEvent(new dom.window.MouseEvent("mouseenter"));
  assert.ok(tooltip.classList.contains("is-visible"));
  assert.match(tooltip.textContent, /Mayor.*Fecha: 01\/06\/2020.*Monto: 100/);
  bars[0].dispatchEvent(new dom.window.MouseEvent("mouseleave"));
  assert.ok(!tooltip.classList.contains("is-visible"));
  bars[1].focus();
  assert.match(tooltip.textContent, /Menor.*Fecha: 02\/06\/2020/);
  assert.match(bars[1].getAttribute("aria-label"), /Monto: 50/);
  bars[1].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.ok(!tooltip.classList.contains("is-visible"));
  bars[2].click();
  assert.match(tooltip.textContent, /Igual.*03\/06\/2020/);
  horizontalBarChart(container, [], String);
  assert.equal(container.childNodes.length, 0);
  dom.window.close();
});

test("los colores representan tercios exactos del mayor gasto", () => {
  const dom = new JSDOM("<div></div>");
  const container = dom.window.document.querySelector("div");
  horizontalBarChart(container, [300n, 200n, 199n, 100n, 99n].map((value) => ({
    name: String(value), value, detail: [],
  })), String);
  const bars = [...container.querySelectorAll(".horizontal-bar")];
  assert.deepEqual(bars.map((bar) => bar.className), [
    "horizontal-bar horizontal-level-high",
    "horizontal-bar horizontal-level-high",
    "horizontal-bar horizontal-level-medium",
    "horizontal-bar horizontal-level-medium",
    "horizontal-bar horizontal-level-low",
  ]);
  assert.match(bars[4].getAttribute("aria-label"), /Nivel relativo: Bajo/);
  bars[2].focus();
  assert.match(container.querySelector(".horizontal-bar-tooltip").textContent, /Nivel relativo: Medio/);
  horizontalBarChart(container, [{ name: "Igual", value: 99999999999999n, detail: [] },
    { name: "Otro", value: 99999999999999n, detail: [] }], String);
  assert.equal(container.querySelectorAll(".horizontal-level-high.horizontal-bar").length, 2);
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
  const yValues = lines[0].getAttribute("points").split(" ").map((point) => Number(point.split(",")[1]));
  assert.ok(Math.abs(yValues[0] - 27.7273) < 0.001);
  assert.equal(yValues[1], 105);
  assert.ok(Math.abs(yValues[2] - 182.2727) < 0.001);
  assert.equal(lines[1].getAttribute("points"), "30,105 360,105 690,105");
  assert.equal(container.querySelector(".visualization-zero").getAttribute("y1"), "105");
  assert.equal(container.querySelector(".visualization-axis-y").textContent, "Monto (CLP)");
  assert.equal(container.querySelector(".visualization-axis-x").textContent, "Mes");
  assert.deepEqual([...container.querySelectorAll(".visualization-y-tick")].map((item) => item.textContent),
    ["110", "50", "0", "-50", "-110"]);
  lineChart(container, ["Ene"], [{ name: "Saldo", values: [0n] }], String, { xLabel: "Día del mes" });
  assert.equal(container.querySelector("circle").getAttribute("cy"), "190");
  assert.equal(container.querySelector(".visualization-axis-x").textContent, "Día del mes");
  dom.window.close();
});

test("los puntos muestran los valores del mes con mouse, teclado o toque", () => {
  const dom = new JSDOM("<div></div><div id='outside'></div>");
  const container = dom.window.document.querySelector("div");
  const rows = [
    { name: "Ingresos", values: [100n, 200n] },
    { name: "Gastos", values: [75n, 250n] },
    { name: "Ahorro neto", values: [25n, -50n] },
  ];
  lineChart(container, ["Ene", "Feb"], rows, String, { pointDetails: true });
  const targets = container.querySelectorAll(".visualization-point-target");
  const tooltip = container.querySelector(".line-tooltip");
  assert.equal(targets.length, 6);
  assert.equal([...targets].filter((target) => target.tabIndex === 0).length, 2);
  targets[3].dispatchEvent(new dom.window.MouseEvent("mouseenter"));
  assert.ok(tooltip.classList.contains("is-visible"));
  assert.match(tooltip.textContent, /Feb.*Ingresos: 200.*Gastos: 250.*Ahorro neto: -50/);
  assert.match(targets[3].getAttribute("aria-label"), /Feb.*Ingresos: 200.*Gastos: 250.*Ahorro neto: -50/);
  targets[3].dispatchEvent(new dom.window.MouseEvent("mouseleave"));
  assert.ok(!tooltip.classList.contains("is-visible"));
  targets[0].focus();
  assert.match(tooltip.textContent, /Ene.*Ingresos: 100.*Gastos: 75.*Ahorro neto: 25/);
  targets[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  assert.ok(!tooltip.classList.contains("is-visible"));
  targets[1].click();
  assert.ok(tooltip.classList.contains("is-visible"));
  dom.window.document.querySelector("#outside").dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  assert.ok(!tooltip.classList.contains("is-visible"));
  targets[1].click();
  lineChart(container, ["Ene"], [{ name: "Saldo", values: [0n] }], String);
  dom.window.document.querySelector("#outside").dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
  assert.equal(container.querySelector(".visualization-point-target"), null);
  dom.window.close();
});

test("los saldos desconocidos no se dibujan como cero ni conectan períodos sin datos", () => {
  const dom = new JSDOM("<div></div>");
  const container = dom.window.document.querySelector("div");
  lineChart(container, ["Ene", "Feb", "Mar", "Abr"], [
    { name: "Total", values: [0n, 100n, 0n, 200n] },
    { name: "Cuenta", values: [null, 100n, null, 200n] },
  ], String, { pointDetails: true });
  const lines = [...container.querySelectorAll("polyline")];
  assert.equal(lines.length, 3);
  assert.equal(lines[1].getAttribute("points").split(" ").length, 1);
  assert.equal(lines[2].getAttribute("points").split(" ").length, 1);
  assert.equal(container.querySelectorAll(".visualization-point-target").length, 6);
  const first = container.querySelector(".visualization-point-target");
  first.focus();
  assert.match(container.querySelector(".line-tooltip").textContent, /Ene.*Cuenta: Sin datos/);
  dom.window.close();
});

test("la escala temporal respeta la distancia entre meses proyectados", () => {
  const dom = new JSDOM("<div></div>");
  const container = dom.window.document.querySelector("div");
  lineChart(container, ["Hoy", "Mes 2", "Mes 3"], [{ name: "Proyección", values: [0n, 2n, 3n], dash: "8 4" }],
    String, { xValues: [0, 2, 3] });
  const line = container.querySelector("polyline");
  assert.deepEqual(line.getAttribute("points").split(" ").map((point) => point.split(",")[0]), ["30", "470", "690"]);
  assert.equal(line.getAttribute("stroke-dasharray"), "8 4");
  dom.window.close();
});

test("las escalas monetarias se ajustan a los datos y alinean marcas con la cuadrícula", () => {
  const dom = new JSDOM("<div></div>");
  const container = dom.window.document.querySelector("div");
  lineChart(container, ["Ene", "Feb"], [{ name: "Saldo", values: [-140n, 310n] }], String);
  const ticks = [...container.querySelectorAll(".visualization-y-tick")];
  const grid = [...container.querySelectorAll("svg line")];
  assert.deepEqual(ticks.map((tick) => tick.textContent), ["341", "300", "200", "100", "0", "-100", "-154"]);
  for (let i = 0; i < ticks.length; i++) {
    assert.ok(Math.abs(parseFloat(ticks[i].style.top) - Number(grid[i].getAttribute("y1")) * 240 / 225) < 0.001);
  }
  const points = container.querySelector("polyline").getAttribute("points").split(" ");
  assert.ok(Math.abs(Number(points[0].split(",")[1]) - 185.1919) < 0.001);
  assert.ok(Math.abs(Number(points[1].split(",")[1]) - 30.6464) < 0.001);

  lineChart(container, ["Ene"], [{ name: "Saldo", values: [1n] }], String);
  assert.deepEqual([...container.querySelectorAll(".visualization-y-tick")].map((tick) => tick.textContent), ["2", "1", "0"]);
  lineChart(container, ["Ene"], [{ name: "Saldo", values: [0n] }], String);
  assert.deepEqual([...container.querySelectorAll(".visualization-y-tick")].map((tick) => tick.textContent), ["0"]);
  lineChart(container, ["Ene"], [{ name: "Saldo", values: [-1n] }], String);
  assert.deepEqual([...container.querySelectorAll(".visualization-y-tick")].map((tick) => tick.textContent), ["1", "0", "-1", "-2"]);
  lineChart(container, ["Ene"], [{ name: "Saldo", values: [9999999999999999n] }], String);
  assert.deepEqual([...container.querySelectorAll(".visualization-y-tick")].map((tick) => tick.textContent),
    ["10999999999999999", "10000000000000000", "7500000000000000", "5000000000000000", "2500000000000000", "0"]);

  budgetChart(container, [{ name: "A", limit: 230n, spent: 0n, detail: [] }], String);
  assert.deepEqual([...container.querySelectorAll(".visualization-y-tick")].map((tick) => tick.textContent),
    ["253", "200", "100", "0"]);
  assert.ok(Math.abs(Number(container.querySelector(".budget-column-limit").getAttribute("height")) - 230 / 253 * 240) < 0.001);
  dom.window.close();
});

test("el máximo del eje conserva un margen del diez por ciento en líneas y presupuestos", () => {
  const dom = new JSDOM("<div></div>");
  const container = dom.window.document.querySelector("div");
  for (const max of [1n, 123n, 10001n, 10000000000n, 9999999999999999n]) {
    const upper = max + (max + 9n) / 10n;
    lineChart(container, ["Mes"], [{ name: "Saldo", values: [max] }], String);
    assert.equal(container.querySelector(".visualization-y-tick").textContent, String(upper));
    const y = Number(container.querySelector("circle").getAttribute("cy"));
    assert.ok(y >= 20 && y <= 190);
    budgetChart(container, [{ name: "A", limit: max, spent: 0n, detail: [] }], String);
    assert.equal(container.querySelector(".visualization-y-tick").textContent, String(upper));
    const height = Number(container.querySelector(".budget-column-limit").getAttribute("height"));
    assert.ok(height > 0 && height < 240);
  }
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
