import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import {
  createRequest,
  createRequestedChange,
  createQuote,
  submissionErrors,
  readyErrors,
  requestToDraft,
  convertLegacyDraft,
  invalidateIntakeChanges,
} from "../src/services/requests";
import {
  openRequest,
  saveRequest,
  listRequests,
  loadDashboard,
  claimRequest,
  transitionRequest,
  uploadAttachment,
  fetchAttachment,
  convertLegacyRequest,
  ApiError,
} from "../src/services/storage";
import { validDraft } from "./helpers";
import type { ChangeRequest, RequestAttachment } from "../src/types";

function validRequest(): ChangeRequest {
  const legacy = validDraft();
  const request = createRequest();
  request.job = legacy.job;
  const change = {
    ...createRequestedChange(),
    room: "Living room",
    description: "Paint additional wall area",
    reason: "Hidden damage discovered",
  };
  request.requestedChanges = [change];
  request.estimate = legacy.estimate;
  request.pricedItems = legacy.changes.map((row) => ({
    ...row,
    requestChangeId: change.id,
  }));
  request.customerScope = "Repair additional wall area.";
  request.customerScopeEdited = true;
  request.customerScopeConfirmed = true;
  request.contractConfirmed = true;
  request.estimatorName = "Sample Estimator";
  return request;
}
function intakeRequest(): ChangeRequest {
  const request = validRequest();
  request.estimatorName = "";
  request.pricedItems = [];
  request.contractConfirmed = false;
  request.customerScopeConfirmed = false;
  return request;
}
function mockBackend() {
  const sheets = new Map<string, any>();
  const files = new Map<string, any>();
  const folders = new Map<string, any>();
  const props = new Map([
    ["API_KEY", "TEST-KEY"],
    ["SPREADSHEET_ID", "sheet-1"],
  ]);
  let counter = 0,
    locked = false,
    failNextWrite = false;
  const iterator = (values: any[]) => {
    let i = 0;
    return { hasNext: () => i < values.length, next: () => values[i++] };
  };
  function blob(
    data: any,
    mimeType = "application/octet-stream",
    name = "file",
  ) {
    const bytes =
      typeof data === "string" ? [...Buffer.from(data, "utf8")] : [...data];
    return {
      bytes,
      name,
      mimeType,
      getBytes: () => [...bytes],
      getDataAsString: () => Buffer.from(bytes).toString("utf8"),
    };
  }
  function folder(name: string, id = `folder-${++counter}`): any {
    const result = {
      id,
      name,
      getId: () => id,
      getName: () => name,
      createFolder: (nextName: string) => folder(nextName),
      getFoldersByName: (target: string) =>
        iterator(
          [...folders.values()].filter((value) => value.name === target),
        ),
      getFilesByName: (target: string) =>
        iterator(
          [...files.values()].filter(
            (value) =>
              !value.trashed && value.folderId === id && value.name === target,
          ),
        ),
      createFile: (source: any) => file(source, id),
    };
    folders.set(id, result);
    return result;
  }
  function file(source: any, folderId: string): any {
    const id = `file-${++counter}`;
    const result: any = {
      id,
      folderId,
      name: source.name,
      mimeType: source.mimeType,
      bytes: source.bytes,
      description: "",
      trashed: false,
      getId: () => id,
      getName: () => result.name,
      getMimeType: () => result.mimeType,
      getBlob: () => blob(result.bytes, result.mimeType, result.name),
      getDescription: () => result.description,
      setDescription: (description: string) => {
        result.description = description;
        return result;
      },
      getParents: () => iterator([folders.get(folderId)]),
      setTrashed: (trashed: boolean) => {
        result.trashed = trashed;
      },
      setBlob: (value: any) => {
        result.bytes = value.bytes;
        result.mimeType = value.mimeType;
      },
      makeCopy: (name: string, destination: any) =>
        destination.createFile(blob(result.bytes, result.mimeType, name)),
    };
    files.set(id, result);
    return result;
  }
  function sheet(name: string) {
    const rows: any[][] = [];
    const result: any = {
      name,
      rows,
      getName: () => name,
      getLastRow: () => rows.length,
      appendRow: (values: any[]) => {
        rows.push([...values]);
      },
      deleteRow: (row: number) => {
        rows.splice(row - 1, 1);
      },
      getRange: (row: number, col: number, height = 1, width = 1) => ({
        getValues: () =>
          Array.from({ length: height }, (_, r) =>
            Array.from(
              { length: width },
              (_, c) => rows[row + r - 1]?.[col + c - 1] ?? "",
            ),
          ),
        getValue: () => rows[row - 1]?.[col - 1] ?? "",
        setValues: (values: any[][]) => {
          if (failNextWrite) {
            failNextWrite = false;
            throw new Error("Index write unavailable");
          }
          values.forEach((value, r) =>
            value.forEach((entry, c) => {
              if (typeof entry === "string" && entry.length > 50000)
                throw new Error("Sheets cell limit exceeded");
              rows[row + r - 1] ??= [];
              rows[row + r - 1][col + c - 1] = entry;
            }),
          );
        },
      }),
    };
    sheets.set(name, result);
    return result;
  }
  const root = folder("root", "root");
  const spreadsheet = {
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: sheet,
    getId: () => "sheet-1",
  };
  const sandbox: any = {
    SpreadsheetApp: {
      openById: (id: string) => {
        assert.equal(id, "sheet-1");
        return spreadsheet;
      },
      getActiveSpreadsheet: () => null,
      flush: () => {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => props.get(key) ?? null,
        setProperty: (key: string, value: string) => props.set(key, value),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (locked) return false;
          locked = true;
          return true;
        },
        releaseLock: () => {
          locked = false;
        },
      }),
    },
    DriveApp: {
      getRootFolder: () => root,
      getFileById: (id: string) => {
        const value = files.get(id);
        if (!value || value.trashed) throw new Error("File not found");
        return value;
      },
      getFolderById: (id: string) => {
        const value = folders.get(id);
        if (!value) throw new Error("Folder not found");
        return value;
      },
    },
    Utilities: {
      newBlob: blob,
      getUuid: randomUUID,
      base64Encode: (bytes: number[]) => Buffer.from(bytes).toString("base64"),
      base64Decode: (text: string) => [...Buffer.from(text, "base64")],
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text: string) => ({
        text,
        setMimeType() {
          return this;
        },
      }),
    },
    Logger: { log: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8"),
    sandbox,
  );
  return {
    sheets,
    files,
    folders,
    post: (body: any) =>
      JSON.parse(
        sandbox.doPost({
          postData: { contents: JSON.stringify({ ...body, key: "TEST-KEY" }) },
        }).text,
      ),
    get: (parameter: any) =>
      JSON.parse(
        sandbox.doGet({ parameter: { ...parameter, key: "TEST-KEY" } }).text,
      ),
    failWrite: () => {
      failNextWrite = true;
    },
    busy: (value: boolean) => {
      locked = value;
    },
    legacyFile: () =>
      root.createFile(
        blob("%PDF-1.4\nlegacy", "application/pdf", "legacy.pdf"),
      ),
    installFetch: () => {
      const original = globalThis.fetch;
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = new URL(String(input), "http://test.local");
        const output = init?.body
          ? JSON.parse(
              sandbox.doPost({
                postData: {
                  contents: JSON.stringify({
                    ...JSON.parse(String(init.body)),
                    key: "TEST-KEY",
                  }),
                },
              }).text,
            )
          : JSON.parse(
              sandbox.doGet({
                parameter: {
                  ...Object.fromEntries(url.searchParams),
                  key: "TEST-KEY",
                },
              }).text,
            );
        return new Response(JSON.stringify(output), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;
      return () => {
        globalThis.fetch = original;
      };
    },
  };
}
function save(
  backend: ReturnType<typeof mockBackend>,
  request: ChangeRequest,
  mutationId = randomUUID(),
  revision = request.revision,
) {
  return backend.post({
    action: "saveRequest",
    request,
    expectedRevision: revision,
    mutationId,
  });
}
function upload(
  backend: ReturnType<typeof mockBackend>,
  requestId: string,
  attachmentId = randomUUID(),
  mutationId = randomUUID(),
) {
  const data = "%PDF-1.4\ntest";
  return backend.post({
    action: "uploadAttachment",
    requestId,
    attachmentId,
    mutationId,
    file: {
      name: "quote.pdf",
      mimeType: "application/pdf",
      kind: "quote",
      size: Buffer.byteLength(data),
      data: Buffer.from(data).toString("base64"),
    },
  });
}

test("PM submissions are permissive — any fields may be missing", () => {
  const request = intakeRequest();
  request.job.jobNumber = "";
  request.job.customer = "";
  request.job.address = "";
  request.job.projectManager = "";
  request.requestedChanges[0].room = "";
  request.requestedChanges[0].description = "";
  request.requestedChanges[0].reason = "";
  request.quotes = [{ ...createQuote(), cost: "-2" }];
  assert.deepEqual(submissionErrors(request), []);
  assert.deepEqual(submissionErrors(createRequest()), []);
});
test("readiness never blocks, however little data has been entered", () => {
  assert.deepEqual(readyErrors(createRequest()), []);
  assert.deepEqual(readyErrors(validRequest()), []);
  const request = validRequest();
  request.estimatorName = "";
  request.contractConfirmed = false;
  request.customerScopeConfirmed = false;
  request.job.customer = "";
  request.job.date = "2026-02-31";
  request.job.originalContract = "";
  request.job.addedDays = "";
  request.pricedItems[0].pricingConfirmed = false;
  request.pricedItems[0].original!.reviewed = false;
  request.pricedItems[0].requestChangeId = "";
  request.pricedItems.push({
    ...structuredClone(request.pricedItems[0]),
    id: randomUUID(),
  });
  request.requestedChanges.push({
    ...createRequestedChange(),
    room: "Kitchen",
    description: "Remove cabinet",
    reason: "Damage",
  });
  assert.deepEqual(readyErrors(request), []);
});
test("customer draft projection does not contain vendor costs, internal notes or source text", () => {
  const request = validRequest();
  request.quotes = [
    { ...createQuote(), notes: "SECRET_VENDOR_NOTES", cost: "91234.56" },
  ];
  request.requestedChanges[0].reason = "SECRET_PM_REASON";
  request.requestedChanges[0].materials = "SECRET_PM_MATERIAL";
  request.pricedItems[0].original!.rawText = "SECRET_SOURCE_TEXT";
  const draft = requestToDraft(request);
  const output = JSON.stringify(draft);
  assert.doesNotMatch(output, /SECRET|91234\.56|requestChangeId|quotes/);
  assert.equal(draft.changes[0].reason, request.pricedItems[0].reason);
});
test("intake changes invalidate linked pricing, while quotes spanning areas invalidate both", () => {
  const before = validRequest();
  const second = {
    ...createRequestedChange(),
    room: "Kitchen",
    description: "Repair",
    reason: "Damage",
  };
  before.requestedChanges.push(second);
  before.pricedItems.push({
    ...structuredClone(before.pricedItems[0]),
    id: randomUUID(),
    original: null,
    requestChangeId: second.id,
  });
  const after = structuredClone(before);
  after.requestedChanges[0].measurements = "20 SF";
  const invalidated = invalidateIntakeChanges(before, after);
  assert.equal(invalidated.pricedItems[0].pricingConfirmed, false);
  assert.equal(invalidated.pricedItems[1].pricingConfirmed, true);
  assert.equal(invalidated.contractConfirmed, false);
  const quote = {
    ...createQuote(),
    changeIds: before.requestedChanges.map((change) => change.id),
    cost: "100",
  };
  before.quotes = [quote];
  const quoteEdit = structuredClone(before);
  quoteEdit.quotes[0].cost = "200";
  assert.ok(
    invalidateIntakeChanges(before, quoteEdit).pricedItems.every(
      (row) => !row.pricingConfirmed,
    ),
  );
  before.status = "ready";
  assert.equal(invalidateIntakeChanges(before, after), before);
});
test("legacy conversion carries prior pricing unconfirmed and retains original data", () => {
  const legacy = validDraft();
  const frozen = JSON.stringify(legacy);
  const request = convertLegacyDraft(legacy);
  assert.equal(request.legacyDraftId, legacy.id);
  assert.notEqual(request.id, legacy.id);
  assert.equal(
    request.pricedItems[0].requestChangeId,
    request.requestedChanges[0].id,
  );
  assert.equal(request.pricedItems[0].rate, legacy.changes[0].rate);
  assert.equal(request.pricedItems[0].pricingConfirmed, false);
  assert.equal(JSON.stringify(legacy), frozen);
});
test("actual Apps Script stores large JSON in Drive and small searchable queue rows", () => {
  const backend = mockBackend();
  const request = intakeRequest();
  request.extractionWarnings = ["x".repeat(170000)];
  const result = save(backend, request);
  assert.equal(result.ok, true);
  assert.equal(result.request.revision, 1);
  const row = backend.sheets.get("Requests").rows[1];
  assert.ok(
    row.every(
      (value: any) => typeof value !== "string" || value.length < 50000,
    ),
  );
  assert.equal(typeof row[13], "string");
  const opened = backend.get({ action: "openRequest", id: request.id });
  assert.equal(opened.request.extractionWarnings[0].length, 170000);
  const listed = backend.get({ action: "listRequests" });
  assert.equal(
    listed.requests[0].job.projectManager,
    request.job.projectManager,
  );
});
test("exact server revisions reject equal-revision competing saves and recognize retries", () => {
  const backend = mockBackend();
  const initial = save(backend, intakeRequest()).request;
  const first = structuredClone(initial);
  first.requestedChanges[0].description = "Winner";
  const id = randomUUID();
  const saved = save(backend, first, id);
  assert.equal(saved.request.revision, 2);
  const competing = structuredClone(initial);
  competing.requestedChanges[0].description = "Loser";
  assert.equal(save(backend, competing).code, "CONFLICT");
  const retried = save(backend, first, id, 1);
  assert.equal(retried.request.revision, 2);
  assert.equal(retried.request.requestedChanges[0].description, "Winner");
  assert.equal(backend.sheets.get("Requests").rows[1][14] !== "", true);
});
test("failed index write keeps the old snapshot authoritative and releases the lock", () => {
  const backend = mockBackend();
  const initial = save(backend, intakeRequest()).request;
  const next = structuredClone(initial);
  next.requestedChanges[0].description = "Unsaved";
  backend.failWrite();
  assert.equal(save(backend, next).ok, false);
  assert.equal(
    backend.get({ action: "openRequest", id: initial.id }).request
      .requestedChanges[0].description,
    initial.requestedChanges[0].description,
  );
  assert.equal(save(backend, next).ok, true);
  backend.busy(true);
  assert.equal(save(backend, next).code, "BUSY");
  backend.busy(false);
});
test("submitted queue claims have one winner and requests for information return to the same estimator", () => {
  const backend = mockBackend();
  let request = save(backend, intakeRequest()).request;
  request = backend.post({
    action: "transitionRequest",
    id: request.id,
    expectedRevision: request.revision,
    status: "submitted",
    question: "",
    mutationId: randomUUID(),
  }).request;
  assert.equal(request.status, "submitted");
  assert.equal(save(backend, request).code, "STATE");
  const expected = request.revision;
  request = backend.post({
    action: "claimRequest",
    id: request.id,
    expectedRevision: expected,
    estimatorName: "Estimator A",
    mutationId: randomUUID(),
  }).request;
  assert.equal(request.status, "in_review");
  assert.equal(
    backend.post({
      action: "claimRequest",
      id: request.id,
      expectedRevision: expected,
      estimatorName: "Estimator B",
      mutationId: randomUUID(),
    }).code,
    "CONFLICT",
  );
  assert.equal(
    backend.post({
      action: "transitionRequest",
      id: request.id,
      expectedRevision: request.revision,
      status: "needs_information",
      question: "",
      mutationId: randomUUID(),
    }).code,
    "VALIDATION",
  );
  request = backend.post({
    action: "transitionRequest",
    id: request.id,
    expectedRevision: request.revision,
    status: "needs_information",
    question: "What is the measured area?",
    mutationId: randomUUID(),
  }).request;
  request.requestedChanges[0].measurements = "20 SF";
  request = save(backend, request).request;
  request = backend.post({
    action: "transitionRequest",
    id: request.id,
    expectedRevision: request.revision,
    status: "submitted",
    question: "",
    mutationId: randomUUID(),
  }).request;
  assert.equal(request.status, "in_review");
  assert.equal(request.estimatorName, "Estimator A");
  assert.equal(request.informationQuestion, "");
});
test("server accepts readiness at any point and makes Ready records immutable", () => {
  const backend = mockBackend();
  let request = save(backend, intakeRequest()).request;
  request = backend.post({
    action: "transitionRequest",
    id: request.id,
    expectedRevision: request.revision,
    status: "submitted",
    question: "",
    mutationId: randomUUID(),
  }).request;
  request = backend.post({
    action: "claimRequest",
    id: request.id,
    expectedRevision: request.revision,
    estimatorName: "Sample Estimator",
    mutationId: randomUUID(),
  }).request;
  const transition = () =>
    backend.post({
      action: "transitionRequest",
      id: request.id,
      expectedRevision: request.revision,
      status: "ready",
      question: "",
      mutationId: randomUUID(),
    });
  // Nothing is confirmed, priced, or filled in beyond the claim itself.
  assert.equal(request.pricedItems.length, 0);
  assert.equal(request.contractConfirmed, false);
  request = transition().request;
  assert.equal(request.status, "ready");
  assert.equal(save(backend, request).code, "STATE");
  assert.equal(
    backend.post({
      action: "transitionRequest",
      id: request.id,
      expectedRevision: request.revision,
      status: "in_review",
      question: "",
      mutationId: randomUUID(),
    }).code,
    "STATE",
  );
});
test("staged attachment retry is idempotent and linking is ownership-checked", () => {
  const backend = mockBackend();
  let request = save(backend, intakeRequest()).request;
  const id = randomUUID(),
    mutation = randomUUID();
  const uploaded = upload(backend, request.id, id, mutation);
  assert.equal(uploaded.ok, true);
  const attachment = uploaded.attachment as RequestAttachment;
  assert.equal(
    upload(backend, request.id, id, mutation).attachment.driveFileId,
    attachment.driveFileId,
  );
  assert.equal(
    backend.get({
      action: "fetchAttachment",
      requestId: request.id,
      attachmentId: id,
    }).code,
    "NOT_FOUND",
  );
  request.attachments = [attachment];
  request = save(backend, request).request;
  assert.equal(
    backend.get({
      action: "fetchAttachment",
      requestId: request.id,
      attachmentId: id,
    }).name,
    "quote.pdf",
  );
  const other = save(backend, intakeRequest()).request;
  other.attachments = [attachment];
  assert.equal(save(backend, other).code, "VALIDATION");
  const replacement = upload(backend, request.id).attachment;
  request.attachments = [replacement];
  backend.failWrite();
  assert.equal(save(backend, request).ok, false);
  assert.equal(backend.files.get(attachment.driveFileId).trashed, false);
  assert.equal(
    backend.get({
      action: "fetchAttachment",
      requestId: request.id,
      attachmentId: attachment.id,
    }).ok,
    true,
  );
});
test("uploads validate actual bytes and failed/unlinked files never become record attachments", () => {
  const backend = mockBackend();
  const request = save(backend, intakeRequest()).request;
  const response = backend.post({
    action: "uploadAttachment",
    requestId: request.id,
    attachmentId: randomUUID(),
    mutationId: randomUUID(),
    file: {
      name: "bad.pdf",
      mimeType: "application/pdf",
      kind: "quote",
      size: 3,
      data: Buffer.from("bad").toString("base64"),
    },
  });
  assert.equal(response.code, "VALIDATION");
  assert.equal(
    backend.get({ action: "openRequest", id: request.id }).request.attachments
      .length,
    0,
  );
});
test("backend legacy conversion physically copies PDFs, keeps pricing and preserves original rows/files", () => {
  const backend = mockBackend();
  const old = validDraft();
  const pdf = backend.legacyFile();
  old.source = {
    name: "legacy.pdf",
    pages: 1,
    blob: null,
    driveFileId: pdf.getId(),
  };
  backend.post({ action: "save", draft: old });
  const before = JSON.stringify(backend.sheets.get("Drafts").rows);
  const mutationId = randomUUID();
  const converted = backend.post({
    action: "convertLegacyRequest",
    id: old.id,
    mutationId,
  });
  assert.equal(converted.ok, true);
  assert.notEqual(converted.request.attachments[0].driveFileId, pdf.getId());
  assert.equal(converted.request.pricedItems[0].pricingConfirmed, false);
  assert.equal(
    converted.request.pricedItems[0].requestChangeId,
    converted.request.requestedChanges[0].id,
  );
  assert.equal(JSON.stringify(backend.sheets.get("Drafts").rows), before);
  assert.equal(pdf.trashed, false);
  assert.equal(
    backend.post({ action: "convertLegacyRequest", id: old.id, mutationId })
      .request.id,
    converted.request.id,
  );
});
test("frontend request APIs round-trip through actual mocked Code.gs and surface structured conflicts", async () => {
  const backend = mockBackend();
  const restore = backend.installFetch();
  try {
    const initial = intakeRequest();
    const saved = await saveRequest(initial, 0, randomUUID());
    assert.equal(saved.revision, 1);
    assert.equal((await listRequests())[0].id, saved.id);
    assert.equal((await openRequest(saved.id)).id, saved.id);
    await assert.rejects(
      saveRequest(initial, 0, randomUUID()),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "CONFLICT" &&
        error.currentRevision === 1,
    );
    const bytes = "%PDF-1.4\nquote";
    const attachment = await uploadAttachment(
      saved.id,
      {
        name: "quote.pdf",
        mimeType: "application/pdf",
        kind: "quote",
        size: Buffer.byteLength(bytes),
        data: Buffer.from(bytes).toString("base64"),
      },
      randomUUID(),
      randomUUID(),
    );
    saved.attachments = [attachment];
    const linked = await saveRequest(saved, saved.revision, randomUUID());
    const file = await fetchAttachment(linked.id, attachment.id);
    assert.equal(await file.blob.text(), bytes);
    const submitted = await transitionRequest(
      linked.id,
      linked.revision,
      "submitted",
      "",
      randomUUID(),
    );
    const claimed = await claimRequest(
      submitted.id,
      submitted.revision,
      "Estimator",
      randomUUID(),
    );
    assert.equal(claimed.status, "in_review");
    const legacy = validDraft();
    backend.post({ action: "save", draft: legacy });
    assert.equal(
      (await convertLegacyRequest(legacy.id, randomUUID())).legacyDraftId,
      legacy.id,
    );
  } finally {
    restore();
  }
});

test("bootstrap returns requests, drafts and jobs in one round-trip", () => {
  const backend = mockBackend();
  save(backend, intakeRequest());
  backend.post({ action: "save", draft: validDraft() });
  backend.post({
    action: "importJobs",
    jobs: [
      {
        id: "j1",
        jobNumber: "F-26-0366-R",
        customer: "Sample Customer",
        address: "123 Sample St, Fort Wayne, IN 46808",
        projectManager: "Sample PM",
        estimator: "Sample Estimator",
        status: "Work in Progress",
        customerPhone: "",
        customerEmail: "",
        active: true,
        updatedAt: "",
      },
    ],
  });
  const result = backend.get({ action: "bootstrap" });
  assert.equal(result.ok, true);
  assert.equal(result.requests.length, 1);
  assert.equal(result.drafts.length, 1);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].jobNumber, "F-26-0366-R");
});

test("loadDashboard loads all three lists and falls back when bootstrap is missing", async () => {
  const backend = mockBackend();
  save(backend, intakeRequest());
  backend.post({ action: "save", draft: validDraft() });
  const restore = backend.installFetch();
  try {
    const data = await loadDashboard();
    assert.equal(data.requests.length, 1);
    assert.equal(data.drafts.length, 1);
    assert.deepEqual(data.jobs, []);
  } finally {
    restore();
  }
  // Simulate a pre-bootstrap deployment, then verify the fallback path still
  // returns requests and drafts without the combined endpoint.
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://test.local");
    const action = String(url.searchParams.get("action") ?? "");
    calls.push(action);
    const reply = (obj: unknown) =>
      new Response(JSON.stringify(obj), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (action === "bootstrap") return reply({ ok: false, error: "Unknown action." });
    if (action === "listRequests")
      return reply({
        ok: true,
        requests: [
          {
            id: "r1",
            revision: 1,
            createdAt: "",
            updatedAt: "",
            status: "draft",
            estimatorName: "",
            changesCount: 0,
            attachmentsCount: 0,
            job: {
              customer: "Fallback",
              jobNumber: "",
              projectManager: "",
              orderNumber: "",
              address: "",
            },
          },
        ],
      });
    if (action === "list")
      return reply({
        ok: true,
        drafts: [
          {
            id: "d1",
            revision: 1,
            createdAt: "",
            updatedAt: "",
            step: 0,
            customer: "Fallback",
            jobNumber: "",
            orderNumber: "",
            changesCount: 0,
            sourceName: "",
            hasSource: false,
          },
        ],
      });
    if (action === "listJobs") return reply({ ok: false, error: "Unknown action." });
    return reply({ ok: false, error: "Unknown action." });
  }) as typeof fetch;
  try {
    const data = await loadDashboard();
    assert.equal(data.requests[0].job.customer, "Fallback");
    assert.equal(data.drafts[0].job.customer, "Fallback");
    assert.deepEqual(data.jobs, []);
    assert.ok(calls.includes("bootstrap"));
    assert.ok(calls.includes("listRequests"));
    assert.ok(calls.includes("list"));
    assert.ok(calls.includes("listJobs"));
  } finally {
    globalThis.fetch = original;
  }
});
