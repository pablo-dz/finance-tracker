function toCents(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error("El monto recibido no es válido.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function expenseShare(amount, total) {
  const value = toCents(amount);
  const sum = toCents(total);
  if (sum === 0n || value > sum) throw new Error("El total de gastos no es válido.");
  const hundredths = Number((value * 10000n + sum / 2n) / sum);
  return {
    width: hundredths / 100,
    label: value > 0n && hundredths === 0
      ? "<0,01 %"
      : `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(hundredths / 100)} %`,
  };
}
