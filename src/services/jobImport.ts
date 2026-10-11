import { newId, type JobEntry } from "../types";

// Statuses that mean "a job a project manager might raise a change order on".
// Everything else (sales, accounts receivable, closed) stays importable but is
// hidden from the picker unless the PM searches for it.
const ACTIVE_STATUSES = ["work in progress", "pre-production"];

export interface JobImportResult {
  jobs: JobEntry[];
  warnings: string[];
  total: number;
  skipped: number;
}

// Coarse mapping from the Dash JobSummaryReport header to JobEntry fields.
// Only these columns are read; the report's other ~34 columns (including the
// huge HTML "Notes" dump) are ignored.
const FIELD_HEADERS: Record<string, string[]> = {
  jobNumber: ["job number"],
  customer: ["customer"],
  street: ["job address"],
  city: ["loss city"],
  state: ["loss state"],
  zip: ["loss zip"],
  projectManager: ["foreperson"],
  estimator: ["estimator"],
  status: ["status"],
  customerPhone: ["customer main phone"],
  customerEmail: ["customer email"],
  contractAmount: [
    // The Dash export names this column "Estimate Amount"; it is the customer's
    // original contract amount. The rest are fallbacks for other export shapes.
    "estimate amount",
    "total estimate amount",
    "contract amount",
    "original contract amount",
    "original contract",
    "contract price",
    "contract total",
    "total contract amount",
    // Abbreviated export variant; the exact "estimate amount" header wins.
    "est. amount",
  ],
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// RFC-4180 style reader: quoted fields may contain commas, newlines, and
// doubled quotes. Blank lines are dropped.
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  const text = input.replace(/^\uFEFF/, "");
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim() !== ""));
}

// The report's ZIP column is sometimes ZIP+4 or otherwise mangled
// (e.g. "458912151"); keep the leading five digits.
export function cleanZip(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  return digits ? digits.slice(0, 5) : "";
}

export function buildAddress(
  street: string,
  city: string,
  state: string,
  zip: string,
): string {
  const locality = [[city, state].filter(Boolean).join(", "), zip]
    .filter(Boolean)
    .join(" ");
  return [street, locality].filter(Boolean).join(", ");
}

export function isActiveStatus(status: string): boolean {
  return ACTIVE_STATUSES.includes(status.trim().toLowerCase());
}

// Money cells in the report arrive as text: "$167,045.81", "(1,234.00)" for a
// credit, "1234.00-", blank, or the occasional junk value. Normalize them to the
// canonical decimal string the pricing math consumes (plain digits, at most one
// ".", no "$", commas, spaces or grouping) so callers can feed the result
// straight into pricing.ts cents()/validDecimal(). Unparseable cells return ""
// and never "NaN"/"Infinity"/an exponent, so the caller can warn instead of
// rendering a broken amount.
export function parseMoney(value: string): string {
  let text = String(value ?? "").trim();
  if (!text) return "";
  let negative = false;
  // Accounting parentheses mark a credit: (1,234.00) -> -1234.00.
  const parenthesized = /^\((.*)\)$/.exec(text);
  if (parenthesized) {
    negative = true;
    text = parenthesized[1];
  }
  text = text.replace(/[$,\s]/g, "");
  // The sign may be printed on either side of the digits ("-1234", "1234-").
  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return "";
  // Strip leading zeros from the whole part; zero itself is "0" ("0.00" -> "0").
  const whole = match[1].replace(/^0+/, "") || "0";
  const fraction = match[2] ?? "";
  if (whole === "0" && /^0*$/.test(fraction)) return "0";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function parseJobReport(
  text: string,
  now = new Date().toISOString(),
): JobImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2)
    return {
      jobs: [],
      warnings: ["The file has no data rows."],
      total: 0,
      skipped: 0,
    };
  const header = rows[0].map(normalizeHeader);
  const at: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(FIELD_HEADERS)) {
    at[key] = aliases.reduce(
      (found, alias) => (found >= 0 ? found : header.indexOf(alias)),
      -1,
    );
  }
  if (at.jobNumber < 0)
    return {
      jobs: [],
      warnings: [
        'This file is missing the "Job Number" column. Upload the JobSummaryReport export.',
      ],
      total: 0,
      skipped: 0,
    };
  const cell = (row: string[], key: string) =>
    at[key] >= 0 ? String(row[at[key]] ?? "").trim() : "";
  const jobs: JobEntry[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const jobNumber = cell(row, "jobNumber");
    if (!jobNumber) {
      skipped += 1;
      continue;
    }
    const projectManager = cell(row, "projectManager");
    const customer = cell(row, "customer");
    const status = cell(row, "status");
    const address = buildAddress(
      cell(row, "street"),
      cell(row, "city"),
      cell(row, "state"),
      cleanZip(cell(row, "zip")),
    );
    if (!customer) warnings.push(`Row ${i + 1} (${jobNumber}): no customer.`);
    if (!projectManager || /determined to be/i.test(projectManager))
      warnings.push(
        `Row ${i + 1} (${jobNumber}): the responsible project manager is not set.`,
      );
    if (!address)
      warnings.push(`Row ${i + 1} (${jobNumber}): no property address.`);
    const contractAmount = parseMoney(cell(row, "contractAmount"));
    if (at.contractAmount >= 0 && !contractAmount)
      warnings.push(
        `Row ${i + 1} (${jobNumber}): no estimate amount (original contract).`,
      );
    if (seen.has(jobNumber.toLowerCase()))
      warnings.push(`Row ${i + 1} (${jobNumber}): duplicate job number.`);
    seen.add(jobNumber.toLowerCase());
    jobs.push({
      id: newId(),
      jobNumber,
      customer,
      address,
      projectManager,
      estimator: cell(row, "estimator"),
      status,
      customerPhone: cell(row, "customerPhone"),
      customerEmail: cell(row, "customerEmail"),
      contractAmount,
      active: isActiveStatus(status),
      updatedAt: now,
    });
  }
  // A report without an estimate-amount column gets one note instead of one
  // warning per row; imports still go through so the admin keeps the directory.
  if (at.contractAmount < 0)
    warnings.push(
      'Estimate amount: this export has no "Estimate Amount" column, so the original contract amount is not filled in.',
    );
  return { jobs, warnings, total: jobs.length, skipped };
}
