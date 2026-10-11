import type { JobDetails } from "../types";

/** Canonical decimal dollars, at most two fractional digits. Never use floats. */
export function moneyCents(value: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return (match[1] ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0")));
}

export function formatCents(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const dollars = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value < 0n ? "-" : ""}$${dollars}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

export function contractAmounts(job: Pick<JobDetails, "originalContract" | "previousChanges">) {
  const original = moneyCents(job.originalContract);
  const previous = job.previousChanges.trim() ? moneyCents(job.previousChanges) : 0n;
  return {
    original: original !== null ? formatCents(original) : job.originalContract.trim() ? "Unavailable" : "Not provided",
    previous: previous !== null ? formatCents(previous) : "Unavailable",
    total: original !== null && previous !== null ? formatCents(original + previous)
      : !job.originalContract.trim() && previous !== null ? "Not provided" : "Unavailable",
  };
}
