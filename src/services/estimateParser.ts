import type { EstimateItem, JobDetails } from "../types";
import {
  baselineProblems,
  cents,
  subtotal,
  sumDecimals,
  validDecimal,
} from "./pricing";
export interface TextToken {
  text: string;
  x: number;
  y: number;
  width: number;
}
export interface PositionedPage {
  page: number;
  tokens: TextToken[];
}
export interface ParseResult {
  items: EstimateItem[];
  warnings: string[];
  job: Partial<JobDetails>;
}
type Column =
  | "description"
  | "quantity"
  | "unit"
  | "rate"
  | "reset"
  | "remove"
  | "replace"
  | "tax"
  | "op"
  | "rcv"
  | "depreciation"
  | "acv";
interface Header {
  columns: { key: Column; x: number; right: number }[];
  y: number;
  splitPricing: boolean;
}
const headings: [Column, RegExp][] = [
  ["quantity", /^(?:QUANTITY|QTY)$/i],
  ["unit", /^UNIT$/i],
  ["rate", /^(?:UNIT\s*PRICE|UNIT\s*COST|PRICE|RATE|COST)$/i],
  ["reset", /^RESET$/i],
  ["remove", /^REMOVE$/i],
  ["replace", /^REPLACE$/i],
  ["tax", /^(?:TAX|SALES\s*TAX)$/i],
  ["op", /^(?:O\s*&\s*P|OVERHEAD.*PROFIT)$/i],
  ["rcv", /^(?:RCV|REPLACEMENT\s*COST|TOTAL)$/i],
  ["depreciation", /^(?:DEPREC\.?|DEPRECIATION)$/i],
  ["acv", /^ACV$/i],
  ["description", /^(?:DESCRIPTION|LINE\s*ITEM|ITEM)$/i],
];
const number = (text: string) =>
  text.replace(/[$,\s%]/g, "").replace(/^\((.*)\)$/, "-$1");
function lines(tokens: TextToken[]): TextToken[][] {
  const groups: TextToken[][] = [];
  for (const token of [...tokens]
    .filter((t) => t.text.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = groups.find((g) => Math.abs(g[0].y - token.y) <= 3);
    if (line) line.push(token);
    else groups.push([token]);
  }
  return groups.map((g) => g.sort((a, b) => a.x - b.x));
}
function detectHeader(line: TextToken[]): Header | null {
  const columns: Header["columns"] = [];
  for (let i = 0; i < line.length; i++) {
    const token = line[i];
    let label = token.text.trim();
    let right = token.x + token.width;
    if (
      /^UNIT$/i.test(label) &&
      /^(?:PRICE|COST)$/i.test(line[i + 1]?.text.trim() ?? "") &&
      line[i + 1].x - token.x < 50
    ) {
      label = "UNIT PRICE";
      right = line[i + 1].x + line[i + 1].width;
      i++;
    }
    const found = headings.find(([, pattern]) => pattern.test(label));
    if (found && !columns.some((c) => c.key === found[0]))
      columns.push({ key: found[0], x: token.x, right });
  }
  const splitPricing =
    !columns.some((c) => c.key === "rate") &&
    columns.some(
      (c) => c.key === "remove" || c.key === "replace" || c.key === "reset",
    );
  return columns.some((c) => c.key === "quantity") &&
    columns.some((c) => c.key === "rcv") &&
    (columns.some((c) => c.key === "rate") || splitPricing)
    ? { columns: columns.sort((a, b) => a.x - b.x), y: line[0].y, splitPricing }
    : null;
}
function numericColumns(
  line: TextToken[],
  header: Header,
): Partial<Record<Column, string>> {
  const columns = header.columns.filter((c) => c.key !== "description");
  const result: Partial<Record<Column, string>> = {};
  for (const token of line) {
    const center = token.x + token.width / 2;
    if (header.splitPricing) {
      // These report columns are right-aligned. Assign by the printed right
      // edge, so a short removal price does not drift into REPLACE.
      const right = token.x + token.width;
      if (
        right < columns[0].x - 18 ||
        !/^\s*(?:[-+$\d(][\d,.\s$()+%-]*\s*[A-Za-z²³]*|[A-Za-z²³]+)\s*$/.test(
          token.text,
        )
      )
        continue;
      const column = columns.reduce((nearest, c) =>
        Math.abs(c.right - right) < Math.abs(nearest.right - right)
          ? c
          : nearest,
      );
      result[column.key] = `${result[column.key] ?? ""} ${token.text}`.trim();
      continue;
    }
    if (center < columns[0].x - 18) continue;
    let index = columns.findIndex(
      (c, i) => center < (c.x + (columns[i + 1]?.x ?? Infinity)) / 2,
    );
    if (index < 0) index = columns.length - 1;
    const key = columns[index].key;
    result[key] = `${result[key] ?? ""} ${token.text}`.trim();
  }
  return result;
}
const componentKeys = ["reset", "remove", "replace"] as const;
function readPricing(columns: Partial<Record<Column, string>>, header: Header) {
  const priceComponents = header.splitPricing
    ? Object.fromEntries(
        componentKeys
          .filter((key) => header.columns.some((c) => c.key === key))
          .map((key) => [key, number(columns[key] ?? "")]),
      )
    : undefined;
  const values = Object.values(priceComponents ?? {}).filter(Boolean);
  return {
    rate: header.splitPricing
      ? values.length && values.every((value) => validDecimal(value, true))
        ? sumDecimals(values)
        : ""
      : number(columns.rate ?? ""),
    priceComponents,
    tax: number(columns.tax ?? ""),
    op: number(columns.op ?? ""),
    rcv: number(columns.rcv ?? ""),
  };
}

function roomHeading(
  line: TextToken[],
  header: Header,
  tableActive: boolean,
): string | null {
  const text = line
    .map((t) => t.text)
    .join(" ")
    .trim();
  const continued = text.match(/^CONTINUED\s*[-–:]\s*(.+)$/i);
  if (continued) return continued[1].trim();
  if (tableActive || line.some((t) => /^Subroom:/i.test(t.text))) return null;
  const qx = header.columns.find((c) => c.key === "quantity")!.x;
  const height = line.find((t) => /^Height:/i.test(t.text));
  // Room titles beside a sketch occupy the heading column. Ignore the sketch's
  // duplicate labels/dimensions and subordinate closet measurements.
  const heading = line.find(
    (t) =>
      t.x >= qx - 75 &&
      t.x < qx - 25 &&
      /[A-Za-z]/.test(t.text) &&
      !/^\d|^Subroom:|^F\d+$/i.test(t.text),
  );
  if (
    heading &&
    (height ||
      line.length === 1 ||
      line.every((t) => t === heading || /^F\d+$|^[\d'"\s.]+$/.test(t.text)))
  )
    return heading.text.trim();
  if (
    line.length === 1 &&
    line[0].x >= 0 &&
    line[0].x < 80 &&
    text.length < 100 &&
    /^[A-Za-z]/.test(text) &&
    !/^(?:F\d+|\w+_\w+_\w+|Note:|Includes:|Excludes:|Window|Door|Missing Wall)\b/i.test(
      text,
    )
  )
    return text;
  return null;
}
export function parseEstimate(pages: PositionedPage[]): ParseResult {
  const items: EstimateItem[] = [],
    warnings: string[] = [];
  const job: Partial<JobDetails> = {};
  let room = "",
    previousHeader: Header | null = null,
    pending: EstimateItem | null = null;
  for (const page of pages) {
    const pageLines = lines(page.tokens);
    let header: Header | null =
      pageLines.map(detectHeader).find((h) => h !== null) ?? previousHeader;
    let tableActive = false;
    let addressContinuationX: number | null = null;
    let addressContinuationY = 0;
    for (const line of pageLines) {
      const text = line
        .map((t) => t.text)
        .join(" ")
        .trim();
      const detected = detectHeader(line);
      if (detected) {
        header = detected;
        previousHeader = detected;
        tableActive = true;
        continue;
      }
      let metadata = false;
      for (const [key, pattern] of [
        ["customer", /^(?:Insured|Customer|Property Owner):\s*(.+)/i],
        ["address", /^(?:Property|Loss)(?: Address)?:\s*(.+)/i],
        ["claim", /^Claim(?: Number| #)?:\s*(.+)/i],
        ["carrier", /^(?:Insurance Carrier|Insurance Company):\s*(.+)/i],
      ] as [keyof JobDetails, RegExp][]) {
        const match = text.match(pattern);
        if (match) {
          // Contact, policy, and loss labels can share a baseline with a field.
          const value = match[1]
            .split(
              /\s+(?:Home|Business|Cell|Phone|E-mail|Email|Policy Number|Type of Loss|Claim Number):/i,
            )[0]
            .trim();
          Object.assign(job, { [key]: value });
          if (key === "address") {
            addressContinuationX =
              line.find(
                (t) => !/^(?:Property|Loss)(?: Address)?:\s*$/i.test(t.text),
              )?.x ?? line[0].x;
            addressContinuationY = line[0].y;
          }
          metadata = true;
        }
      }
      if (metadata) continue;
      if (addressContinuationX !== null) {
        const continuation = line.find(
          (t) =>
            Math.abs(t.x - addressContinuationX!) < 15 &&
            /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(t.text),
        );
        if (continuation) {
          job.address = `${job.address}, ${continuation.text.trim()}`;
          addressContinuationX = null;
        } else if (line[0].y < addressContinuationY - 30)
          addressContinuationX = null;
      }
      if (
        /^(?:Totals?\b|Subtotal\b|Summary\b|Recap\b|Grand Total\b|Line Item Totals\b|Replacement Cost Value\b|Actual Cash Value\b)/i.test(
          text,
        )
      ) {
        const match = text.match(
          /^Replacement Cost Value\s*[:$]?\s*([\d,.]+)\s*$/i,
        );
        if (match) job.originalContract = number(match[1]);
        tableActive = false;
        pending = null;
        continue;
      }
      if (!header) continue;
      const isFurniture =
        line.some((t) => /^Page\s*:\s*\d+/i.test(t.text)) ||
        /^(?:Page\b|Estimate\b|Date(?:\s+Prepared)?:|Price\s*List:|Final\s*Draft\b|Hays\b|Prepared\s+For:|Prepared\s+By:|Estimator:|Type\s+of\s+Loss:|Date\s+of\s+Loss:|Policy(?:\s+Number)?:|Deductible:|Coverage:|Reference(?:\s+Number)?:|Loss\s+Address:|Received:|Reported:|Phone:|Email:|Attention:|TAX ID\b)/i.test(
          text,
        ) ||
        /^CONTINUED(?:\s+ON\s+(?:NEXT\s+)?PAGE(?:\s+\d+)?)?$/i.test(text) ||
        /^\*{2,}/.test(text) ||
        line[0].y < 35 ||
        line[0].y > 750;
      if (isFurniture) continue;
      const heading = roomHeading(line, header, tableActive);
      if (heading) {
        if (heading !== room) pending = null;
        room = heading;
        continue;
      }
      if (!tableActive) continue;
      const qx = header.columns.find((c) => c.key === "quantity")!.x;
      const first = line[0];
      const rowStart = first.x < qx - 30 && text.match(/^(\d{1,6})[.)]\s*(.*)/);
      if (rowStart) {
        const columns = numericColumns(line, header);
        const description = line
          .filter((t) => t.x + t.width / 2 < qx - 18)
          .map((t) => t.text)
          .join(" ")
          .replace(/^\d+[.)]\s*/, "")
          .trim();
        const qty = (columns.quantity ?? "").match(
          /^([\d,.]+)\s*([A-Za-z²³]+)?$/,
        );
        const item: EstimateItem = {
          id: `p${page.page}-row${items.length}-${rowStart[1]}`,
          room,
          lineNumber: rowStart[1],
          description,
          quantity: qty ? number(qty[1]) : "",
          unit: columns.unit?.trim() ?? qty?.[2] ?? "",
          ...readPricing(columns, header),
          page: page.page,
          rawText: text,
          warnings: [],
          reviewed: false,
        };
        if (!header.columns.some((c) => c.key === "tax"))
          item.warnings.push(
            "Tax is not shown; enter and confirm the applicable amount.",
          );
        if (!header.columns.some((c) => c.key === "op"))
          item.warnings.push(
            "O&P is not shown; enter and confirm the applicable amount.",
          );
        items.push(item);
        pending = item;
        continue;
      }
      const isLeftOnly = line.every((t) => t.x + t.width < qx - 15);
      if (pending && isLeftOnly) {
        pending.description += ` ${text}`;
        pending.rawText += `\n${text}`;
      } else if (pending && tableActive) {
        // Some reports put numeric values on the next baseline after the description.
        const values = numericColumns(line, header);
        if (!pending.rcv && values.rcv && /\d/.test(values.rcv)) {
          const qty = (values.quantity ?? "").match(
            /^([\d,.]+)\s*([A-Za-z²³]+)?$/,
          );
          if (qty) {
            pending.quantity = number(qty[1]);
            pending.unit = values.unit ?? qty[2] ?? pending.unit;
          }
          const pricing = readPricing(values, header);
          for (const key of ["rate", "tax", "op", "rcv"] as const)
            if (pricing[key]) pending[key] = pricing[key];
          if (pricing.priceComponents)
            pending.priceComponents = pricing.priceComponents;
          pending.rawText += `\n${text}`;
        } else if (first.x < qx - 30) {
          // Full-width explanatory notes belong to the source item, not to its
          // unit-price columns or the next room.
          pending.rawText += `\n${text}`;
        }
      }
    }
  }
  for (const item of items) {
    item.warnings.push(...baselineProblems(item));
    if (
      !baselineProblems(item).length &&
      Math.abs(
        cents(item.rcv) -
          subtotal(item.quantity, item.rate) -
          cents(item.tax) -
          cents(item.op),
      ) > 2
    )
      item.warnings.push(
        "Printed RCV differs from quantity × rate plus tax/O&P. Verify the source; RCV remains the baseline.",
      );
  }
  if (!items.length)
    warnings.push(
      "No supported Xactimate line-item table was found. Enter items manually or upload a Final Draft report with selectable text.",
    );
  if (items.some((i) => i.warnings.length))
    warnings.push(
      "Some original values need review. Correct and confirm affected items before generating documents.",
    );
  return { items, warnings, job };
}
