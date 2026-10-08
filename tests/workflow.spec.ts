import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
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
test("device storage failures stay visible and keep the unsaved workspace open", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: {
        open() {
          throw new DOMException(
            "Device storage unavailable",
            "QuotaExceededError",
          );
        },
      },
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "New change order", exact: true })
    .click();
  await expect(page.locator(".storage-error")).toContainText(
    "Device storage unavailable",
  );
  await page.getByRole("button", { name: "My drafts" }).click();
  await expect(page.getByRole("alert").last()).toContainText(
    "Retry saving before returning to drafts",
  );
  await expect(
    page.getByRole("heading", { name: "Start with the estimate." }),
  ).toBeVisible();
});
