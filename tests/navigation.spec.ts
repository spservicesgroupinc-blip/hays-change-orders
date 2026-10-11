import { test, expect, type Page } from "@playwright/test";

/**
 * The UI is installed as a standalone PWA, so a phone gives the user exactly
 * two ways out of a screen: the in-app controls and the system back gesture.
 * These tests pin both, for the simplified app: the dashboard, the quick
 * request form, and a single change-order review page.
 */
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

const queuedRequest = {
  id: "r1",
  revision: 1,
  createdAt: "",
  updatedAt: "2026-10-01T12:00:00.000Z",
  status: "submitted",
  estimatorName: "",
  changesCount: 1,
  attachmentsCount: 0,
  job: {
    customer: "York Ridge Apartments",
    jobNumber: "F-26-0366-P",
    projectManager: "Dana Whitfield",
    orderNumber: "",
    address: "1200 York St",
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
  attachments: [],
};

async function installMockApi(page: Page) {
  // The admin's job directory, replaced wholesale by each import.
  const directory: Record<string, unknown>[] = [];
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
    const respond = (obj: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(obj),
      });
    if (action === "bootstrap" || action === "listRequests")
      return respond({ ok: true, requests: [queuedRequest], jobs: directory });
    if (action === "listJobs") return respond({ ok: true, jobs: directory });
    if (action === "importJobs") {
      directory.length = 0;
      directory.push(...((body.jobs as Record<string, unknown>[]) ?? []));
      return respond({ ok: true, jobs: directory });
    }
    if (action === "openRequest") return respond({ ok: true, request: queuedRequest });
    if (action === "claimRequest")
      return respond({
        ok: true,
        request: { ...queuedRequest, status: "in_review", estimatorName: String(body.estimatorName ?? "") },
      });
    if (action === "transitionRequest")
      return respond({ ok: true, request: { ...queuedRequest, status: String(body.status ?? "submitted") } });
    return respond({ ok: true });
  });
}

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

const dashboard = (page: Page) =>
  page.getByRole("heading", { name: "Change orders", exact: true });

test("the quick request form opens from the header and the home button", async ({
  page,
}) => {
  await page.goto("/");
  await expect(dashboard(page)).toBeVisible();

  await page.getByRole("button", { name: "Quick request", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/simple");

  await page.getByRole("button", { name: "Back to requests", exact: true }).click();
  await expect(dashboard(page)).toBeVisible();

  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();
});

test("a phone can open the menu, find the sections, and Escape closes it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Quick request", exact: true }),
  ).toBeVisible();
  const box = await page
    .getByRole("button", { name: "Quick request", exact: true })
    .boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
});

test("the back gesture returns to the request list instead of leaving the app", async ({
  page,
}) => {
  await page.goto("/");
  await expect(dashboard(page)).toBeVisible();

  await page.getByRole("button", { name: /York Ridge Apartments/ }).click();
  await expect(
    page.getByRole("heading", { name: "In queue", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toMatch(/^#\/requests\//);

  await page.goBack();
  await expect(dashboard(page)).toBeVisible();
});

test("sections survive a reload and the brand returns home", async ({ page }) => {
  await page.goto("/#/simple");
  await expect(
    page.getByRole("heading", { name: "Quick request", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("link", { name: "Hays + Sons change orders home" })
    .click();
  await expect(dashboard(page)).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/");

  await page.reload();
  await expect(dashboard(page)).toBeVisible();
});

test("the jobs page is linkable and offers a way back to the dashboard", async ({
  page,
}) => {
  await page.goto("/#/jobs");
  await expect(
    page.getByRole("heading", { name: "Manage the job list", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Back to requests", exact: true })
    .click();
  await expect(dashboard(page)).toBeVisible();
});

/**
 * The admin's import is what makes the PM's type-ahead work: the uploaded
 * report becomes the directory the quick request form suggests from.
 */
test("an imported job report autocompletes the quick request form", async ({
  page,
}) => {
  await page.goto("/");
  await expect(dashboard(page)).toBeVisible();

  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Manage the job list", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/jobs");

  const report = [
    "Status,Job Number,Customer,Job Address,Loss City,Loss State,Loss ZIP,ForePerson,Estimate Amount",
    'Work in Progress,F-26-0366-R,York Tori,1825 Sprunger St.,Fort Wayne,IN,46808,Lance Stanley,"$167,045.81"',
  ].join("\n");
  await page
    .getByLabel("Paste job report CSV", { exact: true })
    .fill(report);
  await page.getByRole("button", { name: "Preview jobs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "1 job ready to import", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".admin-sample")).toContainText("F-26-0366-R");

  await page.getByRole("button", { name: "Import 1 job", exact: true }).click();
  await expect(page.getByText(/1 job imported/)).toBeVisible();

  // The imported row now autocompletes the quick request form, and picking it
  // attaches the job's details to the request.
  await page.getByRole("button", { name: "Quick request", exact: true }).click();
  await page.getByLabel("Customer / job", { exact: true }).fill("York");
  await page
    .getByRole("button", {
      name: "Use job F-26-0366-R for York Tori",
      exact: true,
    })
    .click();
  await expect(page.locator(".sr-summary")).toContainText("F-26-0366-R");
});
