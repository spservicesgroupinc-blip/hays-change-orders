import { test } from "node:test";
import assert from "node:assert/strict";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import { generateDocuments } from "../src/services/pdfGenerate";
import {
  createRequest,
  createRequestedChange,
  requestToDraft,
} from "../src/services/requests";
import { createChange } from "../src/types";
import { validDraft } from "./helpers";

async function pdfText(blob: Blob) {
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    isEvalSupported: false,
  }).promise;
  let text = "";
  for (let n = 1; n <= document.numPages; n++) {
    const page = await document.getPage(n);
    const contents = await page.getTextContent();
    text +=
      contents.items.map((item) => ("str" in item ? item.str : "")).join(" ") +
      "\n";
  }
  await document.destroy();
  return text;
}

test("customer DTO and every PDF exclude quote costs, vendor PDFs, PM notes, and unknown internal fields", async () => {
  const legacy = validDraft();
  const request = createRequest();
  request.job = legacy.job;
  const intake = {
    ...createRequestedChange(),
    room: "Kitchen",
    description: "PRIVATE_PM_SCOPE_99",
    reason: "PRIVATE_PM_REASON_99",
  };
  request.requestedChanges = [intake];
  request.quotes = [
    {
      id: "quote",
      subcontractor: "PRIVATE_VENDOR_99",
      trade: "PRIVATE_TRADE_99",
      cost: "9876.54",
      notes: "PRIVATE_COST_NOTE_99",
      changeIds: [intake.id],
      attachmentIds: ["quote-pdf"],
    },
  ];
  request.attachments = [
    {
      id: "quote-pdf",
      kind: "quote",
      name: "PRIVATE_VENDOR_DOC_99.pdf",
      mimeType: "application/pdf",
      size: 100,
      driveFileId: "PRIVATE_DRIVE_ID_99",
    },
  ];
  request.exclusions = { private: "PRIVATE_EXCLUSION_99" };
  request.customerScope = "Approved kitchen restoration scope";
  request.customerScopeEdited = true;
  const row = createChange(null);
  Object.assign(row, {
    requestChangeId: intake.id,
    room: "Kitchen",
    description: "Approved cabinet installation",
    reason: "Revised customer material selection",
    pricingConfirmed: true,
    customerPrice: { total: "450.00", tax: null, op: null },
  });
  request.pricedItems = [row];
  Object.assign(request, { privateFutureField: "PRIVATE_UNKNOWN_99" });
  Object.assign(row, { vendorNotes: "PRIVATE_ROW_UNKNOWN_99" });
  const draft = requestToDraft(request);
  const serialized = JSON.stringify(draft);
  assert.ok(!serialized.includes("PRIVATE_"));
  const documents = await generateDocuments(draft);
  for (const output of [
    documents.combined,
    documents.form,
    documents.attachment,
  ]) {
    const text = await pdfText(output);
    assert.ok(!text.includes("PRIVATE_"));
    assert.ok(!text.includes("9,876.54"));
  }
  const attachmentText = await pdfText(documents.attachment);
  assert.ok(attachmentText.includes("Included"));
  assert.ok(attachmentText.includes("$450.00"));
  assert.ok(attachmentText.includes("confirmed by the estimator"));
});

test("manual customer credits and known included breakdowns agree across form and attachment", async () => {
  const draft = validDraft();
  draft.changes[0].customerPrice = {
    total: "350.00",
    tax: "15.00",
    op: "35.00",
  };
  const credit = createChange(null, "remove");
  Object.assign(credit, {
    description: "Credit unused customer selection",
    reason: "Selection removed",
    manualCredit: "75.00",
    pricingConfirmed: true,
  });
  draft.changes.push(credit);
  const documents = await generateDocuments(draft);
  const text = await pdfText(documents.combined);
  for (const expected of [
    "$51.00",
    "$10,051.00",
    "CUSTOMER CREDIT",
    "-$75.00",
    "$15.00",
    "$35.00",
    "$350.00",
  ])
    assert.ok(text.includes(expected), expected);
});
