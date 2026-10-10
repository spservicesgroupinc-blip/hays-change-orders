import type { ChangeRequest, JobEntry } from "../types";
import { parseMoney } from "./jobImport";

// The job directory imported from the Dash JobSummaryReport carries the
// customer's "Estimate Amount": the original contract for that job number. The
// picker copies it into a new request, but a request created by typing a job
// number, an older request, or a request converted from a legacy draft never
// goes through the picker. This module is the shared, framework-free rule for
// filling that amount in from the directory, so every change order gets the
// original contract and not only the picked ones.

// A request only receives the directory amount while it is still with the
// project manager. Submitted work belongs to the estimator, and the server
// refuses edits to submitted/ready/completed requests outright, so those are
// never touched.
const PM_STAGE_STATUSES: ChangeRequest["status"][] = [
  "draft",
  "needs_information",
];

function normalizeJobNumber(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

// Job numbers are typed by hand and exported from Dash, so they are matched
// case-insensitively and without surrounding whitespace. A blank search number
// matches nothing (otherwise every job with a blank number would collide).
export function findJobByNumber(
  jobs: JobEntry[],
  jobNumber: string,
): JobEntry | undefined {
  const wanted = normalizeJobNumber(jobNumber);
  if (!wanted) return undefined;
  return jobs.find((job) => normalizeJobNumber(job?.jobNumber) === wanted);
}

function amountOf(job: JobEntry): string {
  return String(job.contractAmount ?? "").trim();
}

// The directory amount for a job number, or "" when the job is unknown or the
// export carried no amount for it. Never returns a placeholder, so callers can
// treat "" as "nothing to apply".
export function contractAmountForJob(
  jobs: JobEntry[],
  jobNumber: string,
): string {
  const job = findJobByNumber(jobs, jobNumber);
  return job ? amountOf(job) : "";
}

// True while the project manager still owns the request. Locked and completed
// requests are past this point and must never be edited automatically.
export function isPmStageRequest(request: ChangeRequest): boolean {
  return PM_STAGE_STATUSES.includes(request.status);
}

// Fill the customer's original contract amount from the directory. Returns the
// SAME request object (referential identity) when there is nothing to change,
// so a caller can skip the save entirely. Rules:
// - the request's own amount wins whenever it is parseable money, even if it
//   differs from the directory: a number a person entered is never overwritten;
// - a blank directory amount never clears anything;
// - a matched job number is recorded in jobDirectoryId, including when the
//   directory has no amount for it;
// - contractConfirmed is left alone (requests.ts reconciliation clears it when
//   a job field changes).
export function applyDirectoryContractAmount(
  request: ChangeRequest,
  jobs: JobEntry[],
): ChangeRequest {
  const jobNumber = request.job?.jobNumber ?? "";
  const job = findJobByNumber(jobs, jobNumber);
  if (!job) return request;
  const directoryId = job.id || undefined;
  const directoryAmount = amountOf(job);
  const current = request.job?.originalContract ?? "";
  // parseMoney("") is "", and unparseable text (e.g. "n/a") also parses to "" —
  // both mean there is no usable amount of the PM's own to protect.
  // The one parseable value that may be replaced is one this helper filled in
  // earlier: after the PM retypes the job number (including a prefix keystroke
  // that briefly matched another job) the amount has to follow the job now
  // typed instead of leaving the previous job's contract on the change order.
  // That is only assumed while the earlier matched row is still in the
  // directory and the amount is still exactly that row's amount, so a hand-typed
  // figure is never mistaken for ours.
  const previousRow = request.jobDirectoryId
    ? jobs.find((row) => row.id === request.jobDirectoryId)
    : undefined;
  const filledByDirectory = Boolean(
    previousRow && amountOf(previousRow) && current === amountOf(previousRow),
  );
  const filled =
    directoryAmount && (!parseMoney(current) || filledByDirectory)
      ? directoryAmount
      : current;
  if (filled === current && request.jobDirectoryId === directoryId) {
    return request;
  }
  return {
    ...request,
    jobDirectoryId: directoryId,
    job: { ...request.job, originalContract: filled },
  };
}

// The safety net App.tsx runs for the open request: same as
// applyDirectoryContractAmount, but a completed/locked or estimator-stage
// request is returned untouched (same object).
export function applyDirectoryContractAmountForPmRequest(
  request: ChangeRequest,
  jobs: JobEntry[],
): ChangeRequest {
  if (!isPmStageRequest(request)) return request;
  return applyDirectoryContractAmount(request, jobs);
}
