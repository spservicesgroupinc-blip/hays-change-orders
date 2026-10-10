import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDirectoryContractAmount,
  applyDirectoryContractAmountForPmRequest,
  contractAmountForJob,
  findJobByNumber,
  isPmStageRequest,
} from "../src/services/jobDirectory";
import { createRequest } from "../src/services/requests";
import type { ChangeRequest, JobEntry } from "../src/types";

// A directory row as the admin's JobSummaryReport import produces it: the
// "Estimate Amount" column is already normalized to the canonical decimal
// string by jobImport.parseMoney.
function job(overrides: Partial<JobEntry> = {}): JobEntry {
  return {
    id: "job-1",
    jobNumber: "F-26-0401-R",
    customer: "Harper Quinn",
    address: "88 Riverbend Dr., Fort Wayne, IN 46805",
    projectManager: "Lance Stanley",
    estimator: "Russell Shive",
    status: "Work in Progress",
    customerPhone: "",
    customerEmail: "",
    contractAmount: "84200.75",
    active: true,
    updatedAt: "2026-10-10T00:00:00.000Z",
    ...overrides,
  };
}

// A request the PM typed by hand: the picker never ran, so the amount is blank.
function request(jobNumber: string, originalContract = ""): ChangeRequest {
  const base = createRequest();
  return {
    ...base,
    job: { ...base.job, jobNumber, originalContract },
  };
}

test("job numbers match exactly, ignoring case and surrounding whitespace", () => {
  const jobs = [job()];
  assert.equal(findJobByNumber(jobs, "F-26-0401-R"), jobs[0]);
  assert.equal(findJobByNumber(jobs, "  f-26-0401-r  "), jobs[0]);
  assert.equal(
    findJobByNumber([job({ jobNumber: "f-26-0401-r" })], "F-26-0401-R")?.id,
    "job-1",
  );
  assert.equal(findJobByNumber(jobs, "F-26-9999-R"), undefined);
  // A blank search must never match a row whose own number is blank.
  assert.equal(
    findJobByNumber([job({ jobNumber: "   " }), job()], "   "),
    undefined,
  );
  assert.equal(findJobByNumber(jobs, ""), undefined);
});

test("the directory amount is returned only for a job that carries one", () => {
  assert.equal(contractAmountForJob([job()], "F-26-0401-R"), "84200.75");
  assert.equal(contractAmountForJob([job()], "f-26-0401-r"), "84200.75");
  // Unknown job, blank amount, and whitespace-only amount all mean "nothing to
  // apply" — never a placeholder.
  assert.equal(contractAmountForJob([job()], "F-26-9999-R"), "");
  assert.equal(
    contractAmountForJob([job({ contractAmount: "" })], "F-26-0401-R"),
    "",
  );
  assert.equal(
    contractAmountForJob([job({ contractAmount: "  " })], "F-26-0401-R"),
    "",
  );
  assert.equal(contractAmountForJob([], "F-26-0401-R"), "");
});

test("a typed job number fills the blank original contract from the directory", () => {
  const jobs = [job()];
  const typed = request("  f-26-0401-r  ");
  assert.equal(typed.job.originalContract, "");
  assert.equal(typed.jobDirectoryId, undefined);

  const filled = applyDirectoryContractAmount(typed, jobs);
  // A new request object, and the original is untouched (no mutation).
  assert.notEqual(filled, typed);
  assert.equal(filled.job.originalContract, "84200.75");
  assert.equal(filled.jobDirectoryId, "job-1");
  assert.equal(typed.job.originalContract, "");
  assert.equal(typed.jobDirectoryId, undefined);
  // Nothing else about the request changes, including the confirmation flag
  // (requests.ts reconciliation owns that).
  const confirmed: ChangeRequest = { ...typed, contractConfirmed: true };
  assert.equal(
    applyDirectoryContractAmount(confirmed, jobs).contractConfirmed,
    true,
  );
  assert.equal(
    applyDirectoryContractAmount(confirmed, jobs).job.customer,
    confirmed.job.customer,
  );
});

test("an amount a person entered is never overwritten", () => {
  const jobs = [job()];
  for (const entered of ["999.00", "$1,000.00", "(250.00)"]) {
    // Already linked to the directory row, so this pass has nothing left to
    // record: the helper must hand back the very same object.
    const own: ChangeRequest = {
      ...request("F-26-0401-R", entered),
      jobDirectoryId: "job-1",
    };
    const next = applyDirectoryContractAmount(own, jobs);
    assert.equal(next, own, entered);
    assert.equal(next.job.originalContract, entered, entered);
  }
  // On a first pass the row link is recorded, but the amount still wins.
  const fresh = request("F-26-0401-R", "999.00");
  const linked = applyDirectoryContractAmount(fresh, jobs);
  assert.equal(linked.job.originalContract, "999.00");
  assert.equal(linked.jobDirectoryId, "job-1");
  // Unparseable text is not an amount of the PM's own, so the directory wins.
  const junk = request("F-26-0401-R", "n/a");
  const repaired = applyDirectoryContractAmount(junk, jobs);
  assert.equal(repaired.job.originalContract, "84200.75");
});

test("a job number that matches no directory row changes nothing", () => {
  const typed = {
    ...request("F-26-9999-R"),
    jobDirectoryId: "job-kept",
  };
  assert.equal(applyDirectoryContractAmount(typed, [job()]), typed);
  assert.equal(typed.jobDirectoryId, "job-kept");
  assert.equal(applyDirectoryContractAmount(typed, []), typed);
  // The amount on the request still protects it when the number is unknown.
  const own = request("F-26-9999-R", "500.00");
  assert.equal(applyDirectoryContractAmount(own, [job()]), own);
});

test("applying the same directory row twice is a no-op", () => {
  const jobs = [job()];
  const filled = applyDirectoryContractAmount(request("F-26-0401-R"), jobs);
  const again = applyDirectoryContractAmount(filled, jobs);
  // Referential identity is how App.tsx knows there is nothing to save.
  assert.equal(again, filled);
  assert.equal(again.job.originalContract, "84200.75");
});

test("a blank directory amount never clears an amount on the request", () => {
  const jobs = [job({ contractAmount: "" })];
  const own = request("F-26-0401-R", "500.00");
  const kept = applyDirectoryContractAmount(own, jobs);
  assert.equal(kept.job.originalContract, "500.00");
  // The match is recorded even though there is no amount to apply...
  assert.equal(kept.jobDirectoryId, "job-1");
  // ...and once recorded, re-applying is a true no-op.
  assert.equal(applyDirectoryContractAmount(kept, jobs), kept);

  // A blank amount still records the matched row, without inventing a value.
  const blank = request("F-26-0401-R");
  const matched = applyDirectoryContractAmount(blank, jobs);
  assert.equal(matched.job.originalContract, "");
  assert.equal(matched.jobDirectoryId, "job-1");

  // Unparseable text is left in place rather than replaced by nothing.
  const junk = request("F-26-0401-R", "n/a");
  const keptJunk = applyDirectoryContractAmount(junk, jobs);
  assert.equal(keptJunk.job.originalContract, "n/a");

  // No directory row at all: still no clearing.
  const unknown = request("F-26-9999-R", "500.00");
  assert.equal(applyDirectoryContractAmount(unknown, jobs), unknown);
});

test("the amount follows a retyped job number only when the directory filled it", () => {
  const jobs = [
    job({ id: "job-a", jobNumber: "F-26-0401-R", contractAmount: "84200.75" }),
    job({ id: "job-b", jobNumber: "F-26-0402-R", contractAmount: "12500.00" }),
  ];
  // The PM typed the first number, so the directory owns the value; changing
  // the job number moves the amount to the newly typed job.
  const first = applyDirectoryContractAmount(request("F-26-0401-R"), jobs);
  assert.equal(first.job.originalContract, "84200.75");
  const retyped = {
    ...first,
    job: { ...first.job, jobNumber: "F-26-0402-R" },
  };
  const moved = applyDirectoryContractAmount(retyped, jobs);
  assert.equal(moved.job.originalContract, "12500.00");
  assert.equal(moved.jobDirectoryId, "job-b");

  // A hand-typed amount is not ours to replace, even after a retype: the row
  // it was previously linked to does not carry that figure, so it stays.
  const typedOwn = request("F-26-0401-R", "999.00");
  const own: ChangeRequest = {
    ...typedOwn,
    jobDirectoryId: "job-a",
    job: { ...typedOwn.job, jobNumber: "F-26-0402-R" },
  };
  const afterRetype = applyDirectoryContractAmount(own, jobs);
  assert.equal(afterRetype.job.originalContract, "999.00");
  assert.equal(afterRetype.jobDirectoryId, "job-b");
});

test("only PM-stage requests receive the directory amount", () => {
  const jobs = [job()];
  assert.equal(isPmStageRequest(request("F-26-0401-R")), true);
  for (const status of ["draft", "needs_information"] as const) {
    const pmStage: ChangeRequest = { ...request("F-26-0401-R"), status };
    const filled = applyDirectoryContractAmountForPmRequest(pmStage, jobs);
    assert.equal(filled.job.originalContract, "84200.75", status);
  }
  // Submitted work belongs to the estimator and locked orders are history: the
  // wrapper must return them untouched, even with a blank amount.
  for (const status of [
    "submitted",
    "in_review",
    "ready",
    "completed",
  ] as const) {
    const locked: ChangeRequest = { ...request("F-26-0401-R"), status };
    assert.equal(isPmStageRequest(locked), false, status);
    assert.equal(
      applyDirectoryContractAmountForPmRequest(locked, jobs),
      locked,
      status,
    );
  }
});
