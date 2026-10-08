import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import type { ChangeOrderDraft } from "../types";
import {
  calculateChange,
  cents,
  money,
  signedMoney,
  totals,
  scopeText,
  validationErrors,
} from "./pricing";
export interface GeneratedDocuments {
  combined: Blob;
  form: Blob;
  attachment: Blob;
}
const INK = rgb(0.1, 0.12, 0.16),
  MUTED = rgb(0.4, 0.44, 0.49),
  RED = rgb(0.86, 0.15, 0.15),
  LINE = rgb(0.83, 0.85, 0.88),
  LIGHT = rgb(0.96, 0.97, 0.98),
  YELLOW = rgb(1, 0.98, 0.78);
export function clean(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");
}
function wrap(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of clean(text).split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const raw of paragraph.trim().split(/\s+/)) {
      let word = raw;
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) {
        lines.push(line);
        line = "";
      }
      while (font.widthOfTextAtSize(word, size) > width) {
        let cut = word.length - 1;
        while (
          cut > 1 &&
          font.widthOfTextAtSize(word.slice(0, cut), size) > width
        )
          cut--;
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return lines;
}
function text(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  font: PDFFont,
  size = 9,
  color = INK,
) {
  page.drawText(clean(value), { x, y, font, size, color });
}
function right(
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  font: PDFFont,
  size = 9,
  color = INK,
) {
  const safe = clean(value);
  text(
    page,
    safe,
    x - font.widthOfTextAtSize(safe, size),
    y,
    font,
    size,
    color,
  );
}
function header(
  page: PDFPage,
  draft: ChangeOrderDraft,
  font: PDFFont,
  bold: PDFFont,
) {
  const x = 44,
    y = 728,
    s = 0.6;
  page.drawRectangle({ x, y, width: 14 * s, height: 42 * s, color: RED });
  page.drawRectangle({
    x: x + 36 * s,
    y,
    width: 14 * s,
    height: 42 * s,
    color: INK,
  });
  page.drawRectangle({
    x: x + 14 * s,
    y: y + 14 * s,
    width: 51 * s,
    height: 14 * s,
    color: INK,
  });
  text(page, "Hays+Sons", 90, 738, bold, 22);
  text(page, "COMPLETE RESTORATION", 91, 724, font, 7, MUTED);
  const address = wrap(
    `${draft.job.branchAddress} | ${draft.job.branchPhone}`,
    font,
    8,
    290,
  );
  address
    .slice(0, 2)
    .forEach((line, i) => right(page, line, 568, 748 - i * 12, font, 8, MUTED));
  page.drawLine({
    start: { x: 44, y: 711 },
    end: { x: 568, y: 711 },
    color: RED,
    thickness: 2,
  });
}
function blob(bytes: Uint8Array) {
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}
export async function generateDocuments(
  draft: ChangeOrderDraft,
): Promise<GeneratedDocuments> {
  const errors = validationErrors(draft);
  if (errors.length) throw new Error(errors.join(" "));
  const summary = totals(draft);
  const scope = scopeText(draft);
  const form = await PDFDocument.create();
  const font = await form.embedFont(StandardFonts.Helvetica),
    bold = await form.embedFont(StandardFonts.HelveticaBold);
  const page = form.addPage([612, 792]);
  header(page, draft, font, bold);
  text(page, "Change Order / Addendum", 44, 683, bold, 18);
  right(page, draft.job.orderNumber, 568, 685, bold, 11, RED);
  const overflow: { label: string; value: string }[] = [];
  let y = 656;
  const field = (label: string, value: string, x: number, width: number) => {
    text(page, label.toUpperCase(), x, y, font, 7, MUTED);
    const lines = wrap(value, font, 9, width);
    lines
      .slice(0, 2)
      .forEach((line, i) => text(page, line, x, y - 15 - i * 11, font));
    if (lines.length > 2) overflow.push({ label, value });
  };
  field("Project owner", draft.job.customer, 44, 300);
  field("Date", draft.job.date, 404, 164);
  y -= 36;
  field("Job number", draft.job.jobNumber, 44, 145);
  field("Project manager", draft.job.projectManager, 220, 160);
  field("Added working days", draft.job.addedDays, 404, 164);
  y -= 36;
  field("Property address", draft.job.address, 44, 524);
  y -= 36;
  field(
    "Classification",
    draft.job.insuranceRelated
      ? "[X] Insurance related   [ ] Non-insurance"
      : "[ ] Insurance related   [X] Non-insurance",
    44,
    310,
  );
  field(
    "Carrier / claim",
    `${draft.job.carrier || "N/A"} / ${draft.job.claim || "N/A"}`,
    374,
    194,
  );
  page.drawRectangle({
    x: 44,
    y: 493,
    width: 524,
    height: 19,
    color: YELLOW,
    borderColor: LINE,
    borderWidth: 1,
  });
  text(page, "This contract is changed as follows:", 55, 499, bold, 9);
  page.drawRectangle({
    x: 44,
    y: 378,
    width: 524,
    height: 115,
    borderColor: LINE,
    borderWidth: 1,
  });
  const scopeLines = wrap(scope, font, 9, 500);
  const shown = scopeLines.slice(0, 7);
  shown.forEach((line, i) => text(page, line, 55, 476 - i * 12, font));
  text(
    page,
    scopeLines.length > 7
      ? "Scope continues in Attachment A. See attachment for itemized changes."
      : "See Attachment A for the complete itemized changes.",
    55,
    389,
    font,
    8,
    MUTED,
  );
  page.drawRectangle({
    x: 44,
    y: 334,
    width: 524,
    height: 34,
    color: YELLOW,
    borderColor: LINE,
    borderWidth: 1,
  });
  text(
    page,
    "*Non-Insurance changes require 100% of the Change Order to be paid before work is started.",
    54,
    354,
    bold,
    8,
  );
  text(
    page,
    "Not valid until signed by owner and contractor and paid in full for non-insured work.",
    54,
    342,
    bold,
    8,
  );
  const financial: [string, string][] = [
    ["The original contract sum was:", money(summary.original)],
    [
      "Net changes by previous authorized change orders:",
      signedMoney(summary.previous),
    ],
    ["The contract sum prior to this change was:", money(summary.prior)],
    [
      `The contract sum will be ${summary.net > 0 ? "increased" : summary.net < 0 ? "decreased" : "unchanged"} by:`,
      money(Math.abs(summary.net)),
    ],
    [
      "The new contract sum including this change order will be:",
      money(summary.revised),
    ],
  ];
  financial.forEach(([label, value], index) => {
    const fy = 313 - index * 21;
    text(page, label, 44, fy, index === 4 ? bold : font, 9);
    right(
      page,
      value,
      568,
      fy,
      bold,
      index === 4 ? 11 : 9,
      index === 3 ? RED : INK,
    );
    page.drawLine({
      start: { x: 44, y: fy - 7 },
      end: { x: 568, y: fy - 7 },
      color: LINE,
      thickness: 0.5,
    });
  });
  text(
    page,
    `The contract time will be increased by ${draft.job.addedDays} working days.`,
    44,
    193,
    bold,
    9,
  );
  text(page, "Contractor", 44, 163, bold, 10);
  text(page, "Owner", 330, 163, bold, 10);
  for (const x of [44, 330]) {
    page.drawLine({
      start: { x, y: 134 },
      end: { x: x + 238, y: 134 },
      color: INK,
      thickness: 0.7,
    });
    text(page, "Signature", x, 123, font, 7, MUTED);
    page.drawLine({
      start: { x, y: 75 },
      end: { x: x + 238, y: 75 },
      color: INK,
      thickness: 0.7,
    });
    text(page, "Date", x, 64, font, 7, MUTED);
  }
  for (const [label, value, x] of [
    ["Contractor", draft.job.branchContact, 44],
    ["Owner", draft.job.customer, 330],
  ] as [string, string, number][]) {
    const rows = wrap(`${label}: ${value}`, font, 8, 238);
    rows
      .slice(0, 2)
      .forEach((line, i) => text(page, line, x, 109 - i * 10, font, 8));
    if (rows.length > 2) overflow.push({ label, value });
  }
  text(
    page,
    "Hays + Sons - Property Repair Specialists",
    44,
    35,
    font,
    8,
    MUTED,
  );
  right(page, "Change Order / Addendum", 568, 35, font, 8, MUTED);
  const attachment = await PDFDocument.create();
  const af = await attachment.embedFont(StandardFonts.Helvetica),
    ab = await attachment.embedFont(StandardFonts.HelveticaBold);
  let ap!: PDFPage;
  let ay = 0;
  const newPage = () => {
    ap = attachment.addPage([612, 792]);
    header(ap, draft, af, ab);
    text(ap, "Attachment A - Itemized Changes", 44, 682, ab, 15);
    text(
      ap,
      `${draft.job.jobNumber} | ${draft.job.orderNumber} | ${draft.job.date}`,
      44,
      661,
      af,
      9,
      MUTED,
    );
    ay = 633;
  };
  const ensure = (height: number) => {
    if (ay - height < 60) newPage();
  };
  const flowing = (value: string, size = 9, fontToUse = af, color = INK) => {
    for (const line of wrap(value, fontToUse, size, 516)) {
      ensure(size + 6);
      text(ap, line, 48, ay, fontToUse, size, color);
      ay -= size + 5;
    }
  };
  newPage();
  // Preserve every cover field in the attachment, including unusually long identities.
  const identity = [
    ["Project owner", draft.job.customer],
    ["Property", draft.job.address],
    ["Project manager", draft.job.projectManager],
    ["Contractor contact", draft.job.branchContact],
    [
      "Branch",
      `${draft.job.branchName} | ${draft.job.branchAddress} | ${draft.job.branchPhone}`,
    ],
  ];
  identity.forEach(([label, value]) =>
    flowing(`${label}: ${value}`, 9, af, MUTED),
  );
  ay -= 10;
  if (scopeLines.length > 7) {
    flowing("Complete scope summary", 10, ab);
    flowing(scope);
    ay -= 14;
  }
  const alreadyShown = new Set(identity.map(([label]) => label));
  overflow
    .filter((row) => !alreadyShown.has(row.label))
    .forEach((row) => flowing(`${row.label}: ${row.value}`));
  const bounds = [48, 120, 244, 324, 396, 468, 564];
  const pricingHeader = () => {
    ensure(100);
    ap.drawRectangle({
      x: 44,
      y: ay - 9,
      width: 524,
      height: 22,
      color: LIGHT,
    });
    ["Values", "Qty / unit", "Unit price", "Tax", "O&P", "Total"].forEach(
      (label, index) => {
        if (index < 2) text(ap, label, bounds[index], ay - 2, ab, 8, MUTED);
        else right(ap, label, bounds[index + 1] - 4, ay - 2, ab, 8, MUTED);
      },
    );
    ay -= 28;
  };
  draft.changes.forEach((row, index) => {
    ensure(125);
    ap.drawLine({
      start: { x: 44, y: ay + 13 },
      end: { x: 568, y: ay + 13 },
      color: LINE,
      thickness: 1,
    });
    flowing(
      `${String(index + 1).padStart(2, "0")}  ${row.action === "add" ? "ADD NEW WORK" : row.action === "remove" ? "REMOVE / CREDIT" : "REVISE"} | ${row.room || "Unassigned room"}`,
      10,
      ab,
    );
    if (row.original)
      flowing(
        `Source: line ${row.original.lineNumber || "manual"}${row.original.page ? `, page ${row.original.page}` : ""}`,
        8,
        af,
        MUTED,
      );
    flowing(row.description, 10, ab);
    flowing(`Reason: ${row.reason}`);
    ay -= 8;
    pricingHeader();
    const amounts = calculateChange(row);
    const values: [string, string, string, string, string, string][] = [
      [
        "Original",
        row.original ? `${row.original.quantity} ${row.original.unit}` : "-",
        row.original ? `$${row.original.rate}` : "-",
        money(row.original ? cents(row.original.tax) : 0),
        money(row.original ? cents(row.original.op) : 0),
        money(amounts.original),
      ],
      [
        "Revised",
        row.action === "remove" ? "0" : `${row.quantity} ${row.unit}`,
        row.action === "remove" ? "-" : `$${row.rate}`,
        row.action === "remove" ? money(0) : money(cents(row.tax)),
        row.action === "remove" ? money(0) : money(cents(row.op)),
        money(amounts.revised),
      ],
    ];
    values.forEach((columns) => {
      const cells = columns.map((value, column) =>
        wrap(value, af, 8, bounds[column + 1] - bounds[column] - 9),
      );
      const height = Math.max(...cells.map((cell) => cell.length)) * 11 + 8;
      ensure(height + 35);
      cells.forEach((cell, column) =>
        cell.forEach((value, line) => {
          if (column < 2)
            text(ap, value, bounds[column], ay - line * 11, af, 8);
          else right(ap, value, bounds[column + 1] - 4, ay - line * 11, af, 8);
        }),
      );
      ay -= height;
    });
    text(ap, "Net change", 48, ay, ab, 9);
    right(
      ap,
      signedMoney(amounts.delta),
      564,
      ay,
      ab,
      10,
      amounts.delta < 0 ? MUTED : RED,
    );
    ay -= 31;
  });
  ensure(100);
  ap.drawRectangle({ x: 44, y: ay - 78, width: 524, height: 92, color: LIGHT });
  text(ap, "CHANGE ORDER TOTAL", 55, ay - 5, ab, 9, MUTED);
  right(ap, signedMoney(summary.net), 556, ay - 5, ab, 15, RED);
  text(
    ap,
    "Original contract + previous authorized changes",
    55,
    ay - 31,
    af,
    9,
  );
  right(ap, money(summary.prior), 556, ay - 31, af, 10);
  text(ap, "Revised contract amount", 55, ay - 56, ab, 10);
  right(ap, money(summary.revised), 556, ay - 56, ab, 12);
  ay -= 100;
  flowing(
    "Tax and O&P amounts reviewed by the project manager. Original printed RCV is the baseline.",
    8,
    af,
    MUTED,
  );
  attachment.getPages().forEach((p, i) => {
    text(p, "Hays + Sons - Property Repair Specialists", 44, 35, af, 8, MUTED);
    right(
      p,
      `Attachment A - ${i + 1} of ${attachment.getPageCount()}`,
      568,
      35,
      af,
      8,
      MUTED,
    );
  });
  const combined = await PDFDocument.create();
  for (const doc of [form, attachment]) {
    const pages = await combined.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => combined.addPage(p));
  }
  const [formBytes, attachmentBytes, combinedBytes] = await Promise.all([
    form.save(),
    attachment.save(),
    combined.save(),
  ]);
  return {
    form: blob(formBytes),
    attachment: blob(attachmentBytes),
    combined: blob(combinedBytes),
  };
}
