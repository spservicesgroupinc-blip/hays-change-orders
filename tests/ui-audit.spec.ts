import { test } from "@playwright/test";

const apiRoute =
  /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

async function mockApi(page: any, requests: any[] = []) {
  await page.route(apiRoute, async (route: any) => {
    const req = route.request();
    const url = new URL(req.url());
    let action = url.searchParams.get("action") ?? "";
    if (req.method() === "POST") {
      try {
        action = JSON.parse(req.postData() ?? "{}").action ?? action;
      } catch {}
    }
    const payload: Record<string, unknown> = { ok: true };
    if (action === "bootstrap") {
      payload.requests = requests;
      payload.drafts = [];
      payload.jobs = [];
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

const summary = {
  id: "req-1",
  revision: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  status: "submitted",
  estimatorName: "",
  changesCount: 1,
  attachmentsCount: 0,
  job: { customer: "Audit Customer", jobNumber: "A-1", projectManager: "PM", orderNumber: "", address: "" },
};

test("audit: mobile orders page escape routes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, [summary]);
  await page.goto("/");
  await page.getByRole("button", { name: "Change orders", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "tmp/audit-mobile-orders.png" });
  const back = page.getByRole("button", { name: "Back to requests", exact: true });
  console.log("ORDERS back-link count:", await back.count(), "visible:", await back.isVisible().catch(() => "n/a"));
  const controls = await page.locator("a, button").evaluateAll((els) =>
    els.filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => (el.textContent || "").trim().slice(0, 40)).filter(Boolean));
  console.log("ORDERS visible controls:", JSON.stringify(controls));
});

test("audit: mobile jobs page escape routes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, [summary]);
  await page.goto("/");
  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "tmp/audit-mobile-jobs.png" });
  const back = page.getByRole("button", { name: "Back to requests", exact: true });
  console.log("JOBS back-link count:", await back.count(), "visible:", await back.isVisible().catch(() => "n/a"));
  const controls = await page.locator("a, button").evaluateAll((els) =>
    els.filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => (el.textContent || "").trim().slice(0, 40)).filter(Boolean));
  console.log("JOBS visible controls:", JSON.stringify(controls));
});

test("audit: mobile request page reachable chrome", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, [summary]);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "tmp/audit-mobile-request.png" });
  const controls = await page.locator("header a, header button").evaluateAll((els) =>
    els.filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => (el.textContent || "").trim().slice(0, 40)).filter(Boolean));
  console.log("REQUEST header controls:", JSON.stringify(controls));
  const top = await page.locator("header").evaluate((el) => el.getBoundingClientRect().top);
  console.log("header top at scroll 0:", top);
  await page.evaluate(() => window.scrollTo(0, 3000));
  await page.waitForTimeout(200);
  const topAfter = await page.locator("header").evaluate((el) => el.getBoundingClientRect().top);
  const box = await page.locator("header").boundingBox();
  console.log("header top after scrolling 3000px:", topAfter, "box:", JSON.stringify(box));
  await page.screenshot({ path: "tmp/audit-mobile-request-scrolled.png" });
});

test("audit: hardware back from a request", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, [summary]);
  await page.goto("/");
  await page.getByRole("button", { name: "New request", exact: true }).click();
  await page.waitForTimeout(500);
  console.log("URL after opening a request:", page.url());
  await page.goBack({ waitUntil: "commit" }).catch((e: Error) => console.log("goBack failed:", e.message));
  await page.waitForTimeout(400);
  console.log("URL after goBack:", page.url());
  const onRequest = await page.getByRole("heading", { name: "Tell estimating what changed." }).count();
  console.log("still on the request form after hardware back:", onRequest > 0);
});
