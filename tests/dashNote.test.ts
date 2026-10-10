import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequest, createRequestedChange } from "../src/services/requests";
import { formatDashNote } from "../src/services/dashNote";
import type { ChangeRequest, RequestedChange } from "../src/types";

const ISO = "2026-10-10T12:00:00.000Z";
const DATE = new Date(ISO).toLocaleDateString("en-US");

function makeRequest(changes: Partial<RequestedChange>[]): ChangeRequest {
  const base = createRequest();
  return {
    ...base,
    createdAt: ISO,
    updatedAt: ISO,
    job: {
      ...base.job,
      customer: "York Tori",
      address: "1825 Sprunger St., Fort Wayne, IN 46808",
      jobNumber: "F-26-0366-R",
      projectManager: "Lance Stanley",
      orderNumber: "",
    },
    requestedChanges: changes.map((change) => ({
      ...createRequestedChange(),
      ...change,
    })),
  };
}

test("the Dash note lists the job, then every requested change", () => {
  const note = formatDashNote(
    makeRequest([
      {
        room: "Bathroom",
        action: "add",
        description: "Install two exhaust fans (bathroom fans)",
      },
      {
        room: "Kitchen",
        action: "revise",
        description: "Replace damaged countertop",
      },
    ]),
  );
  assert.equal(
    note,
    [
      "Change order requested — York Tori (F-26-0366-R)",
      "PM: Lance Stanley",
      "Address: 1825 Sprunger St., Fort Wayne, IN 46808",
      "",
      "- Bathroom — add: Install two exhaust fans (bathroom fans)",
      "- Kitchen — revise: Replace damaged countertop",
      "",
      `2 changes · Created ${DATE} · Estimator: unassigned`,
    ].join("\n"),
  );
});

test("the footer follows the status and empty fields are skipped", () => {
  const base = makeRequest([
    { room: "", action: "remove", description: "Remove the\n  damaged vanity" },
  ]);
  const note = formatDashNote({
    ...base,
    status: "ready",
    estimatorName: "QA Estimator",
    submittedAt: ISO,
    job: { ...base.job, address: "", orderNumber: "CO-02" },
  });
  assert.equal(
    note,
    [
      "Change order requested — York Tori (F-26-0366-R)",
      "PM: Lance Stanley",
      "Change order #: CO-02",
      "",
      "- remove: Remove the damaged vanity",
      "",
      `1 change · Ready for customer ${DATE} · Estimator: QA Estimator`,
    ].join("\n"),
  );
});

test("a change order with no scope yet still produces a note", () => {
  const note = formatDashNote(makeRequest([]));
  assert.match(note, /- No changes described yet\./);
  assert.match(note, /^0 changes · Created /m);
});
