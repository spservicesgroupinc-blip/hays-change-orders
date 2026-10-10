import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAddress,
  cleanZip,
  isActiveStatus,
  parseCsv,
  parseJobReport,
} from "../src/services/jobImport";

test("RFC-4180 reader handles quotes, commas, newlines and doubled quotes", () => {
  const rows = parseCsv(
    'a,b,c\n1,"two, with comma","line one\nline two"\n3,"say ""hi""",end\n',
  );
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1", "two, with comma", "line one\nline two"],
    ["3", 'say "hi"', "end"],
  ]);
});

test("blank lines are dropped", () => {
  assert.deepEqual(parseCsv("a,b\n\n1,2\n\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("zip cleanup keeps the leading five digits", () => {
  assert.equal(cleanZip("46807"), "46807");
  assert.equal(cleanZip("458912151"), "45891");
  assert.equal(cleanZip("46814-9184"), "46814");
  assert.equal(cleanZip(""), "");
});

test("address is assembled from the report's address columns", () => {
  assert.equal(
    buildAddress("530 Home Ave.", "Fort Wayne", "IN", "46807"),
    "530 Home Ave., Fort Wayne, IN 46807",
  );
  assert.equal(buildAddress("", "Decatur", "IN", "46733"), "Decatur, IN 46733");
  assert.equal(buildAddress("1 Main St.", "", "", ""), "1 Main St.");
});

test("only production statuses are active", () => {
  assert.equal(isActiveStatus("Work in Progress"), true);
  assert.equal(isActiveStatus("Pre-Production"), true);
  assert.equal(isActiveStatus("Pending Sales"), false);
  assert.equal(isActiveStatus("Accounts Receivable"), false);
});

const REPORT = [
  "Status,Time In Status,Job Number,Customer,Customer Main Phone,Customer Email,Job Address,Loss City,Loss State,Loss ZIP,Notes,Estimator,ForePerson",
  'Work in Progress,65 days,F-25-0374-R,Biggs Property Management-530 Home Ave.,260-223-0685,vrobbins@rentbiggs.com,530 Home Ave.,Fort Wayne,IN,46807,"Email received, see <br/> note",Russell Shive,Lance Stanley',
  'Pending Sales,213 days,F-26-0115-WAR,Kuhns Krystel,330-559-9054,krystelkuhns@gmail.com,7037 N 200 E,Huntington,IN,46750,"line one\nline two",Russell Shive,',
  "Pre-Production,68 days,F-26-0240-R,Helm Steven & Pamela,260-223-0433,stevecapt33@gmail.com,2639 E US 224,Decatur,IN,46733,,Russell Shive,Determined To Be",
  ",,,,,,,,,,,,,",
  "Work in Progress,4 days,F-26-0350-R,,260-446-6590,,1203 Crescent Ave,Fort Wayne,IN,458912151,,Russell Shive,Randy Ranger",
  "Pending Sales,9 days,F-26-0240-R,Helm Steven & Pamela,260-223-0433,,2639 E US 224,Decatur,IN,46733,,Russell Shive,Randy Ranger",
].join("\n");

test("maps the JobSummaryReport columns onto jobs and warns on gaps", () => {
  const result = parseJobReport(REPORT, "2026-10-10T00:00:00.000Z");
  assert.equal(result.total, 5);
  assert.equal(result.skipped, 0);

  const biggs = result.jobs.find((job) => job.jobNumber === "F-25-0374-R");
  assert.ok(biggs);
  assert.equal(biggs.customer, "Biggs Property Management-530 Home Ave.");
  assert.equal(biggs.address, "530 Home Ave., Fort Wayne, IN 46807");
  assert.equal(biggs.projectManager, "Lance Stanley");
  assert.equal(biggs.estimator, "Russell Shive");
  assert.equal(biggs.active, true);
  assert.equal(biggs.updatedAt, "2026-10-10T00:00:00.000Z");
  // The huge Notes column is never carried into a job.
  assert.equal("notes" in biggs, false);

  const pending = result.jobs.find((job) => job.jobNumber === "F-26-0115-WAR");
  assert.ok(pending);
  assert.equal(pending.active, false);
  assert.equal(pending.projectManager, "");

  const mangled = result.jobs.find((job) => job.jobNumber === "F-26-0350-R");
  assert.ok(mangled);
  assert.equal(mangled.address, "1203 Crescent Ave, Fort Wayne, IN 45891");
  assert.equal(mangled.customer, "");

  assert.ok(
    result.warnings.some((warning) =>
      /F-26-0115-WAR.*project manager/.test(warning),
    ),
  );
  assert.ok(
    result.warnings.some((warning) =>
      /F-26-0240-R.*project manager/.test(warning),
    ),
  );
  assert.ok(
    result.warnings.some((warning) => /F-26-0350-R.*no customer/.test(warning)),
  );
  assert.ok(
    result.warnings.some((warning) => /F-26-0240-R.*duplicate/.test(warning)),
  );
});

test("skips rows without a job number and rejects unrelated files", () => {
  const rows = ["Job Number,Customer", ",No job number", "F-1,Named job"].join(
    "\n",
  );
  const result = parseJobReport(rows);
  assert.equal(result.total, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.jobs[0].jobNumber, "F-1");

  const wrong = parseJobReport("Name,Address\nAcme,123 Main St.");
  assert.equal(wrong.total, 0);
  assert.match(wrong.warnings[0], /Job Number/);
});
