import type { EstimateItem, JobDetails } from "../types";
import { baselineProblems, cents, subtotal } from "./pricing";
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
  | "tax"
  | "op"
  | "rcv"
  | "depreciation"
  | "acv";
interface Header {
  columns: { key: Column; x: number }[];
  y: number;
}
const headings: [Column, RegExp][] = [
  ["quantity", /^(?:QUANTITY|QTY)$/i],
  ["unit", /^UNIT$/i],
  ["rate", /^(?:UNIT\s*PRICE|PRICE|RATE)$/i],
  ["tax", /^(?:TAX|SALES\s*TAX)$/i],
  ["op", /^(?:O\s*&\s*P|OVERHEAD.*PROFIT)$/i],
  ["rcv", /^(?:RCV|REPLACEMENT\s*COST|TOTAL)$/i],
  ["depreciation", /^(?:DEPREC\.?|DEPRECIATION)$/i],
  ["acv", /^ACV$/i],
  ["description", /^(?:DESCRIPTION|ITEM)$/i],
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
    if (
      /^UNIT$/i.test(label) &&
      /^PRICE$/i.test(line[i + 1]?.text.trim() ?? "") &&
      line[i + 1].x - token.x < 50
    ) {
      label = "UNIT PRICE";
      i++;
    }
    const found = headings.find(([, pattern]) => pattern.test(label));
    if (found && !columns.some((c) => c.key === found[0]))
      columns.push({ key: found[0], x: token.x });
  }
  return columns.some((c) => c.key === "quantity") &&
    columns.some((c) => c.key === "rcv") &&
    columns.some((c) => c.key === "rate")
    ? { columns: columns.sort((a, b) => a.x - b.x), y: line[0].y }
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
          Object.assign(job, { [key]: match[1].trim() });
          metadata = true;
        }
      }
      if (metadata) continue;
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
      if (!header || (!tableActive && line[0].y > header.y + 45)) continue;
      const qx = header.columns.find((c) => c.key === "quantity")!.x;
      const first = line[0];
      const rowStart = first.x < qx - 30 && text.match(/^(\d{1,6})[.)]\s*(.*)/);
      if (rowStart) {
        const columns = numericColumns(line, header);
        // A numbered narrative outside the table must not become a priced item.
        if (
          !tableActive &&
          !Object.values(columns).some((value) => /\d/.test(value))
        )
          continue;
        tableActive = true;
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
          rate: number(columns.rate ?? ""),
          tax: number(columns.tax ?? ""),
          op: number(columns.op ?? ""),
          rcv: number(columns.rcv ?? ""),
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
      const isFurniture =
        /^(?:Page\b|Estimate\b|Date:|Price List:|Final Draft\b|Hays\b)/i.test(
          text,
        ) ||
        /^CONTINUED(?:\s+ON\s+PAGE\s+\d+)?$/i.test(text) ||
        first.y < 35 ||
        first.y > 750;
      if (isFurniture) continue;
      if (
        isLeftOnly &&
        text.length < 100 &&
        (!pending || !tableActive || first.x < 55) &&
        !/^(?:Note:|Includes:|Excludes:)/i.test(text)
      ) {
        room = text;
        pending = null;
      } else if (pending && tableActive && isLeftOnly) {
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
          for (const key of ["rate", "tax", "op", "rcv"] as const)
            if (values[key]) pending[key] = number(values[key]!);
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
