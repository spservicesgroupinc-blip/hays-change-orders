import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.js";

/**
 * The review page is where an estimator receives a quick request: they read
 * the intake, download the photos and files, start work, and mark the order
 * complete once it is finished outside the app. These tests pin that flow.
 */
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

const baseRequest = {
  id: "r1",
  revision: 1,
  createdAt: "",
  updatedAt: "2026-10-01T12:00:00.000Z",
  status: "submitted",
  estimatorName: "",
  submittedAt: "2026-10-01T12:00:00.000Z",
  informationQuestion: "",
  job: {
    customer: "York Ridge Apartments",
    customerPhone: "260-555-0144",
    customerEmail: "dana@example.com",
    address: "1200 York St, Fort Wayne, IN 46802",
    jobNumber: "F-26-0366-P",
    projectManager: "Dana Whitfield",
    branchName: "Hays + Sons Complete Restoration",
    branchAddress: "909 Production Road, Fort Wayne, IN 46808",
    branchPhone: "1-260-471-9110",
    branchContact: "",
    carrier: "",
    claim: "",
    orderNumber: "CO-01",
    date: "2026-10-01",
    insuranceRelated: true,
    originalContract: "167045.81",
    previousChanges: "0.00",
    addedDays: "0",
  },
  requestedChanges: [
    {
      id: "c1",
      room: "",
      action: "add",
      description: "Wet insulation behind the kitchen wall",
      reason: "",
      measurements: "",
      materials: "",
      scheduleImpact: "",
    },
  ],
  attachments: [
    {
      id: "a1",
      kind: "photo",
      name: "photo1.jpg",
      mimeType: "image/jpeg",
      size: 128,
      driveFileId: "drive-a1",
    },
    {
      id: "a2",
      kind: "document",
      name: "note.pdf",
      mimeType: "application/pdf",
      size: 64,
      driveFileId: "drive-a2",
    },
  ],
};

function summarize(r: any) {
  return {
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
  };
}

async function installMockApi(
  page: Page,
  overrides: Record<string, any> = {},
  failures: { save?: string; upload?: boolean } = {},
): Promise<{ requests: Map<string, any>; actions: string[] }> {
  const requests = new Map<string, any>();
  const seed = { ...structuredClone(baseRequest), ...overrides };
  requests.set(seed.id, seed);
  const actions: string[] = [];
  const commit = (next: any) => {
    const previous = requests.get(next.id);
    const updated = {
      ...next,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    requests.set(updated.id, updated);
    return updated;
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
    actions.push(action);
    const respond = (obj: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });
    const id = url.searchParams.get("id") ?? body.id;
    const current = requests.get(id);
    switch (action) {
      case "bootstrap":
      case "listRequests":
        return respond({
          ok: true,
          requests: [...requests.values()].map(summarize),
          jobs: [],
        });
      case "listJobs":
        return respond({ ok: true, jobs: [] });
      case "openRequest":
        return respond({ ok: true, request: current });
      case "saveRequest": {
        if (failures.save) {
          const code = failures.save;
          delete failures.save;
          return respond({ ok: false, code, error: code === "CONFLICT" ? "A newer revision exists." : "Save failed. Retry." });
        }
        const saved = commit(body.request);
        return respond({ ok: true, request: saved });
      }
      case "claimRequest":
        return respond({
          ok: true,
          request: commit({
            ...current,
            estimatorName: String(body.estimatorName ?? ""),
            status: "in_review",
          }),
        });
      case "transitionRequest": {
        const target = String(body.status ?? "");
        const status =
          target === "submitted" && current?.estimatorName
            ? "in_review"
            : target;
        return respond({
          ok: true,
          request: commit({
            ...current,
            status,
            informationQuestion:
              target === "needs_information"
                ? String(body.question ?? "")
                : "",
          }),
        });
      }
      case "fetchAttachment": {
        const current = requests.get(url.searchParams.get("requestId") ?? "");
        const attachment = current?.attachments?.find(
          (item: any) => item.id === url.searchParams.get("attachmentId"),
        );
        const data =
          attachment?.mimeType === "application/pdf" ? "%PDF-1.4\n" : "fakejpg";
        return respond({
          ok: true,
          name: attachment?.name ?? "file",
          mimeType: attachment?.mimeType ?? "application/octet-stream",
          data: Buffer.from(data).toString("base64"),
        });
      }
      default:
        return respond({ ok: true });
    }
  });
  return { requests, actions };
}

test("an estimator reviews, starts work, and marks the request complete", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/#/requests/r1");

  await expect(
    page.getByRole("heading", { name: "In queue", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Wet insulation behind the kitchen wall")).toBeVisible();

  await page.getByLabel("Estimator name").fill("Jamie Estimator");
  await page.getByRole("button", { name: "Start work" }).click();

  await expect(
    page.getByRole("heading", { name: "Estimator review", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark complete" }).click();

  await expect(
    page.getByText(
      "This change order is finished and kept in the log for reference.",
    ),
  ).toBeVisible();
});

test("an estimator can send a request back for information and the PM responds", async ({
  page,
}) => {
  await installMockApi(page, { status: "in_review", estimatorName: "Jamie Estimator" });
  await page.goto("/#/requests/r1");

  await page.getByRole("button", { name: "Request more information" }).click();
  await page
    .getByLabel("Information request")
    .fill("What is the exact square footage?");
  await page.getByRole("button", { name: "Send request" }).click();

  await expect(
    page.getByRole("heading", { name: "More information needed", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("What is the exact square footage?")).toBeVisible();

  await page.getByLabel("Response").fill("The affected area is 120 square feet.");
  await page.getByRole("button", { name: "Send response" }).click();

  // The response lands back with the estimator who asked for it.
  await expect(
    page.getByRole("heading", { name: "Estimator review", exact: true }),
  ).toBeVisible();
});

test("the review page previews a photo and downloads an attachment", async ({
  page,
}) => {
  await installMockApi(page);
  await page.goto("/#/requests/r1");

  // Preview the photo in the shared modal.
  await page.getByRole("button", { name: "Preview photo1.jpg", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "photo1.jpg" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();

  // Download the PDF; the browser receives the file under its stored name.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download note.pdf", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("note.pdf");
});

test("edit details and separate notes, then download the saved summary PDF", async ({ page }) => {
  const api = await installMockApi(page, {
    requestedChanges: [...structuredClone(baseRequest.requestedChanges), {
      ...structuredClone(baseRequest.requestedChanges[0]), id: "c2", room: "Bathroom",
      description: "Second change", measurements: "12 square feet", reason: "Hidden damage",
    }],
  });
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download summary PDF" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start work", exact: true })).toBeDisabled();
  await page.getByLabel("Customer name", { exact: true }).fill("José Customer");
  await page.getByLabel("Previous authorized changes", { exact: true }).fill("1250.19");
  await page.getByLabel("Description 1", { exact: true }).fill("Corrected kitchen note\nKeep this paragraph.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit request", exact: true })).toBeVisible();
  expect(api.requests.get("r1").requestedChanges[1].measurements).toBe("12 square feet");
  expect(api.requests.get("r1").status).toBe("submitted");
  await expect(page.getByText("$168,296.00", { exact: true })).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download summary PDF" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("request-summary-F-26-0366-P.pdf");
  const bytes = await readFile((await download.path())!);
  const pdf = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map((item: any) => item.str).join(" ");
  for (const expected of ["José Customer", "260-555-0144", "dana@example.com", "$168,296.00", "Corrected kitchen note", "Keep this paragraph", "Second change", "12 square feet", "photo1.jpg", "note.pdf"]) expect(text).toContain(expected);
  await pdf.destroy();
});

test("failed edits retain text, retry, and completed requests stay read only", async ({ page }) => {
  await installMockApi(page, { status: "in_review", estimatorName: "Jamie Estimator" }, { save: "SERVICE_ERROR" });
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page.getByLabel("Description 1", { exact: true }).fill("Keep my edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Save failed");
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue("Keep my edit");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByText("Keep my edit", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit request", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download summary PDF" })).toBeEnabled();
});

test("unsaved edits warn on Cancel, app navigation, and browser back", async ({ page }) => {
  await installMockApi(page);
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page.getByLabel("Description 1", { exact: true }).fill("Unsaved correction");
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue("Unsaved correction");
  await page.getByRole("button", { name: "Back to requests", exact: true }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue("Unsaved correction");
  await page.goBack();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue("Unsaved correction");
  await expect(page).toHaveURL(/#\/requests\/r1$/);
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Wet insulation behind the kitchen wall", { exact: true })).toBeVisible();
});

test("conflicting edits retain the draft and offer reload without a blind retry", async ({ page }) => {
  await installMockApi(page, {}, { save: "CONFLICT" });
  await page.goto("/#/requests/r1");
  await page.getByRole("button", { name: "Edit request", exact: true }).click();
  await page.getByLabel("Description 1", { exact: true }).fill("Conflicting edit");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue("Conflicting edit");
  await expect(page.getByRole("button", { name: "Reload latest request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
});
