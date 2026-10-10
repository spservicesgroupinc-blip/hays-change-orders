import type { ChangeItem, ChangeOrderDraft, EstimateItem } from "../types";
const DECIMAL = /^-?\d+(?:\.\d{1,6})?$/;
function fraction(value: string): { n: bigint; scale: bigint } {
  if (!DECIMAL.test(value.trim()))
    throw new Error("Enter a valid decimal (up to 6 decimal places).");
  const [whole, decimal = ""] = value.trim().split(".");
  return { n: BigInt(whole + decimal), scale: 10n ** BigInt(decimal.length) };
}
function round(n: bigint, d: bigint): bigint {
  const negative = n < 0n;
  const magnitude = negative ? -n : n;
  const result = (magnitude + d / 2n) / d;
  return negative ? -result : result;
}
function safe(n: bigint): number {
  const value = Number(n);
  if (!Number.isSafeInteger(value) || Math.abs(value) > 1_000_000_000_000)
    throw new Error("Amount is too large.");
  return value;
}
export function cents(value: string): number {
  const f = fraction(value);
  return safe(round(f.n * 100n, f.scale));
}
export function subtotal(quantity: string, rate: string): number {
  const q = fraction(quantity),
    r = fraction(rate);
  return safe(round(q.n * r.n * 100n, q.scale * r.scale));
}
// Unit rates may have more than two decimal places. Combine them before
// rounding the extended quantity, rather than rounding each rate to cents.
export function sumDecimals(values: string[]): string {
  const fractions = values.map(fraction);
  const scale = fractions.reduce(
    (max, f) => (f.scale > max ? f.scale : max),
    1n,
  );
  const total = fractions.reduce((sum, f) => sum + f.n * (scale / f.scale), 0n);
  const digits = scale.toString().length - 1;
  const magnitude = (total < 0n ? -total : total)
    .toString()
    .padStart(digits + 1, "0");
  const result = digits
    ? `${magnitude.slice(0, -digits)}.${magnitude.slice(-digits)}`
    : magnitude;
  return `${total < 0n ? "-" : ""}${result}`;
}
export function validDecimal(value: string, allowNegative = false): boolean {
  try {
    const f = fraction(value);
    safe((f.n * 100n) / f.scale);
    return allowNegative || f.n >= 0n;
  } catch {
    return false;
  }
}
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value / 100,
  );
export const signedMoney = (value: number) =>
  `${value > 0 ? "+" : ""}${money(value)}`;
export function baselineProblems(item: EstimateItem): string[] {
  const problems: string[] = [];
  if (!item.description.trim()) problems.push("Description is required.");
  if (!item.unit.trim()) problems.push("Unit is required.");
  for (const key of ["quantity", "rate", "tax", "op", "rcv"] as const)
    if (!validDecimal(item[key], key !== "quantity"))
      problems.push(
        `${key === "op" ? "O&P" : key.toUpperCase()} needs a valid ${key === "quantity" ? "nonnegative " : ""}number.`,
      );
  return problems;
}
export function calculateChange(item: ChangeItem): {
  original: number;
  revised: number;
  delta: number;
} {
  const original = item.original ? cents(item.original.rcv) : 0;
  if (item.manualCredit !== undefined) {
    if (
      item.action !== "remove" ||
      item.original ||
      item.customerPrice ||
      !validDecimal(item.manualCredit) ||
      cents(item.manualCredit) <= 0
    )
      throw new Error(
        "Enter a positive manual credit without an original estimate item.",
      );
    const revised = -cents(item.manualCredit);
    return { original: 0, revised, delta: revised };
  }
  if (item.action === "remove") {
    if (!item.original || item.customerPrice)
      throw new Error(
        "Select an original item to remove, or enter a manual credit.",
      );
    return { original, revised: 0, delta: -original };
  }
  if (item.customerPrice) {
    const price = item.customerPrice;
    if (item.quantity.trim() && !validDecimal(item.quantity))
      throw new Error(
        "Enter a nonnegative scope quantity or leave it blank for a lump sum.",
      );
    if (!validDecimal(price.total, original < 0))
      throw new Error("Enter the final customer price including tax and O&P.");
    for (const part of [price.tax, price.op])
      if (part !== null && !validDecimal(part, original < 0))
        throw new Error("Enter known tax/O&P dollars or mark them Included.");
    const revised = cents(price.total);
    const knownParts = [price.tax, price.op].reduce<number>(
      (sum, value) => sum + (value === null ? 0 : cents(value)),
      0,
    );
    if (revised >= 0 && knownParts > revised)
      throw new Error(
        "Included tax and O&P cannot exceed the final customer price.",
      );
    return { original, revised, delta: revised - original };
  }
  const revisedBase = subtotal(item.quantity, item.rate);
  const revised = item.original
    ? original +
      revisedBase -
      subtotal(item.original.quantity, item.original.rate) +
      cents(item.tax) -
      cents(item.original.tax) +
      cents(item.op) -
      cents(item.original.op)
    : revisedBase + cents(item.tax) + cents(item.op);
  if (revised < 0 && original >= 0)
    throw new Error(
      "Revised item total cannot be negative unless the original item is a credit.",
    );
  return { original, revised, delta: revised - original };
}
export function totals(draft: ChangeOrderDraft) {
  const net = draft.changes.reduce(
    (sum, row) => sum + calculateChange(row).delta,
    0,
  );
  const original = cents(draft.job.originalContract);
  const previous = cents(draft.job.previousChanges);
  return {
    net,
    original,
    previous,
    prior: original + previous,
    revised: original + previous + net,
  };
}
// Estimators may generate the customer packet as soon as they want, so the
// rendering math below treats missing or malformed input as $0.00 instead of
// failing. The editing math above stays strict so the estimator still sees
// exactly which value needs attention.
export function safeCents(value: string): number {
  try {
    return cents(value);
  } catch {
    return 0;
  }
}
function safeSubtotal(quantity: string, rate: string): number {
  try {
    return subtotal(quantity, rate);
  } catch {
    return 0;
  }
}
export function safeChange(item: ChangeItem): {
  original: number;
  revised: number;
  delta: number;
} {
  const original = item.original ? safeCents(item.original.rcv) : 0;
  if (item.manualCredit !== undefined) {
    const credit = safeCents(item.manualCredit);
    const revised = credit > 0 ? -credit : 0;
    return { original, revised, delta: revised };
  }
  if (item.action === "remove")
    return { original, revised: 0, delta: -original };
  if (item.customerPrice) {
    const revised = safeCents(item.customerPrice.total);
    return { original, revised, delta: revised - original };
  }
  const base = safeSubtotal(item.quantity, item.rate);
  const revised = item.original
    ? original +
      base -
      safeSubtotal(item.original.quantity, item.original.rate) +
      safeCents(item.tax) -
      safeCents(item.original.tax) +
      safeCents(item.op) -
      safeCents(item.original.op)
    : base + safeCents(item.tax) + safeCents(item.op);
  return { original, revised, delta: revised - original };
}
export function safeTotals(draft: ChangeOrderDraft) {
  const net = draft.changes.reduce(
    (sum, row) => sum + safeChange(row).delta,
    0,
  );
  const original = safeCents(draft.job.originalContract);
  const previous = safeCents(draft.job.previousChanges);
  return {
    net,
    original,
    previous,
    prior: original + previous,
    revised: original + previous + net,
  };
}
export function generatedScope(changes: ChangeItem[]): string {
  return changes
    .map(
      (item) =>
        `${item.manualCredit !== undefined ? "Credit" : item.action === "add" ? "Add" : item.action === "remove" ? "Remove" : "Revise"} ${item.room ? `${item.room}: ` : ""}${item.description}${item.reason.trim() ? ` - ${item.reason.trim()}` : ""}.`,
    )
    .join("\n");
}
export function scopeText(draft: ChangeOrderDraft): string {
  return draft.scopeEdited ? draft.scope : generatedScope(draft.changes);
}
export function validationErrors(draft: ChangeOrderDraft): string[] {
  const errors: string[] = [];
  const required = [
    "customer",
    "address",
    "jobNumber",
    "projectManager",
    "branchName",
    "branchAddress",
    "branchPhone",
    "branchContact",
    "orderNumber",
    "date",
  ] as const;
  const labels: Record<string, string> = {
    customer: "Customer",
    address: "Property address",
    jobNumber: "Job number",
    projectManager: "Project manager",
    branchName: "Branch name",
    branchAddress: "Branch address",
    branchPhone: "Branch phone",
    branchContact: "Branch contact",
    orderNumber: "Change-order number",
    date: "Change-order date",
  };
  for (const key of required)
    if (!draft.job[key].trim()) errors.push(`${labels[key]} is required.`);
  if (
    draft.job.insuranceRelated &&
    (!draft.job.carrier.trim() || !draft.job.claim.trim())
  )
    errors.push("Enter the insurance carrier and claim number.");
  const parsedDate = new Date(`${draft.job.date}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.job.date) ||
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== draft.job.date
  )
    errors.push("Enter a valid change-order date.");
  if (!validDecimal(draft.job.originalContract))
    errors.push("Enter the original contract amount.");
  if (!validDecimal(draft.job.previousChanges, true))
    errors.push("Enter previous authorized changes (use 0 if none).");
  if (!/^\d+$/.test(draft.job.addedDays) || Number(draft.job.addedDays) > 3650)
    errors.push("Added working days must be a whole number from 0 to 3650.");
  if (!draft.changes.length) errors.push("Add at least one changed item.");
  if (!scopeText(draft).trim()) errors.push("Enter a scope summary.");
  const originals = new Set<string>();
  draft.changes.forEach((row, index) => {
    const prefix = `Item ${index + 1}`;
    if (row.original) {
      if (originals.has(row.original.id))
        errors.push(
          `${prefix}: the original estimate item is already priced elsewhere in this order.`,
        );
      originals.add(row.original.id);
    }
    if (
      (row.action === "add" && row.original) ||
      (row.action === "revise" && !row.original)
    )
      errors.push(
        `${prefix}: additions start at zero; revisions need an original estimate item.`,
      );
    if (
      row.original &&
      (baselineProblems(row.original).length || !row.original.reviewed)
    )
      errors.push(
        `${prefix}: review and correct the original estimate values.`,
      );
    if (!row.description.trim() || !row.reason.trim())
      errors.push(`${prefix}: enter a description and reason.`);
    if (
      row.action !== "remove" &&
      !row.customerPrice &&
      (!row.unit.trim() ||
        ["quantity", "rate", "tax", "op"].some(
          (key) =>
            !validDecimal(
              row[key as "quantity"],
              key !== "quantity" &&
                Boolean(
                  row.original &&
                    validDecimal(row.original.rcv, true) &&
                    cents(row.original.rcv) < 0,
                ),
            ),
        ))
    )
      errors.push(
        `${prefix}: complete the revised quantity, unit, price, tax, and O&P.`,
      );
    if (!row.pricingConfirmed)
      errors.push(`${prefix}: confirm the pricing and tax/O&P.`);
    try {
      calculateChange(row);
    } catch {
      errors.push(`${prefix}: correct the pricing values.`);
    }
  });
  try {
    if (totals(draft).revised < 0)
      errors.push("The revised contract amount cannot be negative.");
  } catch {
    /* detailed field errors above */
  }
  return [...new Set(errors)];
}
