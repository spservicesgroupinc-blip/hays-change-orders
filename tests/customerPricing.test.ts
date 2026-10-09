import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateChange,
  totals,
  validationErrors,
} from "../src/services/pricing";
import { createChange } from "../src/types";
import { validDraft } from "./helpers";

test("all-in revised customer total uses printed RCV and includes breakdown without adding it again", () => {
  const draft = validDraft();
  const row = draft.changes[0];
  row.original!.rcv = "224.01";
  row.customerPrice = { total: "350.01", tax: "15.00", op: "45.00" };
  assert.deepEqual(calculateChange(row), {
    original: 22401,
    revised: 35001,
    delta: 12600,
  });
  row.quantity = row.rate = row.tax = row.op = "";
  assert.deepEqual(validationErrors(draft), []);
  row.customerPrice.tax = row.customerPrice.op = null;
  assert.equal(calculateChange(row).revised, 35001);
});

test("several full original credits plus one all-in replacement agree with contract totals", () => {
  const draft = validDraft();
  draft.changes[0].action = "remove";
  const another = structuredClone(draft.changes[0]);
  another.id = "other-change";
  another.original!.id = "other-original";
  another.original!.rcv = "100.00";
  const replacement = createChange(null);
  Object.assign(replacement, {
    description: "Replace all affected work",
    reason: "Revised scope",
    pricingConfirmed: true,
    customerPrice: { total: "324.00", tax: null, op: null },
  });
  draft.changes.push(another, replacement);
  assert.equal(totals(draft).net, 0);
  assert.equal(totals(draft).revised, 1000000);
  assert.deepEqual(validationErrors(draft), []);
});

test("manual credit accepts positive dollars and cannot double-credit a selected original", () => {
  const row = createChange(null, "remove");
  row.manualCredit = "75.50";
  assert.deepEqual(calculateChange(row), {
    original: 0,
    revised: -7550,
    delta: -7550,
  });
  row.manualCredit = "-75.50";
  assert.throws(() => calculateChange(row), /positive manual credit/);
  row.manualCredit = "0";
  assert.throws(() => calculateChange(row));
  row.manualCredit = "75.50";
  row.original = validDraft().changes[0].original;
  assert.throws(() => calculateChange(row), /without an original/);
  delete row.manualCredit;
  row.original = null;
  assert.throws(() => calculateChange(row), /Select an original/);
});

test("duplicate source baselines and unconfirmed all-in pricing block final generation", () => {
  const draft = validDraft();
  draft.changes[0].customerPrice = { total: "300.00", tax: null, op: null };
  draft.changes[0].pricingConfirmed = false;
  assert.ok(
    validationErrors(draft).some((error) =>
      error.includes("confirm the pricing"),
    ),
  );
  const copy = structuredClone(draft.changes[0]);
  copy.id = "copy";
  draft.changes.push(copy);
  assert.ok(
    validationErrors(draft).some((error) =>
      error.includes("already priced elsewhere"),
    ),
  );
  draft.changes[0].customerPrice.tax = "400";
  assert.throws(() => calculateChange(draft.changes[0]), /cannot exceed/);
});

test("all-in revisions preserve legitimate signed original credits", () => {
  const row = validDraft().changes[0];
  row.original!.rcv = "-100.00";
  row.customerPrice = { total: "-150.00", tax: null, op: null };
  assert.deepEqual(calculateChange(row), {
    original: -10000,
    revised: -15000,
    delta: -5000,
  });
  row.original = null;
  assert.throws(() => calculateChange(row), /final customer price/);
});
