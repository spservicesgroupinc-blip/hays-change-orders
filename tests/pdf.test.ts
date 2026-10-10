import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import { generateDocuments } from "../src/services/pdfGenerate";
import { createChange, createDraft } from "../src/types";
import { validDraft } from "./helpers";
async function contents(blob: Blob) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false,
  }).promise;
  let output = "";
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const text = await page.getTextContent();
    output += text.items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
  }
  await doc.destroy();
  return output;
}
test("forms, itemization, combined page count, and displayed prices agree", async () => {
  const d = validDraft();
  const docs = await generateDocuments(d);
  const form = await PDFDocument.load(await docs.form.arrayBuffer());
  const attachment = await PDFDocument.load(
    await docs.attachment.arrayBuffer(),
  );
  const combined = await PDFDocument.load(await docs.combined.arrayBuffer());
  assert.equal(form.getPageCount(), 1);
  assert.equal(
    combined.getPageCount(),
    form.getPageCount() + attachment.getPageCount(),
  );
  const text = await contents(docs.combined);
  for (const expected of [
    "$112.00",
    "$10,112.00",
    "$224.00",
    "$336.00",
    "Sample Customer",
    "Attachment A",
    "Additional wall area discovered",
  ])
    assert.ok(text.includes(expected), expected);
});
test("long summaries and many items paginate without losing the last item or reason", async () => {
  const d = validDraft();
  d.scopeEdited = true;
  d.scope =
    "Long scope sentence that must continue in the attachment. ".repeat(100) +
    "END_OF_SCOPE";
  for (let i = 0; i < 35; i++) {
    const change = createChange(null);
    Object.assign(change, {
      room: "Kitchen",
      description: `Additional item ${i} ${"Detailed work description ".repeat(4)}`,
      rate: "10.50",
      reason: `Reason ${i} with a long explanation.`,
      pricingConfirmed: true,
    });
    d.changes.push(change);
  }
  const docs = await generateDocuments(d);
  const pdf = await PDFDocument.load(await docs.attachment.arrayBuffer());
  assert.ok(pdf.getPageCount() > 4);
  const text = await contents(docs.attachment);
  assert.ok(text.includes("END_OF_SCOPE"));
  assert.ok(text.includes("Additional item 34"));
  assert.ok(text.includes("Reason 34"));
});
test("unconfirmed and malformed input still generates a packet", async () => {
  const d = validDraft();
  d.changes[0].pricingConfirmed = false;
  d.job.customer = "";
  d.job.date = "";
  d.job.originalContract = "";
  d.job.addedDays = "";
  d.changes[0].rate = "not a number";
  d.changes[0].tax = "";
  const docs = await generateDocuments(d);
  const text = await contents(docs.combined);
  assert.ok(text.includes("Attachment A"));
  assert.ok(text.includes("$0.00"));
});
test("a completely blank order generates form, attachment, and combined PDFs", async () => {
  const docs = await generateDocuments(createDraft());
  const form = await PDFDocument.load(await docs.form.arrayBuffer());
  const attachment = await PDFDocument.load(
    await docs.attachment.arrayBuffer(),
  );
  const combined = await PDFDocument.load(await docs.combined.arrayBuffer());
  assert.equal(form.getPageCount(), 1);
  assert.equal(
    combined.getPageCount(),
    form.getPageCount() + attachment.getPageCount(),
  );
  const text = await contents(docs.combined);
  for (const expected of [
    "Change Order / Addendum",
    "Attachment A",
    "0 working days",
  ])
    assert.ok(text.includes(expected), expected);
});
