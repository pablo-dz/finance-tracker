const SVG_NS = "http://www.w3.org/2000/svg";
const COLORS = ["#287c58", "#b94a48", "#446fa0", "#aa6b10", "#75539d", "#217b82", "#9d5074", "#697a38"];

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

export function lineChart(container, labels, series, format) {
  container.replaceChildren();
  if (!labels.length) return;
  const document = container.ownerDocument;
  const values = series.flatMap((entry) => entry.values);
  let min = 0n;
  let max = 0n;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min;
  const y = (value) => range === 0n ? 190 : 20 + Number(((max - value) * 17000n) / range) / 100;
  const x = (index) => labels.length === 1 ? 360 : 30 + index * 660 / (labels.length - 1);
  const scale = text(document, "p",
    `Máximo: ${format(max)} · Punto medio: ${format(min + range / 2n)} · Mínimo: ${format(min)}`,
    "visualization-scale");
  const hint = text(document, "p", "Desliza horizontalmente para ver el gráfico completo.", "visualization-hint");
  const legend = text(document, "div", "", "visualization-legend");
  const wrapper = text(document, "div", "", "visualization-scroll");
  const svg = svgElement(document, "svg", { viewBox: "0 0 720 225", "aria-hidden": "true", class: "visualization-line" });
  for (const gridY of [20, 105, 190]) {
    svg.append(svgElement(document, "line", { x1: 30, x2: 690, y1: gridY, y2: gridY, class: "visualization-grid" }));
  }
  if (min < 0n && max > 0n) {
    svg.append(svgElement(document, "line", { x1: 30, x2: 690, y1: y(0n), y2: y(0n), class: "visualization-zero" }));
  }
  labels.forEach((label, index) => {
    const tick = svgElement(document, "text", { x: x(index), y: 215, "text-anchor": "middle" });
    tick.textContent = label;
    svg.append(tick);
  });
  series.forEach((entry, index) => {
    const color = COLORS[index % COLORS.length];
    const key = text(document, "span", entry.name, "visualization-key");
    const marker = text(document, "span", "", "visualization-marker");
    marker.style.backgroundColor = color;
    key.prepend(marker);
    legend.append(key);
    const points = entry.values.map((value, i) => `${x(i)},${y(value)}`).join(" ");
    svg.append(svgElement(document, "polyline", {
      points, fill: "none", stroke: color, "stroke-width": 3,
      "stroke-linejoin": "round", "stroke-linecap": "round",
      ...(index === 1 ? { "stroke-dasharray": "8 4" } : {}),
      ...(index === 2 ? { "stroke-dasharray": "2 4" } : {}),
    }));
    entry.values.forEach((value, i) => svg.append(svgElement(document, "circle", {
      cx: x(i), cy: y(value), r: 3, fill: color,
    })));
  });
  wrapper.append(svg);
  container.append(legend, scale, hint, wrapper);
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
