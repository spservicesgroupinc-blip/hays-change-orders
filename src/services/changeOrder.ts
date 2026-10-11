import type { ChangeRequest } from "../types";
import { moneyCents, formatCents } from "./contract";

export const signedMoneyCents = (value: string): bigint | null =>
  /^[+-]?\d+(?:\.\d{1,2})?$/.test(value.trim())
    ? moneyCents(value.trim().replace(/^\+/, ""))
    : null;

export function signedAmountLabel(value: string | undefined): string {
  if (!value?.trim()) return "Not provided";
  const cents = signedMoneyCents(value);
  return cents === null
    ? "Unavailable"
    : `${cents > 0n ? "+" : ""}${formatCents(cents)}`;
}

export function pricingInputError(
  request: Pick<
    ChangeRequest,
    "lineNumbers" | "knownChangeAmount" | "finalChangeOrder"
  >,
): string {
  if (
    request.lineNumbers?.trim() &&
    !/^[+-][1-9]\d*(?:[\s,]+[+-][1-9]\d*)*$/.test(request.lineNumbers.trim())
  )
    return "Enter a line number greater than zero in each row and choose Add or Remove.";
  for (const [label, value] of [
    ["Known change amount", request.knownChangeAmount],
    ["Final change amount", request.finalChangeOrder?.amount],
  ])
    if (value?.trim() && signedMoneyCents(value) === null)
      return `${label} must be dollars with at most two decimal places, such as +1250.19 or -250.00.`;
  return "";
}

export function finalDocumentError(request: ChangeRequest): string {
  const job = request.job;
  for (const [label, value] of [
    ["Customer name", job.customer],
    ["Property address", job.address],
    ["Job number", job.jobNumber],
    ["Change-order number", job.orderNumber],
    ["Change-order date", job.date],
    ["Final customer scope", request.finalChangeOrder?.scope],
  ])
    if (!value?.trim())
      return `Enter ${label!.toLowerCase()} in Prepare customer document, then save changes.`;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(job.date) ||
    Number.isNaN(Date.parse(job.date)) ||
    new Date(job.date).toISOString().slice(0, 10) !== job.date
  )
    return "Enter a valid change-order date.";
  if (
    moneyCents(job.originalContract ?? "") === null ||
    (job.previousChanges?.trim() && moneyCents(job.previousChanges) === null)
  )
    return "Enter valid original contract and previous authorized change amounts before generating the customer document.";
  if (
    !request.finalChangeOrder?.amount.trim() ||
    signedMoneyCents(request.finalChangeOrder.amount) === null
  )
    return "Enter a final change amount (use 0.00 for no price change), then save changes.";
  if (!/^\d+$/.test(job.addedDays.trim()))
    return "Enter added days as a whole number (use 0 for no change).";
  return pricingInputError(request);
}

export function finalContractTotal(request: ChangeRequest): string {
  const original = moneyCents(request.job.originalContract ?? "");
  const previous = request.job.previousChanges?.trim()
    ? moneyCents(request.job.previousChanges)
    : 0n;
  const change = signedMoneyCents(request.finalChangeOrder?.amount ?? "");
  return original === null || previous === null || change === null
    ? "Unavailable"
    : formatCents(original + previous + change);
}
