import assert from "node:assert/strict";
import { test } from "node:test";
import { expenseShare } from "../../frontend/chart.js";

test("calcula la proporción usando el total del mes y muestra valores pequeños", () => {
  assert.deepEqual(expenseShare("195000.00", "1000000.00"), { width: 19.5, label: "19,5 %" });
  assert.deepEqual(expenseShare("1.00", "3.00"), { width: 33.33, label: "33,33 %" });
  assert.deepEqual(expenseShare("0.01", "1000000.00"), { width: 0, label: "<0,01 %" });
  assert.deepEqual(expenseShare("9007199254740993.00", "9007199254740993.00"), { width: 100, label: "100 %" });
});

test("rechaza datos inconsistentes en lugar de mostrar porcentajes incorrectos", () => {
  assert.throws(() => expenseShare("1.00", "0.00"));
  assert.throws(() => expenseShare("2.00", "1.00"));
  assert.throws(() => expenseShare("1.234", "10.00"));
});
