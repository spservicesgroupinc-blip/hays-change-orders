import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

/**
 * The quick request tab is the project manager's phone-first intake: pick the
 * customer, shoot or choose photos, mark them up, dictate a note, and send.
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

interface UploadCall {
  kind: string;
  name: string;
  bytes: number;
  attachmentId: string;
  mutationId: string;
  failed: boolean;
}

interface MockApi {
  /** Every action the app asked the Apps Script backend to perform, in order. */
  actions: string[];
  /** The request payloads the app saved, so the test can assert the intake. */
  saved: Record<string, any>[];
  /** One row per upload attempt, including the ones that failed. */
  uploads: UploadCall[];
  transitions: { status: string; id: string; expectedRevision: number }[];
  /** Arm this to make the next attachment upload answer with an error. */
  failNextUpload: boolean;
}

async function installMockApi(
  page: Page,
  directory: typeof jobs = jobs,
): Promise<MockApi> {
  const requests = new Map<string, any>();
  // Files the upload endpoint is holding, keyed the way the Apps Script does.
  const uploadedFiles = new Map<
    string,
    { mutationId: string; attachment: Record<string, unknown> }
  >();
  const api: MockApi = {
    actions: [],
    saved: [],
    uploads: [],
    transitions: [],
    failNextUpload: false,
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
          jobs: directory,
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
        return respond({ ok: true, jobs: directory });
      case "saveRequest":
        api.saved.push(body.request);
        return respond({ ok: true, request: commit(body.request) });
      case "openRequest":
        return respond({ ok: true, request: requests.get(id) });
      case "uploadAttachment": {
        const file = body.file ?? {};
        const call: UploadCall = {
          kind: String(file.kind ?? ""),
          name: String(file.name ?? ""),
          bytes: String(file.data ?? "").length,
          attachmentId: String(body.attachmentId ?? ""),
          mutationId: String(body.mutationId ?? ""),
          failed: false,
        };
        if (api.failNextUpload) {
          api.failNextUpload = false;
          call.failed = true;
          api.uploads.push(call);
          return respond({ ok: false, error: "Upload failed. Try again." });
        }
        api.uploads.push(call);
        // Mirrors the Apps Script endpoint: the same (attachmentId, mutationId)
        // pair returns the file already stored instead of adding another copy.
        const stored = uploadedFiles.get(call.attachmentId);
        const attachment: Record<string, unknown> =
          stored && stored.mutationId === call.mutationId
            ? stored.attachment
            : {
                id: call.attachmentId,
                kind: file.kind,
                name: file.name,
                mimeType: file.mimeType,
                size: file.size,
                driveFileId: `drive-${call.attachmentId}`,
              };
        uploadedFiles.set(call.attachmentId, {
          mutationId: call.mutationId,
          attachment,
        });
        return respond({ ok: true, attachment });
      }
      case "transitionRequest": {
        api.transitions.push({
          status: String(body.status),
          id: String(body.id ?? ""),
          expectedRevision: Number(body.expectedRevision ?? 0),
        });
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
  // Chromium exposes the constructor even when no speech service is reachable,
  // so remove both spellings to model a browser that genuinely cannot listen.
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      configurable: true,
    });
  });
  await page.goto("/#/simple");
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sr-mic")).toHaveCount(0);
  await expect(page.getByText(/voice input is not available/i)).toBeVisible();
});

test("a spoken note is appended to whatever the PM already typed", async ({
  page,
}) => {
  await installMockApi(page);
  // Headless Chromium has no Speech Recognition, so stand one in that delivers a
  // single final transcript the moment recording starts.
  await page.addInitScript(() => {
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        const scope = window as unknown as { __speechStarts?: number };
        scope.__speechStarts = (scope.__speechStarts ?? 0) + 1;
        this.onresult?.({
          resultIndex: 0,
          results: [
            Object.assign([{ transcript: "Insulation is wet" }], {
              isFinal: true,
            }),
          ],
        });
      }
      stop() {}
      abort() {}
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
      FakeRecognition;
  });
  await page.goto("/#/simple");
  const note = page.getByLabel("What changed?", { exact: true });
  await note.fill("Kitchen wall");
  await page.getByRole("button", { name: "Speak the note" }).click();
  await expect(note).toHaveValue("Kitchen wall Insulation is wet");
  await expect(
    page.getByRole("button", { name: "Stop listening" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => (window as unknown as { __speechStarts?: number }).__speechStarts,
    ),
  ).toBe(1);
});

test("an empty quick request is refused with a specific reason", async ({
  page,
}) => {
  const api = await installMockApi(page);
  await page.goto("/#/simple");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(
    page.getByText("Choose a customer from the list."),
  ).toBeVisible();

  await page.getByLabel("Customer", { exact: true }).selectOption("job-2");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(
    page.getByText("Add a note or at least one photo before sending."),
  ).toBeVisible();
  expect(api.actions).not.toContain("saveRequest");
});

test("a project manager sends a text-only quick request", async ({ page }) => {
  const api = await installMockApi(page);
  await page.goto("/#/simple");
  await page.getByLabel("Customer", { exact: true }).selectOption("job-1");
  await expect(page.locator(".sr-summary")).toContainText("F-26-0366-P");
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Added insulation to the open kitchen wall");
  await page.getByRole("button", { name: "Send to estimating" }).click();

  // Back on the dashboard with the confirmation the quick form handed over.
  await expect(page.getByText(/Sent to estimating/)).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/");
  await expect(page.locator(".request-row")).toContainText(
    "York Ridge Apartments",
  );

  expect(api.saved).toHaveLength(1);
  expect(api.saved[0].status).toBe("draft");
  expect(api.saved[0].job).toMatchObject({
    customer: "York Ridge Apartments",
    jobNumber: "F-26-0366-P",
    address: "1200 York St, Fort Wayne, IN 46802",
    projectManager: "Dana Whitfield",
    originalContract: "167045.81",
  });
  expect(api.saved[0].jobDirectoryId).toBe("job-1");
  expect(api.saved[0].requestedChanges).toHaveLength(1);
  expect(api.saved[0].requestedChanges[0].description).toBe(
    "Added insulation to the open kitchen wall",
  );
  // A text-only request saves once and submits on the revision it just got.
  expect(api.actions.filter((action) => action !== "bootstrap")).toEqual([
    "saveRequest",
    "transitionRequest",
  ]);
  expect(api.transitions).toHaveLength(1);
  expect(api.transitions[0]).toMatchObject({
    status: "submitted",
    id: api.saved[0].id,
    expectedRevision: 1,
  });
});

test("a photo is marked up before it is sent, with an optional PDF", async ({
  page,
}) => {
  const api = await installMockApi(page);
  await page.goto("/#/simple");
  await page.getByLabel("Customer", { exact: true }).selectOption("job-1");
  await page
    .locator('input[type="file"][accept="image/*"]')
    .setInputFiles(resolve("tmp/fixtures/photo-800x600.png"));
  await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();

  await page.getByRole("button", { name: "Edit photo 1" }).click();
  const editor = page.getByRole("dialog", { name: "Annotate photo" });
  await expect(editor).toBeVisible();
  const canvas = page.locator("canvas.photo-annotator-canvas");
  // The canvas only has a usable box once the photo has decoded.
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeGreaterThan(80);
  await page.getByRole("button", { name: "Arrow tool" }).click();
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, {
      steps: 8,
    });
    await page.mouse.up();
  }
  await page.getByRole("button", { name: "Save annotated photo" }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByText("Marked up")).toBeVisible();

  await page
    .locator('input[type="file"][accept="application/pdf,.pdf"]')
    .setInputFiles(resolve("tmp/fixtures/no-text.pdf"));
  await expect(page.locator(".sr-file-name")).toContainText("no-text.pdf");

  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Kitchen wall is wet");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.getByText(/Sent to estimating/)).toBeVisible();

  // The annotated JPEG is uploaded first, then the PDF as a plain document —
  // never as an "estimate", which would trigger extraction.
  expect(api.uploads.map((upload) => upload.kind)).toEqual([
    "photo",
    "document",
  ]);
  expect(api.uploads[0].bytes).toBeGreaterThan(1000);
  expect(api.uploads[1].name).toBe("no-text.pdf");
  // The upload endpoint stores files in Drive but never edits the request, so
  // the returned rows must be saved onto the request before the submit lands.
  expect(api.actions.filter((action) => action !== "bootstrap")).toEqual([
    "saveRequest",
    "uploadAttachment",
    "uploadAttachment",
    "saveRequest",
    "transitionRequest",
  ]);
  expect(api.saved).toHaveLength(2);
  expect(api.saved[0].attachments).toHaveLength(0);
  expect(api.saved[1].attachments.map((row: any) => row.kind)).toEqual([
    "photo",
    "document",
  ]);
  expect(api.transitions).toHaveLength(1);
  expect(api.transitions[0]).toMatchObject({
    status: "submitted",
    id: api.saved[1].id,
    expectedRevision: 2,
  });
});

test("the customer menu falls back to a typed name when the directory is empty", async ({
  page,
}) => {
  await installMockApi(page, []);
  await page.goto("/#/simple");
  await expect(page.locator(".sr-select")).toHaveCount(0);
  await page.getByLabel("Customer / project owner").fill("Walk-in customer");
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Replace the damaged siding");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.locator(".notice.success")).toContainText(
    "Sent to estimating: Walk-in customer.",
  );
});

test("a failed upload is retried on the same request, never a duplicate", async ({
  page,
}) => {
  const api = await installMockApi(page);
  await page.goto("/#/simple");
  await page.getByLabel("Customer", { exact: true }).selectOption("job-2");
  await page
    .getByLabel("What changed?", { exact: true })
    .fill("Replace the damaged siding");
  await page
    .locator('input[type="file"][accept="image/*"]')
    .setInputFiles(resolve("tmp/fixtures/photo-800x600.png"));
  await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();

  api.failNextUpload = true;
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.getByText("Upload failed. Try again.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send to estimating" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.getByText(/Sent to estimating/)).toBeVisible();

  // The retry saved the same request again instead of creating a second one,
  // and the transition still happened exactly once.
  expect(api.saved).toHaveLength(3);
  expect(new Set(api.saved.map((request) => request.id)).size).toBe(1);
  expect(api.saved[2].attachments).toHaveLength(1);
  expect(api.transitions).toHaveLength(1);
  // The failed attempt's upload identity is reused, so the endpoint returns the
  // file it already holds instead of storing a second copy of the photo.
  expect(api.uploads.map((upload) => upload.failed)).toEqual([true, false]);
  expect(api.uploads[0].attachmentId).toBe(api.uploads[1].attachmentId);
  expect(api.uploads[0].mutationId).toBe(api.uploads[1].mutationId);
});
