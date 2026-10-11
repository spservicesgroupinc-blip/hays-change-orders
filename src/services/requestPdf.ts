import { PDFDocument, PageSizes, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ChangeRequest } from "../types";
import { contractAmounts } from "./contract";
import { requestTypeLabel, customerCreditsLabel } from "./dashNote";

export function summaryFilename(request: ChangeRequest): string {
  const identifier = (request.job.jobNumber.trim() || request.id)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
  return `request-summary-${identifier || "request"}.pdf`;
}

/** Generate from a saved snapshot. Font bytes are injected for browser and Node QA. */
export async function generateRequestPdf(
  request: ChangeRequest,
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  // Make unsupported characters explicit instead of dropping text or crashing.
  const printable = (text: string) =>
    Array.from(text.replace(/\r\n?/g, "\n").replace(/\t/g, "    "))
      .map((char) =>
        char === "\n" || supported.has(char.codePointAt(0)!)
          ? char
          : `[U+${char.codePointAt(0)!.toString(16).toUpperCase()}]`,
      )
      .join("");
  const [width, height] = PageSizes.Letter;
  const margin = 48;
  const available = width - 2 * margin;
  let page = pdf.addPage(PageSizes.Letter);
  let y = height - margin;
  const nextPage = () => {
    page = pdf.addPage(PageSizes.Letter);
    y = height - margin;
    page.drawText("Hays + Sons | Request summary (continued)", {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 28;
  };
  const ensure = (space: number) => {
    if (y - space < margin + 18) nextPage();
  };
  const line = (text: string, size = 11, color = rgb(0.12, 0.12, 0.12)) => {
    ensure(size + 5);
    if (text) page.drawText(text, { x: margin, y, size, font, color });
    y -= size + 5;
  };
  const paragraph = (text: string, size = 11) => {
    for (const block of printable(text).split("\n")) {
      let current = "";
      for (const char of block) {
        if (font.widthOfTextAtSize(current + char, size) > available) {
          const lastSpace = current.lastIndexOf(" ");
          if (lastSpace > 0) {
            line(current.slice(0, lastSpace).trimEnd(), size);
            current = current.slice(lastSpace + 1) + char;
          } else {
            line(current, size);
            current = char;
          }
        } else current += char;
      }
      line(current.trimEnd(), size);
    }
  };
  const section = (title: string) => {
    ensure(60);
    y -= 12;
    line(title, 13, rgb(0.7, 0.1, 0.1));
    y -= 3;
  };
  const field = (label: string, value: string | undefined) =>
    paragraph(`${label}: ${value?.trim() ? value : "Not provided"}`);
  pdf.setTitle(
    `Request summary - ${request.job.jobNumber || request.job.customer || request.id}`,
  );
  pdf.setAuthor("Hays + Sons");
  line("Hays + Sons", 18);
  line("Change request summary", 15);
  field("Request ID", request.id);
  field(
    "Submitted",
    request.submittedAt
      ? new Date(request.submittedAt).toLocaleString("en-US", {
          timeZone: "America/Indianapolis",
        })
      : undefined,
  );
  field("Status", request.status.replace(/_/g, " "));
  field("Assigned estimator", request.estimatorName);
  field("Request type", requestTypeLabel(request.requestType));
  field("Customer credits", customerCreditsLabel(request.customerCredits));
  section("Customer and job details");
  const job = request.job;
  for (const [label, value] of [
    ["Customer", job.customer],
    ["Property address", job.address],
    ["Customer phone", job.customerPhone],
    ["Customer email", job.customerEmail],
    ["Job number", job.jobNumber],
    ["Project manager", job.projectManager],
  ])
    field(label!, value);
  for (const [label, value] of [
    ["Change-order number", job.orderNumber],
    ["Insurance carrier", job.carrier],
    ["Claim number", job.claim],
  ]) {
    if (value?.trim()) field(label, value);
  }
  section("Contract price");
  const amounts = contractAmounts(job);
  field("Original contract", amounts.original);
  field("Previous authorized changes", amounts.previous);
  paragraph(`Total contract price: ${amounts.total}`, 14);
  paragraph(
    "Total includes previous authorized changes and excludes this unpriced request.",
    9,
  );
  section("Submitted changes");
  if (!request.requestedChanges.length)
    paragraph("No written description was provided.");
  request.requestedChanges.forEach((change, index) => {
    ensure(50);
    paragraph(
      `Change ${index + 1}${change.room ? ` - ${change.room}` : ""} (${change.action})`,
      12,
    );
    paragraph(change.description || "No description provided.");
    for (const [label, value] of [
      ["Reason", change.reason],
      ["Measurements", change.measurements],
      ["Materials", change.materials],
      ["Schedule impact", change.scheduleImpact],
    ]) {
      if (value?.trim()) field(label, value);
    }
    y -= 8;
  });
  if (request.informationQuestion?.trim()) {
    section("Outstanding information request");
    paragraph(request.informationQuestion);
  }
  section("Attachments");
  if (!request.attachments.length) paragraph("No attachments.");
  request.attachments.forEach((attachment, index) =>
    paragraph(`${index + 1}. ${attachment.name}`),
  );
  const pages = pdf.getPages();
  pages.forEach((item, index) =>
    item.drawText(`Request summary | Page ${index + 1} of ${pages.length}`, {
      x: margin,
      y: 28,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    }),
  );
  return pdf.save();
}
