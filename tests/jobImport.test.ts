import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAddress,
  cleanZip,
  isActiveStatus,
  parseCsv,
  parseJobReport,
  parseMoney,
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

test("money cells normalize to the app's canonical decimal string", () => {
  // The Dash export prints amounts with "$" and thousands separators, credits
  // in accounting parentheses, and occasionally blank or junk cells.
  assert.equal(parseMoney("$167,045.81"), "167045.81");
  assert.equal(parseMoney("167045.81"), "167045.81");
  assert.equal(parseMoney("$1,234"), "1234");
  assert.equal(parseMoney("(1,234.00)"), "-1234.00");
  assert.equal(parseMoney(""), "");
  assert.equal(parseMoney("n/a"), "");
  assert.equal(parseMoney("0.00"), "0");
});

test("money normalization never emits a broken number", () => {
  // Values the app would render as a broken contract amount must come back
  // empty so the caller warns instead.
  assert.equal(parseMoney("$"), "");
  assert.equal(parseMoney("--"), "");
  assert.equal(parseMoney("1.2.3"), "");
  assert.equal(parseMoney("NaN"), "");
  assert.equal(parseMoney("Infinity"), "");
  assert.equal(parseMoney("1e5"), "");
  assert.equal(parseMoney("$ 1,234.56 "), "1234.56");
  assert.equal(parseMoney("-1234.00"), "-1234.00");
  assert.equal(parseMoney("1234.00-"), "-1234.00");
  assert.equal(parseMoney("001234.50"), "1234.50");
  assert.equal(parseMoney("$0"), "0");
  assert.equal(parseMoney("(0.00)"), "0");
  for (const input of [
    "$167,045.81",
    "167045.81",
    "(1,234.00)",
    "",
    "n/a",
    "0.00",
    "$",
    "1e5",
    "Infinity",
    "NaN",
  ]) {
    // No exponent, no "NaN"/"Infinity", no negative zero, no bare ".".
    const normalized = parseMoney(input);
    assert.match(normalized, /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?)?$/);
    assert.notEqual(normalized, "-0");
    assert.equal(/e/i.test(normalized), false);
  }
});

const REPORT = [
  "Status,Time In Status,Job Number,Customer,Customer Main Phone,Customer Email,Job Address,Loss City,Loss State,Loss ZIP,Notes,Estimator,ForePerson,Estimate Amount",
  'Work in Progress,65 days,F-25-0374-R,Biggs Property Management-530 Home Ave.,260-223-0685,vrobbins@rentbiggs.com,530 Home Ave.,Fort Wayne,IN,46807,"Email received, see <br/> note",Russell Shive,Lance Stanley,"$167,045.81"',
  'Pending Sales,213 days,F-26-0115-WAR,Kuhns Krystel,330-559-9054,krystelkuhns@gmail.com,7037 N 200 E,Huntington,IN,46750,"line one\nline two",Russell Shive,,98000',
  'Pre-Production,68 days,F-26-0240-R,Helm Steven & Pamela,260-223-0433,stevecapt33@gmail.com,2639 E US 224,Decatur,IN,46733,,Russell Shive,Determined To Be,"125,500.50"',
  ",,,,,,,,,,,,,",
  "Work in Progress,4 days,F-26-0350-R,,260-446-6590,,1203 Crescent Ave,Fort Wayne,IN,458912151,,Russell Shive,Randy Ranger,",
  'Pending Sales,9 days,F-26-0240-R,Helm Steven & Pamela,260-223-0433,,2639 E US 224,Decatur,IN,46733,,Russell Shive,Randy Ranger,"1,250.00"',
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
  // "$167,045.81" arrives formatted and becomes the canonical decimal string.
  assert.equal(biggs.contractAmount, "167045.81");
  // The huge Notes column is never carried into a job.
  assert.equal("notes" in biggs, false);
  // Nor is any other unmapped report column: the job carries exactly JobEntry.
  assert.deepEqual(Object.keys(biggs).sort(), [
    "active",
    "address",
    "contractAmount",
    "customer",
    "customerEmail",
    "customerPhone",
    "estimator",
    "id",
    "jobNumber",
    "projectManager",
    "status",
    "updatedAt",
  ]);

  const pending = result.jobs.find((job) => job.jobNumber === "F-26-0115-WAR");
  assert.ok(pending);
  assert.equal(pending.active, false);
  assert.equal(pending.projectManager, "");
  assert.equal(pending.contractAmount, "98000");

  const helm = result.jobs.find(
    (job) => job.jobNumber === "F-26-0240-R" && job.active,
  );
  assert.ok(helm);
  assert.equal(helm.contractAmount, "125500.50");

  const duplicate = result.jobs.filter(
    (job) => job.jobNumber === "F-26-0240-R",
  );
  assert.equal(duplicate.length, 2);
  assert.equal(duplicate[1].contractAmount, "1250.00");

  const mangled = result.jobs.find((job) => job.jobNumber === "F-26-0350-R");
  assert.ok(mangled);
  assert.equal(mangled.address, "1203 Crescent Ave, Fort Wayne, IN 45891");
  assert.equal(mangled.customer, "");
  // The column exists but this row's cell is blank: the job still imports and
  // the admin gets one row-level warning instead.
  assert.equal(mangled.contractAmount, "");
  assert.ok(
    result.warnings.some((warning) =>
      /^Row 5 \(F-26-0350-R\): .*estimate amount/i.test(warning),
    ),
  );

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
  assert.equal(result.jobs[0].contractAmount, "");
  // A file with no estimate-amount column gets one coverage note...
  const coverage = result.warnings.filter((warning) =>
    /estimate amount/i.test(warning),
  );
  assert.equal(coverage.length, 1);
  // ...that says the column is missing, and the skipped row never earns a
  // per-row amount warning.
  assert.match(coverage[0], /no .*estimate amount/i);
  // ...and the skipped row never earns a per-row contract warning.
  assert.equal(
    result.warnings.some((warning) => /^Row 2/.test(warning)),
    false,
  );

  const wrong = parseJobReport("Name,Address\nAcme,123 Main St.");
  assert.equal(wrong.total, 0);
  assert.match(wrong.warnings[0], /Job Number/);
});

test("a report with no estimate-amount column warns once and imports anyway", () => {
  const rows = [
    "Status,Job Number,Customer,Job Address,Loss City,Loss State,Loss ZIP,ForePerson",
    "Work in Progress,F-26-0366-R,York Tori,1825 Sprunger St.,Fort Wayne,IN,46808,Lance Stanley",
    "Work in Progress,F-26-0366-P,York Tori,1825 Sprunger St.,Fort Wayne,IN,46808,Tarreck ElBarassi",
  ].join("\n");
  const result = parseJobReport(rows);
  assert.equal(result.total, 2);
  assert.equal(result.skipped, 0);
  // Both jobs still import so the admin keeps the directory.
  assert.deepEqual(
    result.jobs.map((job) => job.contractAmount),
    ["", ""],
  );
  // One note for the whole file — never one warning per row — and it has to
  // tell the admin the exported column is missing.
  const amountWarnings = result.warnings.filter((warning) =>
    /estimate amount/i.test(warning),
  );
  assert.equal(amountWarnings.length, 1);
  assert.match(amountWarnings[0], /no .*estimate amount/i);
  assert.equal(
    result.warnings.some((warning) => /^Row \d/.test(warning)),
    false,
  );
});

test("blank estimate-amount cells warn per row and never block the import", () => {
  const rows = [
    "Job Number,Customer,Estimate Amount",
    "F-26-0366-R,York Tori,",
    ",No job number,",
    'F-26-0366-P,York Tori,"$1,234.00"',
  ].join("\n");
  const result = parseJobReport(rows);
  assert.equal(result.total, 2);
  assert.equal(result.skipped, 1);
  // A blank cell leaves the amount empty; a readable one is normalized.
  assert.equal(result.jobs[0].contractAmount, "");
  assert.equal(result.jobs[1].contractAmount, "1234.00");
  // Exactly one per-row warning, in the existing "Row N (jobNumber)" style,
  // and none for the skipped row or the row with a readable amount.
  const amountWarnings = result.warnings.filter((warning) =>
    /estimate amount/i.test(warning),
  );
  assert.equal(amountWarnings.length, 1);
  assert.match(amountWarnings[0], /^Row 2 \(F-26-0366-R\): .*estimate amount/i);
  assert.equal(
    result.warnings.some((warning) => /^Row 3/.test(warning)),
    false,
  );
});

test("every accepted amount column name maps, Estimate Amount first", () => {
  // The current JobSummaryReport prints "Estimate Amount"; real exports vary,
  // so the older names must keep working too.
  for (const header of [
    "Estimate Amount",
    "Contract Amount",
    "Original Contract Amount",
  ]) {
    const rows = [
      `Job Number,Customer,${header}`,
      'F-26-0366-R,York Tori,"$167,045.81"',
    ].join("\n");
    const result = parseJobReport(rows);
    assert.equal(result.jobs[0].contractAmount, "167045.81", header);
    assert.deepEqual(
      result.warnings.filter((warning) => /amount/i.test(warning)),
      [],
      header,
    );
  }
});
