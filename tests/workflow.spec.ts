import { test, expect, type Page } from "@playwright/test";

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
  await page.getByRole("button", { name: "Preview" }).first().click();
  await expect(
    page.getByRole("dialog", { name: "photo1.jpg" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close preview" }).click();

  // Download the PDF; the browser receives the file under its stored name.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).last().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("note.pdf");
});
