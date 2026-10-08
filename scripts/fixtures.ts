import { mkdir, writeFile } from "node:fs/promises";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { samplePages, validDraft } from "../tests/helpers";
import { generateDocuments } from "../src/services/pdfGenerate";
import { createChange } from "../src/types";
await mkdir("tmp/fixtures", { recursive: true });
await mkdir("tmp/pdfs", { recursive: true });
const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (const data of samplePages()) {
  const page = source.addPage([612, 792]);
  for (const t of data.tokens)
    page.drawText(t.text, { x: t.x, y: t.y, size: 8, font });
}
await writeFile("tmp/fixtures/xactimate-final-draft.pdf", await source.save());
const scan = await PDFDocument.create();
const scanPage = scan.addPage([612, 792]);
scanPage.drawRectangle({ x: 45, y: 80, width: 520, height: 630 });
await writeFile("tmp/fixtures/no-text.pdf", await scan.save());
const d = validDraft();
const documents = await generateDocuments(d);
await writeFile(
  "tmp/pdfs/short-packet.pdf",
  new Uint8Array(await documents.combined.arrayBuffer()),
);
d.scopeEdited = true;
d.scope =
  "This detailed scope will continue on the attachment so the customer can read the entire description. ".repeat(
    30,
  ) + "END OF COMPLETE SCOPE.";
for (let i = 0; i < 14; i++) {
  const item = createChange(null);
  Object.assign(item, {
    description: `Additional repair ${i + 1}: ${"Install matching materials and verify the finish. ".repeat(3)}`,
    room: "Kitchen",
    quantity: "2",
    rate: "45.50",
    tax: "6.37",
    op: "18.20",
    reason: "Customer-approved upgrade to the damaged finishes.",
    pricingConfirmed: true,
  });
  d.changes.push(item);
}
const long = await generateDocuments(d);
await writeFile(
  "tmp/pdfs/long-packet.pdf",
  new Uint8Array(await long.combined.arrayBuffer()),
);
console.log(
  "Created synthetic Xactimate fixtures and short/long QA packets in tmp/.",
);
