import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  subtotal,
  calculateChange,
  safeChange,
  safeTotals,
  totals,
  validationErrors,
  sumDecimals,
  baselineProblems,
} from "../src/services/pricing";
import { createChange, createDraft } from "../src/types";
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
  credit.original!.id = "credited-original";
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

test("split unit rates retain decimal precision before extending the quantity", () => {
  assert.equal(sumDecimals(["0.005", "0.005", "-0.001"]), "0.009");
  assert.equal(subtotal("100", sumDecimals(["0.005", "0.005"])), 100);
  assert.equal(sumDecimals(["0.00", "-692.08"]), "-692.08");
});

test("rendering math treats missing or malformed values as zero instead of failing", () => {
  assert.deepEqual(safeTotals(createDraft()), {
    net: 0,
    original: 0,
    previous: 0,
    prior: 0,
    revised: 0,
  });
  const d = validDraft();
  assert.deepEqual(safeChange(d.changes[0]), calculateChange(d.changes[0]));
  assert.deepEqual(safeTotals(d), totals(d));
  d.job.originalContract = "not money";
  d.job.previousChanges = "";
  d.changes[0].quantity = "";
  d.changes[0].customerPrice = { total: "", tax: "", op: "" };
  const safe = safeTotals(d);
  assert.equal(safe.original, 0);
  assert.equal(safe.previous, 0);
  assert.equal(safe.net, -22400);
  // An unreadable revised amount still prints the printed RCV baseline.
  assert.equal(safeChange(d.changes[0]).original, 22400);
  assert.equal(safeChange(d.changes[0]).revised, 0);
  assert.throws(() => totals(d));
});

test("existing estimate credits can be confirmed, revised, or removed", () => {
  const d = validDraft();
  Object.assign(d.changes[0].original!, {
    quantity: "1",
    rate: "-692.08",
    tax: "0",
    op: "0",
    rcv: "-692.08",
  });
  d.changes[0] = createChange(d.changes[0].original, "revise");
  Object.assign(d.changes[0], {
    reason: "Adjust labor credit",
    pricingConfirmed: true,
  });
  assert.deepEqual(baselineProblems(d.changes[0].original!), []);
  assert.deepEqual(validationErrors(d), []);
  assert.deepEqual(calculateChange(d.changes[0]), {
    original: -69208,
    revised: -69208,
    delta: 0,
  });
  d.changes[0].quantity = "2";
  assert.deepEqual(calculateChange(d.changes[0]), {
    original: -69208,
    revised: -138416,
    delta: -69208,
  });
  d.changes[0].action = "remove";
  assert.deepEqual(calculateChange(d.changes[0]), {
    original: -69208,
    revised: 0,
    delta: 69208,
  });
  d.changes[0].original!.rcv = "";
  d.changes[0].action = "revise";
  assert.ok(validationErrors(d).some((e) => e.includes("original estimate")));
});
