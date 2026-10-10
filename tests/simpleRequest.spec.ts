import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

/**
 * The quick request tab is the project manager's phone-first intake: pick the
 * customer, shoot or choose photos, annotate them, dictate a note, and send.
 * These tests pin that path against the same mocked Apps Script the rest of the
 * browser suite uses.
 */
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

const jobs = [
  {
    id: "job-1",
    jobNumber: "F-26-0366-P",
    customer: "York Ridge Apartments",
    address: "1200 York St, Fort Wayne, IN 46802",
    projectManager: "Dana Whitfield",
    estimator: "QA Estimator",
    status: "Active",
    customerPhone: "260-555-0144",
    customerEmail: "dana@example.com",
    contractAmount: "167045.81",
    active: true,
    updatedAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "job-2",
    jobNumber: "F-26-0401-P",
    customer: "Maple Court Duplex",
    address: "88 Maple Ct, Fort Wayne, IN 46805",
    projectManager: "Ray Alvarez",
    estimator: "QA Estimator",
    status: "Active",
    customerPhone: "260-555-0177",
    customerEmail: "ray@example.com",
    contractAmount: "84210.00",
    active: true,
    updatedAt: "2026-10-02T12:00:00.000Z",
  },
];

interface MockApi {
  /** Every action the app asked the Apps Script backend to perform, in order. */
  actions: string[];
  /** The request payloads the app saved, so the test can assert the intake. */
  saved: Record<string, any>[];
  /** Base64 payload lengths per uploaded attachment kind. */
  uploads: { kind: string; name: string; bytes: number }[];
  transitions: { status: string }[];
}

async function installMockApi(page: Page): Promise<MockApi> {
  const requests = new Map<string, any>();
  const api: MockApi = {
    actions: [],
    saved: [],
    uploads: [],
    transitions: [],
  };
  const summarize = (r: any) => ({
    id: r.id,
    revision: r.revision,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    status: r.status,
    estimatorName: r.estimatorName,
    changesCount: r.requestedChanges.length,
    attachmentsCount: r.attachments.length,
    job: {
      customer: r.job.customer,
      jobNumber: r.job.jobNumber,
      projectManager: r.job.projectManager,
      orderNumber: r.job.orderNumber,
      address: r.job.address,
    },
  });
  const commit = (request: any) => {
    const previous = requests.get(request.id);
    const next = {
      ...request,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    requests.set(next.id, next);
    return next;
  };
  await page.route(apiRoute, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let action = url.searchParams.get("action") ?? "";
    let body: Record<string, any> = {};
    if (request.method() === "POST") {
      try {
        body = JSON.parse(request.postData() ?? "{}");
      } catch {
        body = {};
      }
      action = String(body.action ?? action);
    }
    api.actions.push(action);
    const respond = (obj: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });
    const id = url.searchParams.get("id") ?? body.id;
    switch (action) {
      case "bootstrap":
        return respond({
          ok: true,
          requests: [...requests.values()].map(summarize),
          drafts: [],
          jobs,
        });
      case "listRequests":
        return respond({
          ok: true,
          requests: [...requests.values()].map(summarize),
        });
      case "listDrafts":
      case "list":
        return respond({ ok: true, drafts: [] });
      case "listJobs":
        return respond({ ok: true, jobs });
      case "saveRequest":
        api.saved.push(body.request);
        return respond({ ok: true, request: commit(body.request) });
      case "openRequest":
        return respond({ ok: true, request: requests.get(id) });
      case "uploadAttachment": {
        const file = body.file ?? {};
        api.uploads.push({
          kind: String(file.kind ?? ""),
          name: String(file.name ?? ""),
          bytes: String(file.data ?? "").length,
        });
        return respond({
          ok: true,
          attachment: {
            id: body.attachmentId,
            kind: file.kind,
            name: file.name,
            mimeType: file.mimeType,
            size: file.size,
            driveFileId: `drive-${body.attachmentId}`,
          },
        });
      }
      case "transitionRequest": {
        api.transitions.push({ status: String(body.status) });
        const current = requests.get(id);
        return respond({
          ok: true,
          request: commit({ ...current, status: body.status }),
        });
      }
      default:
        return respond({ ok: true });
    }
  });
  return api;
}

test("the quick request tab opens from the header and survives a reload", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Quick request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/simple");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
});

test("voice input degrades to typing when the browser has no speech API", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/#/simple");
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/voice input is not available/i)).toBeVisible();
});
