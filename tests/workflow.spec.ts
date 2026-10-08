import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
async function installMockApi(page: Page) {
  const drafts = new Map<string, any>();
  const pdfs = new Map<
    string,
    { name: string; data: string; mimeType: string }
  >();
  await page.route(/__api__/, async (route) => {
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
    return respond({ ok: false, error: "Unknown action." });
  });
}
test.beforeEach(async ({ page }) => {
  await installMockApi(page);
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
  await page.route(/__api__/, (route) =>
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
