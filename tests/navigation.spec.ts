import { test, expect, type Page } from "@playwright/test";

/**
 * The UI is installed as a standalone PWA, so a phone gives the user exactly
 * two ways out of a screen: the in-app controls and the system back gesture.
 * These tests pin both, for every section of the app.
 */
const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

async function installMockApi(page: Page) {
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
    if (action === "bootstrap")
      return respond({ ok: true, requests: [], drafts: [], jobs: [] });
    if (action === "listRequests") return respond({ ok: true, requests: [] });
    if (action === "listDrafts") return respond({ ok: true, drafts: [] });
    if (action === "listJobs") return respond({ ok: true, jobs: [] });
    if (action === "saveRequest") {
      const saved = body.request ?? {};
      // Echo the server's revision bump so autosave settles instead of leaving
      // a conflict banner over the screen under test.
      return respond({
        ok: true,
        request: {
          ...saved,
          revision: Number(saved.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        },
      });
    }
    return respond({ ok: true });
  });
}

test.beforeEach(async ({ page }) => {
  await installMockApi(page);
});

const dashboard = (page: Page) =>
  page.getByRole("heading", { name: "Change orders", exact: true });

test("every section offers a visible way back to the dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(dashboard(page)).toBeVisible();

  for (const section of ["Change orders", "Jobs", "Legacy editor"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    const back = page.getByRole("button", {
      name: "Back to requests",
      exact: true,
    });
    await expect(back).toBeVisible();
    await back.click();
    await expect(dashboard(page)).toBeVisible();
  }
});

test("a phone can always leave the change order and job pages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(dashboard(page)).toBeVisible();

  for (const section of ["Change orders", "Jobs"]) {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: section, exact: true }).click();
    const back = page.getByRole("button", {
      name: "Back to requests",
      exact: true,
    });
    await expect(back).toBeVisible();
    await back.click();
    await expect(dashboard(page)).toBeVisible();
  }

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("the navigation menu opens, fits the screen and closes with Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: "Legacy editor", exact: true }),
  ).toBeVisible();
  const box = await page
    .getByRole("button", { name: "Legacy editor", exact: true })
    .boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
});

test("the back gesture returns to the request list instead of leaving the app", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Change request", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toMatch(/^#\/requests\//);

  await page.goBack();

  await expect(dashboard(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New request", exact: true }),
  ).toBeVisible();
});

test("the header stays on screen at the bottom of a long form", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Change request", exact: true }),
  ).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const back = page.getByRole("button", {
    name: "All requests",
    exact: true,
  });
  await expect(back).toBeVisible();
  const box = await back.boundingBox();
  expect(box && box.y >= 0 && box.y < 160).toBe(true);

  await back.click();
  await expect(dashboard(page)).toBeVisible();
});

test("sections are linkable, survive a reload, and the brand returns home", async ({
  page,
}) => {
  await page.goto("/#/jobs");
  await expect(
    page.getByRole("heading", { name: "Manage the job list", exact: true }),
  ).toBeVisible();

  await page
    .getByRole("link", { name: "Hays + Sons change orders home" })
    .click();
  await expect(dashboard(page)).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/");

  await page.reload();
  await expect(dashboard(page)).toBeVisible();

  await page.goto("/#/orders");
  await expect(
    page.getByRole("heading", { name: "Stored change orders", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Hays + Sons change orders home" })
    .click();
  await expect(dashboard(page)).toBeVisible();
});
