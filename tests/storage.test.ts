import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { saveDraft, listDrafts, deleteDraft } from "../src/services/storage";
import { validDraft } from "./helpers";
test("round trips drafts and source PDF blobs; stale saves cannot replace new edits", async () => {
  const d = validDraft();
  d.source = {
    name: "source.pdf",
    pages: 1,
    blob: new Blob(["pdf-content"], { type: "application/pdf" }),
  };
  await saveDraft(d);
  const current = {
    ...d,
    revision: 3,
    job: { ...d.job, customer: "Newer customer" },
  };
  await Promise.all([saveDraft(current), saveDraft(d)]);
  const recovered = (await listDrafts()).find((r) => r.id === d.id)!;
  assert.equal(recovered.job.customer, "Newer customer");
  assert.equal(recovered.source?.name, "source.pdf");
  assert.equal(await recovered.source!.blob.text(), "pdf-content");
  assert.equal(recovered.changes[0].original?.rcv, "224.00");
  await deleteDraft(d.id);
  assert.ok(!(await listDrafts()).some((r) => r.id === d.id));
});
test("storage access failures reject instead of reporting a saved draft", async () => {
  const original = globalThis.indexedDB;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        throw new DOMException("Device quota reached", "QuotaExceededError");
      },
    },
  });
  try {
    await assert.rejects(saveDraft(validDraft()), /Device quota reached/);
  } finally {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: original,
    });
  }
});
test("unsupported saved schemas fail clearly and preserve the stored record", async () => {
  const d = validDraft();
  await saveDraft({ ...d, schemaVersion: 2 } as unknown as typeof d);
  await assert.rejects(listDrafts(), /data has been preserved/);
  await deleteDraft(d.id);
  assert.ok(!(await listDrafts()).some((row) => row.id === d.id));
});
