import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  subtotal,
  calculateChange,
  totals,
  validationErrors,
} from "../src/services/pricing";
import { createChange } from "../src/types";
import { validDraft } from "./helpers";
test("decimal multiplication rounds half cents consistently without floating point drift", () => {
  assert.equal(cents("1.005"), 101);
  assert.equal(cents("-1.005"), -101);
  assert.equal(subtotal("0.1", "0.2"), 2);
  assert.equal(subtotal("2.675", "1"), 268);
  assert.equal(subtotal("3", "0.335"), 101);
  assert.throws(() => cents("NaN"));
  assert.throws(() => cents("1e3"));
});
test("revision uses printed RCV, rounded baseline, and PM-entered tax/O&P", () => {
  const d = validDraft();
  assert.deepEqual(calculateChange(d.changes[0]), {
    original: 22400,
    revised: 33600,
    delta: 11200,
  });
  d.changes[0].original!.rcv = "224.01";
  assert.equal(calculateChange(d.changes[0]).delta, 11200);
  Object.assign(d.changes[0], { quantity: "100", tax: "4.00", op: "20.00" });
  assert.equal(calculateChange(d.changes[0]).delta, 0);
});
test("full credit includes original tax and O&P, while new work starts at zero", () => {
  const d = validDraft();
  d.changes[0].action = "remove";
  assert.deepEqual(calculateChange(d.changes[0]), {
    original: 22400,
    revised: 0,
    delta: -22400,
  });
  const add = createChange(null);
  Object.assign(add, { quantity: "2", rate: "100", tax: "12", op: "40" });
  assert.deepEqual(calculateChange(add), {
    original: 0,
    revised: 25200,
    delta: 25200,
  });
});
test("mixed changes, previous credits, and zero-net contract totals", () => {
  const d = validDraft();
  d.job.previousChanges = "-500";
  const credit = structuredClone(d.changes[0]);
  credit.id = "credit";
  credit.action = "remove";
  d.changes.push(credit);
  assert.equal(totals(d).net, -11200);
  assert.equal(totals(d).revised, 938800);
  d.changes[0].quantity = "200";
  d.changes[0].tax = "8";
  d.changes[0].op = "40";
  assert.equal(totals(d).net, 0);
  assert.equal(validationErrors(d).length, 0);
});
test("final generation requires confirmed originals, tax/O&P, valid revised values, and required job details", () => {
  const d = validDraft();
  assert.deepEqual(validationErrors(d), []);
  d.changes[0].pricingConfirmed = false;
  assert.ok(validationErrors(d).some((e) => e.includes("confirm the pricing")));
  d.changes[0].pricingConfirmed = true;
  d.changes[0].original!.reviewed = false;
  assert.ok(validationErrors(d).some((e) => e.includes("original estimate")));
  d.job.addedDays = "-1";
  d.job.customer = "";
  d.changes[0].rate = "";
  assert.ok(validationErrors(d).length >= 4);
});
test("invalid calendar dates are rejected rather than rolling into the next month", () => {
  const d = validDraft();
  d.job.date = "2026-02-31";
  assert.ok(validationErrors(d).includes("Enter a valid change-order date."));
  d.job.date = "2026-02-28";
  assert.deepEqual(validationErrors(d), []);
});
