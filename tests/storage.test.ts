import { test } from "node:test";
import assert from "node:assert/strict";
import {
  serializeDraft,
  deserializeDraft,
  listDrafts,
  openDraft,
  saveDraft,
  deleteDraft,
  type SerializedDraft,
} from "../src/services/storage";
import { validDraft } from "./helpers";

function summaryOf(d: SerializedDraft) {
  return {
    id: d.id,
    revision: d.revision,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    step: d.step,
    customer: d.job.customer,
    jobNumber: d.job.jobNumber,
    orderNumber: d.job.orderNumber,
    changesCount: d.changes.length,
    sourceName: d.source?.name ?? "",
    hasSource: Boolean(d.source?.driveFileId),
  };
}
function installFetch() {
  const rows = new Map<string, SerializedDraft>();
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const query = new URLSearchParams(
      url.includes("?") ? url.slice(url.indexOf("?") + 1) : "",
    );
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : {};
    const action = String(query.get("action") ?? body.action ?? "");
    const reply = (obj: unknown) =>
      ({ ok: true, status: 200, json: async () => obj }) as unknown as Response;
    if (action === "list")
      return reply({
        ok: true,
        drafts: [...rows.values()]
          .map(summaryOf)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      });
    if (action === "open") {
      const draft = rows.get(String(query.get("id")));
      return draft
        ? reply({ ok: true, draft })
        : reply({ ok: false, error: "Draft not found." });
    }
    if (action === "save") {
      const draft = body.draft as SerializedDraft;
      const previous = rows.get(draft.id);
      if (previous && previous.revision > draft.revision)
        return reply({
          ok: false,
          error: "A newer version of this draft already exists.",
        });
      rows.set(draft.id, draft);
      return reply({ ok: true });
    }
    if (action === "delete") {
      rows.delete(String(body.id));
      return reply({ ok: true });
    }
    return reply({ ok: false, error: "Unknown action." });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("serialization drops the source blob and keeps the Drive file id", () => {
  const d = validDraft();
  d.source = {
    name: "source.pdf",
    pages: 3,
    blob: new Blob(["pdf-content"], { type: "application/pdf" }),
    driveFileId: "drive-123",
  };
  const serialized = serializeDraft(d);
  assert.equal("blob" in serialized.source!, false);
  assert.equal(serialized.source!.driveFileId, "drive-123");
  assert.equal(serialized.source!.pages, 3);
  const restored = deserializeDraft(serialized);
  assert.equal(restored.source!.blob, null);
  assert.equal(restored.source!.driveFileId, "drive-123");
});
test("saves, lists, opens, and deletes through the remote API", async () => {
  const restore = installFetch();
  try {
    const d = validDraft();
    d.source = {
      name: "source.pdf",
      pages: 1,
      blob: new Blob(["pdf"], { type: "application/pdf" }),
      driveFileId: "drive-1",
    };
    await saveDraft(d);
    const list = await listDrafts();
    assert.equal(list.length, 1);
    assert.equal(list[0].job.customer, "Sample Customer");
    assert.equal(list[0].changesCount, d.changes.length);
    const opened = await openDraft(d.id);
    assert.equal(opened.id, d.id);
    assert.equal(opened.source!.blob, null);
    assert.equal(opened.source!.driveFileId, "drive-1");
    await deleteDraft(d.id);
    assert.equal((await listDrafts()).length, 0);
  } finally {
    restore();
  }
});
test("stale saves are rejected so a newer edit cannot be overwritten", async () => {
  const restore = installFetch();
  try {
    const current = { ...validDraft(), revision: 5 };
    await saveDraft(current);
    const stale = { ...current, revision: 3 };
    await assert.rejects(saveDraft(stale), /newer version/i);
  } finally {
    restore();
  }
});
