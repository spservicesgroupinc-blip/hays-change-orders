import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
// Cover both the local endpoint and the configured Apps Script endpoint so
// production-build browser checks never write test drafts to the team sheet.
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;
async function installMockApi(page: Page) {
  const drafts = new Map<string, any>();
  const pdfs = new Map<
    string,
    { name: string; data: string; mimeType: string }
  >();
  const requests = new Map<string, any>();
  const jobs = new Map<string, any>();
  const mutations = new Map<string, string>();
  const requestFiles = new Map<
    string,
    { name: string; data: string; mimeType: string }
  >();
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
  const commit = (request: any, mutationId: string) => {
    const previous = requests.get(request.id);
    const revision = previous ? previous.revision + 1 : 1;
    const next = {
      ...request,
      revision,
      createdAt: previous ? previous.createdAt : request.createdAt,
      updatedAt: new Date().toISOString(),
    };
    requests.set(request.id, next);
    mutations.set(mutationId, request.id);
    return next;
  };
  await page.route(apiRoute, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const params = url.searchParams;
    const method = request.method();
    let action = params.get("action") ?? "";
    let body: Record<string, unknown> = {};
    if (method === "POST") {
      try {
        body = JSON.parse(request.postData() ?? "{}") as Record<
          string,
          unknown
        >;
      } catch {
        body = {};
      }
      action = String(body.action ?? action);
    }
    const respond = (obj: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });
    if (action === "list") {
      const rows = [...drafts.values()]
        .map((d) => ({
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
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return respond({ ok: true, drafts: rows });
    }
    if (action === "open") {
      const draft = drafts.get(params.get("id") ?? "");
      return draft
        ? respond({ ok: true, draft })
        : respond({ ok: false, error: "Draft not found." });
    }
    if (action === "save") {
      const draft = body.draft as any;
      const previous = drafts.get(draft.id);
      if (previous && previous.revision > draft.revision)
        return respond({
          ok: false,
          error: "A newer version of this draft already exists.",
        });
      drafts.set(draft.id, draft);
      return respond({ ok: true });
    }
    if (action === "delete") {
      const draft = drafts.get(String(body.id));
      if (draft?.source?.driveFileId) pdfs.delete(draft.source.driveFileId);
      drafts.delete(String(body.id));
      return respond({ ok: true });
    }
    if (action === "uploadPdf") {
      const fileId = String(
        body.replaceFileId || `pdf-${Math.random().toString(36).slice(2)}`,
      );
      pdfs.set(fileId, {
        name: String(body.name),
        data: String(body.data),
        mimeType: String(body.mimeType || "application/pdf"),
      });
      return respond({ ok: true, fileId });
    }
    if (action === "pdf") {
      const pdf = pdfs.get(params.get("id") ?? "");
      return pdf
        ? respond({
            ok: true,
            name: pdf.name,
            mimeType: pdf.mimeType,
            data: pdf.data,
          })
        : respond({ ok: false, error: "Source PDF not found." });
    }
    if (action === "listRequests") {
      const rows = [...requests.values()]
        .map(summarize)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return respond({ ok: true, requests: rows });
    }
    if (action === "openRequest") {
      const request = requests.get(params.get("id") ?? "");
      return request
        ? respond({ ok: true, request })
        : respond({ ok: false, error: "Request not found." });
    }
    if (action === "saveRequest") {
      const request = body.request as any;
      const mutationId = String(body.mutationId);
      if (mutations.has(mutationId)) {
        const id = mutations.get(mutationId)!;
        return respond({ ok: true, request: requests.get(id) });
      }
      const previous = requests.get(request.id);
      if (previous && previous.revision !== body.expectedRevision)
        return respond({
          ok: false,
          error: "This request changed in another window.",
          code: "CONFLICT",
          currentRevision: previous.revision,
        });
      return respond({ ok: true, request: commit(request, mutationId) });
    }
    if (action === "claimRequest") {
      const request = requests.get(String(body.id));
      if (!request)
        return respond({ ok: false, error: "Request not found.", code: "NOT_FOUND" });
      const claimed = {
        ...request,
        estimatorName: String(body.estimatorName),
        status: "in_review",
      };
      return respond({ ok: true, request: commit(claimed, String(body.mutationId)) });
    }
    if (action === "transitionRequest") {
      const request = requests.get(String(body.id));
      if (!request)
        return respond({ ok: false, error: "Request not found.", code: "NOT_FOUND" });
      const target = String(body.status);
      let next: any;
      if (target === "submitted")
        next = {
          ...request,
          status: request.estimatorName ? "in_review" : "submitted",
          submittedAt: new Date().toISOString(),
          informationQuestion: "",
        };
      else if (target === "needs_information")
        next = {
          ...request,
          status: "needs_information",
          informationQuestion: String(body.question),
        };
      else if (target === "ready") next = { ...request, status: "ready" };
      else
        return respond({ ok: false, error: "That status change is not permitted." });
      return respond({ ok: true, request: commit(next, String(body.mutationId)) });
    }
    if (action === "uploadAttachment") {
      const file = body.file as any;
      const key = `${String(body.requestId)}:${String(body.attachmentId)}`;
      requestFiles.set(key, {
        name: String(file.name),
        mimeType: String(file.mimeType),
        data: String(file.data),
      });
      return respond({
        ok: true,
        attachment: {
          id: String(body.attachmentId),
          kind: file.kind,
          name: String(file.name),
          mimeType: String(file.mimeType),
          size: Number(file.size),
          driveFileId: key,
        },
      });
    }
    if (action === "fetchAttachment") {
      const key = `${params.get("requestId")}:${params.get("attachmentId")}`;
      const file = requestFiles.get(key);
      return file
        ? respond({ ok: true, ...file })
        : respond({ ok: false, error: "Attachment not found." });
    }
    if (action === "listJobs") {
      return respond({ ok: true, jobs: [...jobs.values()] });
    }
    if (action === "importJobs") {
      const list = Array.isArray(body.jobs) ? (body.jobs as any[]) : [];
      jobs.clear();
      for (const job of list) jobs.set(String(job.jobNumber), job);
      return respond({ ok: true, jobs: list });
    }
    if (action === "convertLegacyRequest") {
      const legacy = drafts.get(String(body.id));
      if (!legacy)
        return respond({ ok: false, error: "Legacy draft not found." });
      const converted = {
        schemaVersion: 2,
        id: `req-${Math.random().toString(36).slice(2)}`,
        revision: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "draft",
        estimatorName: "",
        submittedAt: null,
        informationQuestion: "",
        job: legacy.job,
        requestedChanges: legacy.changes.map((item: any) => ({
          id: `ch-${Math.random().toString(36).slice(2)}`,
          room: item.room,
          action: item.action,
          description: item.description,
          reason: item.reason,
          measurements: "",
          materials: "",
          scheduleImpact: "",
          estimateItemIds: item.original ? [item.original.id] : [],
        })),
        quotes: [],
        attachments: [],
        estimate: legacy.estimate,
        estimateAttachmentId: null,
        extractionWarnings: legacy.extractionWarnings || [],
        pricedItems: legacy.changes.map((item: any, index: number) => ({
          ...item,
          requestChangeId: "",
          pricingConfirmed: false,
        })),
        exclusions: {},
        customerScope: legacy.scope || "",
        customerScopeEdited: legacy.scopeEdited,
        customerScopeConfirmed: false,
        contractConfirmed: false,
        legacyDraftId: legacy.id,
      };
      converted.pricedItems = converted.pricedItems.map(
        (item: any, index: number) => ({
          ...item,
          requestChangeId: converted.requestedChanges[index].id,
        }),
      );
      return respond({
        ok: true,
        request: commit(converted, String(body.mutationId)),
      });
    }
    return respond({ ok: false, error: "Unknown action." });
  });
}
test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

test("real split-price Xactimate estimate uploads, preserves credits, and generates a packet", async ({
  page,
}) => {
  // Opt-in so the customer's estimate is kept outside the repository.
  test.skip(
    !process.env.HAYS_ESTIMATE_SAMPLE,
    "Set HAYS_ESTIMATE_SAMPLE to the supplied regression PDF.",
  );
  test.setTimeout(60000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "New change order", exact: true })
    .click();
  await page
    .getByLabel("Upload estimate PDF")
    .setInputFiles(process.env.HAYS_ESTIMATE_SAMPLE!);
  await expect(page.getByText("Your estimate is attached.")).toBeVisible();
  await expect(page.locator(".baseline-row")).toHaveCount(296);
  await expect(
    page.getByText(/No supported Xactimate line-item table/),
  ).toHaveCount(0);
  await page.getByLabel("Search estimate").fill("345");
  await expect(page.locator(".estimate-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".estimate-table tbody tr")).toContainText(
    "-$692.08",
  );
  await page.getByLabel("Review original line 345").click();
  await expect(page.getByLabel("Unit price ($)", { exact: true })).toHaveValue(
    "-692.08",
  );
  await expect(page.getByLabel("Original RCV ($)")).toHaveValue("-692.08");
  await page.getByLabel("Search estimate").fill("");
  await page
    .getByRole("button", { name: "Confirm all complete original items" })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Search items to change").fill("R&R Stud wall");
  await page
    .getByRole("button", { name: "Revise", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Revised quantity")).toHaveValue("128.00");
  await expect(page.getByLabel("Unit price ($)", { exact: true })).toHaveValue(
    "2.73",
  );
  await page.getByLabel("Revised quantity").fill("138.00");
  await page
    .getByLabel("Reason for this change")
    .fill("Additional framing area identified");
  await page.getByLabel("I confirm the revised pricing").check();
  await expect(page.locator(".rail-total")).toContainText("+$27.30");
  await page.getByLabel("Search items to change").fill("345");
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  const credit = page.locator(".change-card").last();
  await credit.getByLabel("Unit price ($)", { exact: true }).fill("-700.00");
  await credit
    .getByLabel("Reason for this change")
    .fill("Revise the original labor credit");
  await credit.getByLabel("I confirm the revised pricing").check();
  await expect(page.locator(".rail-total")).toContainText("+$19.38");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Original contract ($)")).toHaveValue(
    "167045.81",
  );
  await page.getByLabel("Job number", { exact: true }).fill("XACTIMATE-QA");
  await page.getByLabel("Project manager", { exact: true }).fill("QA PM");
  await page.getByLabel("Branch contact / contractor").fill("QA Contractor");
  await page.getByLabel("Insurance carrier").fill("QA Carrier");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download packet" }),
  ).toBeVisible();
  await expect(page.locator(".summary-grid")).toContainText("$167,065.19");
  await expect(page.locator(".pdf-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download packet" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(
    "XACTIMATE-QA_CO-01_Change_Order_Packet.pdf",
  );
  await download.saveAs("tmp/pdfs/real-estimate-qa-packet.pdf");
  expect(runtimeErrors).toEqual([]);
});
test("upload, correct originals, calculate changes, reload, preview, and download", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await page
    .getByRole("button", { name: "New change order", exact: true })
    .click();
  await page
    .getByLabel("Upload estimate PDF")
    .setInputFiles(resolve("tmp/fixtures/xactimate-final-draft.pdf"));
  await expect(page.getByText("Your estimate is attached.")).toBeVisible();
  await expect(page.locator(".baseline-row")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Confirm all complete original items" })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Revise", exact: true })
    .first()
    .click();
  await page.getByLabel("Revised quantity").fill("150");
  await page.getByLabel("Revised tax ($)").fill("6.00");
  await page.getByLabel("Revised O&P ($)").fill("30.00");
  await page
    .getByLabel("Reason for this change")
    .fill("Additional wall area discovered");
  await page.getByLabel("I confirm the revised pricing").check();
  await expect(page.locator(".rail-total")).toContainText("+$112.00");
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Revised quantity")).toHaveValue("150");
  await expect(page.locator(".rail-total")).toContainText("+$112.00");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Customer / project owner")).toHaveValue(
    "Sample Customer",
  );
  await page.getByLabel("Job number", { exact: true }).fill("FW-TEST-001");
  await page.getByLabel("Project manager", { exact: true }).fill("Sample PM");
  await page
    .getByLabel("Branch contact / contractor")
    .fill("Sample Contractor");
  await page.getByLabel("Original contract ($)").fill("10000.00");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Download packet" }),
  ).toBeVisible();
  await expect(page.locator(".summary-grid")).toContainText("$10,112.00");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".pdf-canvas")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(
    await page
      .locator("canvas")
      .evaluate((canvas) => (canvas as HTMLCanvasElement).height),
  ).toBeGreaterThan(400);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download packet" }).click();
  expect((await download).suggestedFilename()).toBe(
    "FW-TEST-001_CO-01_Change_Order_Packet.pdf",
  );
  await page.screenshot({ path: "tmp/desktop-preview.png", fullPage: true });
  await page.getByRole("button", { name: "Back to drafts" }).click();
  await expect(page.locator(".draft-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Open draft" }).click();
  await page.getByRole("button", { name: /Upload estimate Bring/ }).click();
  await expect(page.getByText("xactimate-final-draft.pdf")).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
test("manual additions work on mobile and invalid output is blocked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({ path: "tmp/mobile-home.png", fullPage: true });
  await page
    .getByRole("button", { name: "New change order", exact: true })
    .click();
  await page.getByRole("button", { name: "Enter changes manually" }).click();
  await page.getByRole("button", { name: "Add new work" }).click();
  await page
    .getByLabel("Description", { exact: true })
    .fill("Repair additional drywall");
  await page.getByLabel("Unit price ($)", { exact: true }).fill("250");
  await page
    .getByLabel("Reason for this change")
    .fill("Hidden damage discovered");
  await page.getByLabel("I confirm the revised pricing").check();
  await expect(page.locator(".rail")).toBeVisible();
  await page.screenshot({ path: "tmp/mobile-changes.png", fullPage: true });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Customer is required");
  await expect(
    page.getByRole("button", { name: "Download packet" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("image-only PDFs provide a manual fallback", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New change order", exact: true })
    .click();
  await page
    .getByLabel("Upload estimate PDF")
    .setInputFiles(resolve("tmp/fixtures/no-text.pdf"));
  await expect(page.getByText(/This PDF has no selectable text/)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add new work" }),
  ).toBeVisible();
});
test("remote storage failures stay visible and keep the unsaved workspace open", async ({
  page,
}) => {
  await page.route(apiRoute, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Sync unavailable" }),
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "New change order", exact: true })
    .click();
  await expect(page.locator(".storage-error")).toContainText(
    "Sync unavailable",
  );
  await page.getByRole("button", { name: "My drafts" }).click();
  await expect(page.getByRole("alert").last()).toContainText(
    "Retry saving before returning to drafts",
  );
  await expect(
    page.getByRole("heading", { name: "Start with the estimate." }),
  ).toBeVisible();
});
test("PM submits a text-only request and an estimator prices it to a ready packet", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tell estimating what changed." }),
  ).toBeVisible();
  await page.getByLabel("Job number", { exact: true }).fill("FW-REQ-001");
  await page
    .getByLabel("Customer / project owner", { exact: true })
    .fill("New Request Customer");
  await page
    .getByLabel("Property address", { exact: true })
    .fill("500 Example Ave, Fort Wayne, IN");
  await page.getByLabel("Project manager", { exact: true }).fill("New Request PM");
  await page
    .getByRole("button", { name: "Add another work area / change", exact: true })
    .click();
  await page
    .getByLabel("Room / work area", { exact: true })
    .fill("Kitchen");
  await page
    .getByRole("textbox", { name: "What needs to change?" })
    .fill("Replace the damaged lower cabinets.");
  await page
    .getByRole("textbox", { name: "Why is this change needed?" })
    .fill("Water damage found after demo.");
  await page
    .getByRole("button", { name: "Submit to estimating", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Claim this request", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All requests", exact: true }).click();
  await expect(page.locator(".request-row")).toHaveCount(1);
  await expect(page.locator(".request-row")).toContainText("In queue");
  await page.locator(".request-row").click();
  await page.getByLabel("Estimator name", { exact: true }).fill("QA Estimator");
  await page
    .getByRole("button", { name: "Claim this request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Turn the field request into a customer change order.",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add customer priced item", exact: true })
    .click();
  await page
    .getByLabel("Final customer price (includes tax and O&P)", { exact: true })
    .fill("1200.00");
  await page
    .getByLabel("Customer-facing description", { exact: true })
    .fill("Install replacement lower cabinets");
  await page
    .getByLabel("Customer-facing reason", { exact: true })
    .fill("Water-damaged cabinets");
  await page
    .getByLabel("I approve this customer description, reason, and final pricing")
    .check();
  await page
    .getByLabel("I reviewed and approved the customer scope wording")
    .check();
  await page
    .getByLabel("Original contract amount", { exact: true })
    .fill("45000.00");
  await page
    .getByLabel("Contractor contact", { exact: true })
    .fill("QA Contractor");
  await page
    .getByLabel("Insurance carrier", { exact: true })
    .fill("QA Carrier");
  await page.getByLabel("Claim number", { exact: true }).fill("QA-CLAIM-1");
  await page
    .getByLabel("I verified the contract amounts and customer document details")
    .check();
  await page
    .getByRole("button", { name: "Mark ready for customer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download packet", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".summary-grid")).toContainText("$46,200.00");
  expect(runtimeErrors).toEqual([]);
});

test("an admin imports jobs, then the PM picker autofills the job details", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Manage the job list", exact: true }),
  ).toBeVisible();
  const csv = [
    "Status,Job Number,Customer,Customer Main Phone,Customer Email,Job Address,Loss City,Loss State,Loss ZIP,Estimator,ForePerson",
    "Work in Progress,F-26-0366-R,York Tori,260-580-0110,sportyhd13@hotmail.com,1825 Sprunger St.,Fort Wayne,IN,46808,Russell Shive,Lance Stanley",
    "Work in Progress,F-26-0366-P,York Tori,260-580-0110,sportyhd13@hotmail.com,1825 Sprunger St.,Fort Wayne,IN,46808,Angela Tuddy,Tarreck ElBarassi",
  ].join("\n");
  await page.getByLabel("Paste job report CSV").fill(csv);
  await page.getByRole("button", { name: "Preview jobs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "2 jobs ready to import", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Import 2 jobs", exact: true })
    .click();
  await expect(page.getByText(/2 jobs imported/)).toBeVisible();
  await page
    .getByRole("button", { name: "Back to requests", exact: true })
    .click();
  await page.getByRole("button", { name: "New request", exact: true }).click();
  // The picker stays empty until the PM types — never the full customer list.
  await expect(page.locator(".pm-job-results")).toHaveCount(0);
  await page.getByLabel("Find your job").fill("Sprunger");
  await expect(page.locator(".pm-job-results")).toBeVisible();
  await page.getByRole("button", { name: "Use job F-26-0366-R" }).click();
  await expect(page.getByLabel("Job number", { exact: true })).toHaveValue(
    "F-26-0366-R",
  );
  await expect(
    page.getByLabel("Customer / project owner", { exact: true }),
  ).toHaveValue("York Tori");
  await expect(
    page.getByLabel("Property address", { exact: true }),
  ).toHaveValue("1825 Sprunger St., Fort Wayne, IN 46808");
  await expect(
    page.getByLabel("Project manager", { exact: true }),
  ).toHaveValue("Lance Stanley");
  expect(runtimeErrors).toEqual([]);
});
