import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * TEMPORARY verification harness for src/components/SimpleRequest.tsx.
 * Deleted after the run; not part of the deliverable.
 */
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

const JOBS = [
  {
    id: "job-1",
    jobNumber: "J-1001",
    customer: "Ada Homes",
    address: "12 Oak Street, Fort Wayne, IN",
    projectManager: "Dana Reyes",
    estimator: "Sam",
    status: "Active",
    customerPhone: "",
    customerEmail: "",
    contractAmount: "167045.81",
    active: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "job-2",
    jobNumber: "J-1002",
    customer: "Baker Trust",
    address: "9 Elm Ave",
    projectManager: "Kim Lee",
    estimator: "Sam",
    status: "Active",
    customerPhone: "",
    customerEmail: "",
    contractAmount: "",
    active: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "job-3",
    jobNumber: "J-0900",
    customer: "Closed Job",
    address: "1 Old Road",
    projectManager: "Nobody",
    estimator: "Sam",
    status: "Closed",
    customerPhone: "",
    customerEmail: "",
    contractAmount: "",
    active: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

interface Call {
  action: string;
  body: Record<string, any>;
}

const calls: Call[] = [];
let failNextUpload = false;
let bootstrapJobs: unknown[] = JOBS;

async function installMockApi(page: Page) {
  await page.route(apiRoute, async (route: Route) => {
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
    calls.push({ action, body });
    const respond = (obj: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });
    if (action === "bootstrap")
      return respond({
        ok: true,
        requests: [],
        drafts: [],
        jobs: bootstrapJobs,
      });
    if (action === "saveRequest") {
      const saved = body.request ?? {};
      return respond({
        ok: true,
        request: {
          ...saved,
          revision: Number(saved.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        },
      });
    }
    if (action === "uploadAttachment") {
      if (failNextUpload) {
        failNextUpload = false;
        return respond({ ok: false, error: "Upload failed. Try again." });
      }
      return respond({
        ok: true,
        attachment: {
          id: body.attachmentId,
          kind: body.file?.kind,
          name: body.file?.name,
          mimeType: body.file?.mimeType,
          size: body.file?.size,
          driveFileId: "drive-1",
        },
      });
    }
    if (action === "transitionRequest") {
      return respond({
        ok: true,
        request: {
          id: body.id,
          revision: Number(body.expectedRevision ?? 0) + 1,
          status: body.status,
        },
      });
    }
    return respond({ ok: true });
  });
}

test.beforeEach(async ({ page }) => {
  calls.length = 0;
  failNextUpload = false;
  bootstrapJobs = JOBS;
  await installMockApi(page);
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AL+2gAAAABJRU5ErkJggg==",
  "base64",
);

async function addPhoto(page: Page) {
  await page
    .locator('input[type="file"][accept="image/*"]')
    .setInputFiles({ name: "site.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator('img[alt="Photo 1"]')).toBeVisible();
}

test("directory menu lists active jobs and fills the summary", async ({
  page,
}) => {
  await page.goto("/#/simple");
  await expect(page.locator(".sr-head h1")).toHaveText("Quick request");

  const options = page.locator(".sr-select option");
  await expect(options).toHaveCount(3);
  await expect(options.nth(1)).toHaveText("Ada Homes — J-1001");
  await expect(page.locator(".sr-select")).not.toContainText("Closed Job");

  await page.locator(".sr-select").selectOption("job-2");
  const summary = page.locator(".sr-summary");
  await expect(summary).toContainText("Baker Trust");
  await expect(summary).toContainText("J-1002");
  await expect(summary).toContainText("9 Elm Ave");
  await expect(summary).toContainText("Kim Lee");
});

test("empty directory falls back to a typed customer and hides the mic", async ({
  page,
}) => {
  bootstrapJobs = [];
  await page.goto("/#/simple");
  await expect(page.locator(".sr-select")).toHaveCount(0);
  await expect(page.getByLabel("Customer / project owner")).toBeVisible();
  await expect(page.locator(".sr-mic")).toHaveCount(0);
  await expect(page.locator(".simple-request")).toContainText(
    "Voice input is not available in this browser — type your note instead.",
  );
});

test("validation blocks the send with inline errors and no request", async ({
  page,
}) => {
  await page.goto("/#/simple");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(
    page.getByText("Choose a customer from the list."),
  ).toBeVisible();
  await expect(
    page.getByText("Add a note or at least one photo before sending."),
  ).toBeVisible();
  expect(calls.filter((call) => call.action === "saveRequest")).toHaveLength(0);

  // Choosing a customer alone still leaves the note/photo requirement.
  await page.locator(".sr-select").selectOption("job-1");
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(
    page.getByText("Choose a customer from the list."),
  ).toHaveCount(0);
  await expect(
    page.getByText("Add a note or at least one photo before sending."),
  ).toBeVisible();
  expect(calls.filter((call) => call.action === "saveRequest")).toHaveLength(0);
});

test("submit saves, uploads the photo and PDF, then submits", async ({
  page,
}) => {
  await page.goto("/#/simple");
  await page.locator(".sr-select").selectOption("job-1");
  await page.getByLabel("What changed?").fill("Added insulation to the wall.");
  await addPhoto(page);
  await page
    .locator('input[type="file"][accept="application/pdf,.pdf"]')
    .setInputFiles({
      name: "quote.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 test"),
    });
  await expect(page.locator(".sr-file-name")).toHaveText("quote.pdf");

  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.locator(".sr-submit .sr-error")).toHaveCount(0);

  const order = calls.map((call) => call.action);
  expect(order).toEqual([
    "bootstrap",
    "saveRequest",
    "uploadAttachment",
    "uploadAttachment",
    "transitionRequest",
  ]);

  const saved = calls[1].body;
  expect(saved.expectedRevision).toBe(0);
  expect(saved.request.job.customer).toBe("Ada Homes");
  expect(saved.request.job.jobNumber).toBe("J-1001");
  expect(saved.request.job.address).toBe("12 Oak Street, Fort Wayne, IN");
  expect(saved.request.job.projectManager).toBe("Dana Reyes");
  expect(saved.request.job.originalContract).toBe("167045.81");
  expect(saved.request.jobDirectoryId).toBe("job-1");
  expect(saved.request.requestedChanges).toHaveLength(1);
  expect(saved.request.requestedChanges[0]).toMatchObject({
    description: "Added insulation to the wall.",
    room: "",
    action: "add",
  });
  expect(saved.request.id).toBeTruthy();

  const photoUpload = calls[2].body;
  expect(photoUpload.requestId).toBe(saved.request.id);
  expect(photoUpload.file.kind).toBe("photo");
  expect(photoUpload.file.name).toBe("site.png");
  expect(photoUpload.file.mimeType).toBe("image/png");
  expect(photoUpload.file.data.length).toBeGreaterThan(10);

  const pdfUpload = calls[3].body;
  expect(pdfUpload.file.kind).toBe("document");
  expect(pdfUpload.file.name).toBe("quote.pdf");
  expect(pdfUpload.file.mimeType).toBe("application/pdf");

  const transition = calls[4].body;
  expect(transition.id).toBe(saved.request.id);
  expect(transition.status).toBe("submitted");
  expect(transition.question).toBe("");

  // onDone drops the PM back on the dashboard with the confirmation.
  await expect(page.locator(".home")).toContainText(
    "Sent to estimating: Ada Homes · job J-1001.",
  );
});

test("a failed upload retries the same request instead of a duplicate", async ({
  page,
}) => {
  await page.goto("/#/simple");
  await page.locator(".sr-select").selectOption("job-2");
  await page.getByLabel("What changed?").fill("Replace the damaged siding.");
  await addPhoto(page);

  failNextUpload = true;
  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.locator(".sr-submit .sr-error")).toHaveText(
    "Upload failed. Try again.",
  );
  await expect(
    page.getByRole("button", { name: "Send to estimating" }),
  ).toBeEnabled();

  await page.getByRole("button", { name: "Send to estimating" }).click();
  await expect(page.locator(".home")).toContainText(
    "Sent to estimating: Baker Trust · job J-1002.",
  );

  const saves = calls.filter((call) => call.action === "saveRequest");
  expect(saves).toHaveLength(2);
  expect(saves[1].body.request.id).toBe(saves[0].body.request.id);
  expect(saves[0].body.expectedRevision).toBe(0);
  expect(saves[1].body.expectedRevision).toBe(1);
  expect(
    calls.filter((call) => call.action === "transitionRequest"),
  ).toHaveLength(1);
});

test("voice appends final speech, shows interim text, and reports errors", async ({
  page,
}) => {
  await page.addInitScript(`
    (() => {
      class FakeRecognition {
        constructor() {
          window.__fake = this;
          window.__settings = null;
        }
        start() {
          window.__settings = {
            continuous: this.continuous,
            interimResults: this.interimResults,
            lang: this.lang,
          };
        }
        stop() { if (this.onend) this.onend(); }
        abort() { if (this.onend) this.onend(); }
      }
      window.SpeechRecognition = FakeRecognition;
      window.__emit = (finalText, interimText) => {
        const instance = window.__fake;
        if (!instance || !instance.onresult) return;
        const results = [
          Object.assign([{ transcript: finalText }], { isFinal: true, length: 1 }),
          Object.assign([{ transcript: interimText }], { isFinal: false, length: 1 }),
        ];
        instance.onresult({ resultIndex: 0, results });
      };
      window.__failVoice = (code) => {
        const instance = window.__fake;
        if (instance && instance.onerror) instance.onerror({ error: code });
      };
    })();
  `);
  await page.goto("/#/simple");
  await expect(page.getByLabel("What changed?")).toBeVisible();
  await page.getByLabel("What changed?").fill("Existing note.");

  await page.getByRole("button", { name: "Speak the note" }).click();
  await expect(page.getByRole("button", { name: "Stop listening" })).toBeVisible();
  await expect(page.locator(".sr-listening")).toContainText("Listening…");
  expect(
    await page.evaluate("window.__settings"),
  ).toEqual({ continuous: true, interimResults: true, lang: "en-US" });

  await page.evaluate("window.__emit(' First part', ' second part')");
  await expect(page.getByLabel("What changed?")).toHaveValue(
    "Existing note. First part",
  );
  await expect(page.locator(".sr-listening")).toContainText("second part");

  await page.evaluate("window.__failVoice('not-allowed')");
  await expect(
    page.getByText(
      "Microphone access is blocked. Allow the microphone for this site, or type the note.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Speak the note" })).toBeVisible();
  // Typed text survives the voice failure.
  await expect(page.getByLabel("What changed?")).toHaveValue(
    "Existing note. First part",
  );

  await page.getByRole("button", { name: "Speak the note" }).click();
  await page.evaluate("window.__failVoice('network')");
  await expect(
    page.getByText(
      "Voice input lost its network connection — type the note instead.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Speak the note" }).click();
  await page.getByRole("button", { name: "Stop listening" }).click();
  await expect(page.getByRole("button", { name: "Speak the note" })).toBeVisible();
});
