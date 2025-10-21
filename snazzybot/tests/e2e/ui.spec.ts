import { test, expect } from "@playwright/test";

test("Run SnazzyBot button shows result and enables copy", async ({ page }) => {
  await page.route("**/api/status", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        output: "Hello\n\n[View bugs in Bugzilla](https://x)",
      }),
    });
  });

  await page.goto("/");
  await page.getByText("Run SnazzyBot").click();
  await expect(page.locator("#copy")).toBeEnabled();
  await expect(page.locator("#resultFrame")).toBeVisible();
});
