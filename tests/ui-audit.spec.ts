import { test } from "@playwright/test";
test("diag: mobile legacy overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "New change order", exact: true }).click();
  await page.getByRole("button", { name: "Enter changes manually" }).click();
  await page.getByRole("button", { name: "Add new work" }).click();
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const width = window.innerWidth;
    const offenders: any[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > width + 1 || rect.right > width + 1) {
        const chain: string[] = [];
        let node: HTMLElement | null = el;
        for (let i = 0; i < 4 && node; i++) {
          const r = node.getBoundingClientRect();
          chain.push(`${node.tagName.toLowerCase()}.${(node.className||"").toString().split(" ").slice(0,2).join(".")}[${Math.round(r.left)},${Math.round(r.right)}] w=${Math.round(r.width)}`);
          node = node.parentElement;
        }
        offenders.push({ el: chain[0], chain, text: (el.textContent||"").trim().slice(0, 30) });
      }
    });
    return { scrollWidth: document.documentElement.scrollWidth, width, offenders: offenders.slice(0, 12) };
  });
  console.log(JSON.stringify(info, null, 1));
});
