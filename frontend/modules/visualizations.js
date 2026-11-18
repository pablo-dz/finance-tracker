const SVG_NS = "http://www.w3.org/2000/svg";
const COLORS = ["#287c58", "#b94a48", "#446fa0", "#aa6b10", "#75539d", "#217b82", "#9d5074", "#697a38"];
const chartTooltipCleanup = new WeakMap();

function svgElement(document, name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function text(document, tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function monetaryScale(min, max) {
  if (min === max) return { min, max, ticks: [min] };
  const rawStep = (max - min + 3n) / 4n;
  const magnitude = 10n ** BigInt(rawStep.toString().length - 1);
  const steps = [magnitude, 2n * magnitude];
  if (magnitude >= 10n) steps.push(5n * magnitude / 2n);
  steps.push(5n * magnitude, 10n * magnitude);
  const step = steps.find((candidate) => candidate >= rawStep);
  const floor = (value) => value >= 0n ? value / step * step : -((-value + step - 1n) / step) * step;
  const lower = floor(min);
  const upper = -floor(-max);
  const ticks = [];
  for (let value = upper; value >= lower; value -= step) ticks.push(value);
  return { min: lower, max: upper, ticks };
}

function scalePosition(value, scale, top, height) {
  return scale.min === scale.max ? top + height
    : top + Number((scale.max - value) * 1000000n / (scale.max - scale.min)) * height / 1000000;
}

function verticalAxis(document, scale, format, position) {
  const axis = text(document, "div", "", "visualization-y-axis");
  axis.setAttribute("aria-label", "Eje vertical: dinero en CLP");
  for (const value of scale.ticks) {
    const label = format(value);
    axis.append(text(document, "span", label, "visualization-axis-width"));
    const tick = text(document, "span", label, "visualization-y-tick");
    tick.style.top = `${position(value)}px`;
    axis.append(tick);
  }
  return axis;
}

function chartTooltip(container, plot, scroll, className) {
  const document = container.ownerDocument;
  const tooltip = text(document, "div", "", `visualization-tooltip ${className}`);
  tooltip.setAttribute("aria-hidden", "true");
  let activeTarget = null;
  let activeAnchor = null;
  function position() {
    if (!activeTarget) return;
    const bounds = plot.getBoundingClientRect();
    const targetBounds = activeTarget.getBoundingClientRect();
    const anchorBounds = activeAnchor.getBoundingClientRect();
    const x = targetBounds.left + targetBounds.width / 2 - bounds.left - tooltip.offsetWidth / 2;
    const anchorY = anchorBounds.top - bounds.top;
    const y = anchorY >= tooltip.offsetHeight + 8
      ? anchorY - tooltip.offsetHeight - 8
      : anchorY + (activeAnchor === activeTarget ? anchorBounds.height : 0) + 8;
    tooltip.style.left = `${Math.max(4, Math.min(x, bounds.width - tooltip.offsetWidth - 4))}px`;
    tooltip.style.top = `${Math.max(0, Math.min(y, bounds.height - tooltip.offsetHeight))}px`;
  }
  function hide(target) {
    if (activeTarget !== target) return;
    activeTarget = null;
    activeAnchor = null;
    tooltip.classList.remove("is-visible");
    document.removeEventListener("pointerdown", dismissOutside);
  }
  function dismissOutside(event) {
    if (!activeTarget.contains(event.target) && !tooltip.contains(event.target)) hide(activeTarget);
  }
  tooltip.addEventListener("mouseleave", (event) => {
    if (activeTarget && !activeTarget.contains(event.relatedTarget) && document.activeElement !== activeTarget) {
      hide(activeTarget);
    }
  });
  scroll.addEventListener("scroll", position);
  chartTooltipCleanup.set(container, () => {
    if (activeTarget) hide(activeTarget);
  });
  function bind(target, anchor, title, detail) {
    const show = () => {
      activeTarget = target;
      activeAnchor = anchor;
      tooltip.replaceChildren(text(document, "strong", title),
        ...detail.map((line) => text(document, "span", line)));
      tooltip.classList.add("is-visible");
      document.addEventListener("pointerdown", dismissOutside);
      position();
    };
    target.addEventListener("mouseenter", show);
    target.addEventListener("mouseleave", (event) => {
      if (!tooltip.contains(event.relatedTarget) && document.activeElement !== target) hide(target);
    });
    target.addEventListener("focus", show);
    target.addEventListener("blur", () => hide(target));
    target.addEventListener("click", show);
    target.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hide(target);
    });
  }
  return { tooltip, bind };
}

export function budgetChart(container, entries, format) {
  chartTooltipCleanup.get(container)?.();
  chartTooltipCleanup.delete(container);
  container.replaceChildren();
  if (!entries.length) return;
  const document = container.ownerDocument;
  const max = entries.reduce((largest, entry) =>
    [largest, entry.limit, entry.spent].reduce((a, b) => a > b ? a : b), 0n);
  const scale = monetaryScale(0n, max);
  const height = 240;
  const width = entries.length * 120;
  const y = (value) => scalePosition(value, scale, 0, height);
  const barHeight = (value) => height - y(value);
  const legend = text(document, "div", "", "visualization-legend");
  for (const [label, className] of [
    ["Límite", "budget-legend-limit"],
    ["Gasto dentro del límite", "budget-legend-within"],
    ["Gasto excedido", "budget-legend-exceeded"],
  ]) {
    const key = text(document, "span", label, "visualization-key");
    key.prepend(text(document, "span", "", `visualization-marker ${className}`));
    legend.append(key);
  }
  const hint = text(document, "p", "Desliza horizontalmente para ver todas las categorías.", "budget-chart-hint");
  const plot = text(document, "div", "", "budget-plot");
  const yTitle = text(document, "span", "Monto (CLP)", "visualization-axis-title visualization-axis-y budget-axis-title");
  const axis = verticalAxis(document, scale, format, y);
  axis.classList.add("budget-y-axis");
  const scroll = text(document, "div", "", "budget-plot-scroll");
  const inner = text(document, "div", "", "budget-plot-inner");
  inner.style.minWidth = `${width}px`;
  const targets = text(document, "div", "", "budget-plot-targets");
  const { tooltip, bind } = chartTooltip(container, plot, scroll, "budget-tooltip");
  const svg = svgElement(document, "svg", {
    viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true", class: "budget-plot-svg",
  });
  for (const value of scale.ticks) {
    svg.append(svgElement(document, "line", {
      x1: 0, x2: width, y1: y(value), y2: y(value), class: "visualization-grid",
    }));
  }
  const labels = text(document, "div", "", "budget-plot-labels");
  entries.forEach((entry, index) => {
    const center = index * 120 + 60;
    const limitHeight = barHeight(entry.limit);
    const spentHeight = barHeight(entry.spent);
    const limit = svgElement(document, "rect", {
      x: center - 38, y: height - limitHeight, width: 76, height: limitHeight, class: "budget-column-limit",
    });
    const spent = svgElement(document, "rect", {
      x: center - 22, y: height - spentHeight, width: 44, height: spentHeight,
      class: entry.spent > entry.limit ? "budget-column-exceeded" : "budget-column-within",
    });
    svg.append(limit, spent);
    const target = text(document, "button", "", "budget-bar-target");
    target.type = "button";
    target.style.height = `${Math.max(24, limitHeight, spentHeight)}px`;
    target.setAttribute("aria-label", `${entry.name}. ${entry.detail.join(". ")}`);
    const highestBar = limitHeight >= spentHeight ? limit : spent;
    bind(target, highestBar, entry.name, entry.detail);
    targets.append(target);
    labels.append(text(document, "span", entry.name));
  });
  inner.append(svg, targets, labels);
  scroll.append(inner);
  plot.append(yTitle, axis, scroll, tooltip);
  container.append(legend, hint, plot, text(document, "p", "Categoría", "visualization-axis-title visualization-axis-x"));
}

export function horizontalBarChart(container, entries, format) {
  chartTooltipCleanup.get(container)?.();
  chartTooltipCleanup.delete(container);
  container.replaceChildren();
  if (!entries.length) return;
  const document = container.ownerDocument;
  const ordered = [...entries].sort((a, b) => a.value > b.value ? -1 : a.value < b.value ? 1 : 0);
  const max = ordered[0].value;
  const legend = text(document, "div", "", "visualization-legend horizontal-bar-legend");
  for (const [label, level] of [
    ["Bajo: menos de 1/3", "low"],
    ["Medio: desde 1/3", "medium"],
    ["Alto: desde 2/3", "high"],
  ]) {
    const key = text(document, "span", label, "visualization-key");
    key.prepend(text(document, "span", "", `visualization-marker horizontal-level-${level}`));
    legend.append(key);
  }
  const plot = text(document, "div", "", "horizontal-bar-plot");
  const list = text(document, "ul", "", "horizontal-bar-list");
  const { tooltip, bind } = chartTooltip(container, plot, plot, "horizontal-bar-tooltip");
  for (const entry of ordered) {
    const item = text(document, "li", "", "horizontal-bar-item");
    const label = text(document, "div", "", "horizontal-bar-label");
    label.append(text(document, "span", entry.name), text(document, "strong", format(entry.value)));
    const level = max > 0n && entry.value * 3n >= max * 2n ? "high"
      : max > 0n && entry.value * 3n >= max ? "medium" : "low";
    const levelName = { high: "Alto", medium: "Medio", low: "Bajo" }[level];
    const detail = [...entry.detail, `Nivel relativo: ${levelName}`];
    const bar = text(document, "button", "", `horizontal-bar horizontal-level-${level}`);
    bar.type = "button";
    bar.style.width = max > 0n ? `${Number(entry.value * 1000000n / max) / 10000}%` : "0%";
    bar.setAttribute("aria-label", `${entry.name}. ${detail.join(". ")}`);
    bind(bar, bar, entry.name, detail);
    item.append(label, bar);
    list.append(item);
  }
  plot.append(list, tooltip);
  container.append(legend, plot);
}

export function lineChart(container, labels, series, format,
  { labelStep = 1, xLabel = "Mes", pointDetails = false, pointLabels = labels, xValues = null } = {}) {
  chartTooltipCleanup.get(container)?.();
  chartTooltipCleanup.delete(container);
  container.replaceChildren();
  if (!labels.length) return;
  const document = container.ownerDocument;
  const values = series.flatMap((entry) => entry.values);
  let min = 0n;
  let max = 0n;
  for (const value of values) {
    if (value === null) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const scale = monetaryScale(min, max);
  const y = (value) => scalePosition(value, scale, 20, 170);
  const x = (index) => labels.length === 1 ? 360 : 30 + 660 * (xValues
    ? (xValues[index] - xValues[0]) / (xValues[xValues.length - 1] - xValues[0])
    : index / (labels.length - 1));
  const hint = text(document, "p", "Desliza horizontalmente para ver el gráfico completo.", "visualization-hint");
  const legend = text(document, "div", "", "visualization-legend");
  const plot = text(document, "div", "", "visualization-line-plot");
  const yTitle = text(document, "span", "Monto (CLP)", "visualization-axis-title visualization-axis-y");
  const axis = verticalAxis(document, scale, format, (value) => y(value) * 240 / 225);
  const wrapper = text(document, "div", "", "visualization-scroll");
  const inner = pointDetails ? text(document, "div", "", "visualization-line-inner") : null;
  const popup = pointDetails ? chartTooltip(container, plot, wrapper, "line-tooltip") : null;
  const svg = svgElement(document, "svg", {
    viewBox: "0 0 720 225", preserveAspectRatio: "none", "aria-hidden": "true", class: "visualization-line",
  });
  for (const value of scale.ticks) {
    svg.append(svgElement(document, "line", {
      x1: 30, x2: 690, y1: y(value), y2: y(value),
      class: value === 0n && min < 0n && max > 0n ? "visualization-zero" : "visualization-grid",
    }));
  }
  labels.forEach((label, index) => {
    if (index !== labels.length - 1
        && (index % labelStep !== 0 || labels.length - 1 - index < labelStep)) return;
    const tick = svgElement(document, "text", { x: x(index), y: 215, "text-anchor": "middle" });
    tick.textContent = label;
    svg.append(tick);
  });
  series.forEach((entry, index) => {
    const color = entry.color ?? COLORS[index % COLORS.length];
    const dash = entry.dash ?? (index === 1 ? "8 4" : index === 2 ? "2 4" : null);
    const key = text(document, "span", entry.name, "visualization-key");
    const marker = text(document, "span", "", "visualization-marker");
    marker.style.backgroundColor = color;
    key.prepend(marker);
    legend.append(key);
    let points = [];
    const drawPoints = () => {
      if (!points.length) return;
      svg.append(svgElement(document, "polyline", {
        points: points.join(" "), fill: "none", stroke: color, "stroke-width": 3,
        "stroke-linejoin": "round", "stroke-linecap": "round",
        ...(dash ? { "stroke-dasharray": dash } : {}),
      }));
      points = [];
    };
    entry.values.forEach((value, i) => {
      if (value === null) {
        drawPoints();
        return;
      }
      points.push(`${x(i)},${y(value)}`);
      svg.append(svgElement(document, "circle", { cx: x(i), cy: y(value), r: 3, fill: color }));
      if (popup) {
        const detail = series.map((item) => `${item.name}: ${item.values[i] === null ? "Sin datos" : format(item.values[i])}`);
        const target = text(document, "button", "", "visualization-point-target");
        target.type = "button";
        if (index > 0) target.tabIndex = -1;
        target.style.left = `${x(i) / 720 * 100}%`;
        target.style.top = `${y(value) * 240 / 225}px`;
        target.setAttribute("aria-label", `${pointLabels[i]}. ${detail.join(". ")}`);
        popup.bind(target, target, pointLabels[i], detail);
        inner.append(target);
      }
    });
    drawPoints();
  });
  if (inner) {
    inner.prepend(svg);
    wrapper.append(inner);
  } else {
    wrapper.append(svg);
  }
  plot.append(yTitle, axis, wrapper);
  if (popup) plot.append(popup.tooltip);
  container.append(legend, hint, plot, text(document, "p", xLabel, "visualization-axis-title visualization-axis-x"));
}

export function donutChart(container, entries, format) {
  container.replaceChildren();
  const visible = entries.filter((entry) => entry.value > 0n);
  const total = visible.reduce((sum, entry) => sum + entry.value, 0n);
  if (total === 0n) return;
  const document = container.ownerDocument;
  const svg = svgElement(document, "svg", { viewBox: "0 0 100 100", "aria-hidden": "true", class: "visualization-donut" });
  const legend = text(document, "ul", "", "visualization-donut-legend");
  const circumference = 2 * Math.PI * 32;
  let offset = 0;
  visible.forEach((entry, index) => {
    const color = COLORS[index % COLORS.length];
    const fraction = Number(entry.value * 1000000n / total) / 1000000;
    svg.append(svgElement(document, "circle", {
      cx: 50, cy: 50, r: 32, fill: "none", stroke: color, "stroke-width": 15,
      "stroke-dasharray": `${fraction * circumference} ${circumference}`,
      "stroke-dashoffset": -offset * circumference, transform: "rotate(-90 50 50)",
    }));
    offset += fraction;
    const item = text(document, "li", "", "visualization-donut-item");
    const name = text(document, "span", entry.name, "visualization-key");
    const marker = text(document, "span", "", "visualization-marker");
    marker.style.backgroundColor = color;
    name.prepend(marker);
    const hundredths = Number((entry.value * 10000n + total / 2n) / total);
    const percentage = hundredths === 0 ? "<0,01 %" : `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(hundredths / 100)} %`;
    item.append(name, text(document, "strong", `${format(entry.value)} · ${percentage}`));
    legend.append(item);
  });
  container.append(svg, legend);
}

export function pieChart3D(container, entries, format, onSelect, selectedKey) {
  container.replaceChildren();
  const visible = entries.filter((entry) => entry.value > 0n);
  const total = visible.reduce((sum, entry) => sum + entry.value, 0n);
  if (!entries.length) return;
  const document = container.ownerDocument;
  const svg = svgElement(document, "svg", { viewBox: "0 0 320 210", class: "category-pie", "aria-hidden": "true" });
  const sides = svgElement(document, "g");
  const tops = svgElement(document, "g");
  svg.append(sides, tops);
  const legend = text(document, "ul", "", "category-pie-legend");
  const point = (angle, depth = 0) => [160 + 125 * Math.cos(angle), 100 + 70 * Math.sin(angle) + depth];
  const coords = (value) => value.map((v) => Number(v.toFixed(5))).join(" ");
  const parts = [];
  let selectedIndex = -1;
  let start = -Math.PI / 2;
  visible.forEach((entry, index) => {
    const end = index === visible.length - 1 ? 3 * Math.PI / 2
      : start + 2 * Math.PI * (Number(entry.value) / Number(total));
    const color = COLORS[index % COLORS.length];
    const top = svgElement(document, "g", { class: "category-pie-slice" });
    const side = svgElement(document, "g", { class: "category-pie-slice category-pie-side" });
    const startPoint = coords(point(start));
    const endPoint = coords(point(end));
    const topPath = visible.length === 1
      ? `M ${startPoint} A 125 70 0 1 1 ${coords(point(start + Math.PI))} A 125 70 0 1 1 ${startPoint} Z`
      : `M 160 100 L ${startPoint} A 125 70 0 ${end - start > Math.PI ? 1 : 0} 1 ${endPoint} Z`;
    top.append(svgElement(document, "path", { d: topPath, fill: color, class: "category-pie-top" }));
    const frontStart = Math.max(start, 0);
    const frontEnd = Math.min(end, Math.PI);
    if (frontEnd > frontStart) {
      const frontPath = `M ${coords(point(frontStart))} A 125 70 0 0 1 ${coords(point(frontEnd))} `
        + `L ${coords(point(frontEnd, 16))} A 125 70 0 0 0 ${coords(point(frontStart, 16))} Z`;
      side.append(svgElement(document, "path", { d: frontPath, fill: color }));
    }
    sides.append(side);
    tops.append(top);
    const hundredths = (entry.value * 10000n + total / 2n) / total;
    const percentage = hundredths === 0n ? "<0,01 %"
      : `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(Number(hundredths) / 100)} %`;
    const item = text(document, "li", "", "category-pie-legend-item");
    const button = text(document, "button", "", "category-pie-choice");
    button.type = "button";
    const name = text(document, "span", entry.name, "visualization-key");
    const marker = text(document, "span", "", "visualization-marker");
    marker.style.backgroundColor = color;
    name.prepend(marker);
    button.append(name, text(document, "strong", `${format(entry.value)} · ${percentage}`));
    item.append(button);
    legend.append(item);
    parts.push({ entry, top, side, button, color });
    for (const target of [top, side, button]) {
      target.addEventListener("mouseenter", () => select(index));
      target.addEventListener("click", () => select(index));
    }
    button.addEventListener("focus", () => select(index));
    start = end;
  });
  for (const entry of entries.filter((entry) => entry.value === 0n)) {
    const color = COLORS[parts.length % COLORS.length];
    const item = text(document, "li", "", "category-pie-legend-item");
    const button = text(document, "button", "", "category-pie-choice");
    button.type = "button";
    const name = text(document, "span", entry.name, "visualization-key");
    const marker = text(document, "span", "", "visualization-marker");
    marker.style.backgroundColor = color;
    name.prepend(marker);
    button.append(name, text(document, "strong", "Sin gasto este mes"));
    item.append(button);
    legend.append(item);
    const index = parts.length;
    parts.push({ entry, top: null, side: null, button, color });
    button.addEventListener("mouseenter", () => select(index));
    button.addEventListener("click", () => select(index));
    button.addEventListener("focus", () => select(index));
  }
  function select(index) {
    if (selectedIndex === index) return;
    selectedIndex = index;
    for (const [partIndex, part] of parts.entries()) {
      const active = partIndex === index;
      part.top?.classList.toggle("is-selected", active);
      part.side?.classList.toggle("is-selected", active);
      part.button.setAttribute("aria-pressed", String(active));
    }
    if (parts[index].top) tops.append(parts[index].top);
    if (parts[index].side) sides.append(parts[index].side);
    onSelect(parts[index].entry, parts[index].color);
  }
  if (visible.length) container.append(svg);
  container.append(legend);
  const selected = parts.findIndex((part) => part.entry.key === selectedKey);
  select(selected < 0 ? 0 : selected);
}
