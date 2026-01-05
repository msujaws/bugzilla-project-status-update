import { test, expect, Route, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PagedFixture = {
  name: string;
  kind: "paged";
  recordedAt: string;
  requestBody: Record<string, unknown>;
  responses: {
    discover: Record<string, unknown>;
    pages: Array<{
      request: { cursor: number; pageSize: number };
      response: Record<string, unknown>;
    }>;
    finalize: Record<string, unknown>;
  };
  meta?: {
    valid?: Array<{ id: number; summary: string; assignee: string }>;
    [key: string]: unknown;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "./fixtures/status");

const loadJson = <T>(name: string): T => {
  const raw = fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf8");
  return JSON.parse(raw) as T;
};

const fixtures = {
  devtoolsTwoValid: loadJson<PagedFixture>("devtools-two-valid"),
  devtoolsPatch: loadJson<PagedFixture>("devtools-patch-context"),
  devtoolsEmpty: loadJson<PagedFixture>("devtools-empty"),
  fxVpn: loadJson<PagedFixture>("fx-vpn-trio"),
};

const disallowedConsoleTypes = new Set(["warning", "error"]);
const consoleErrorAllowlist = new WeakSet<Page>();
const allowConsoleErrors = (page: Page) => {
  consoleErrorAllowlist.add(page);
};

test.beforeEach(async ({ page }, testInfo) => {
  page.on("console", (msg) => {
    const type = msg.type();
    if (!disallowedConsoleTypes.has(type)) return;
    if (consoleErrorAllowlist.has(page)) return;
    const location = msg.location();
    const where = location.url
      ? `${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`
      : "unknown location";
    const message = `Browser console ${type}: ${msg.text()} (${where})`;
    testInfo
      .attach(`console-${type}`, { body: message, contentType: "text/plain" })
      .catch(() => {});
    throw new Error(message);
  });
});

test.afterEach(async ({ page }) => {
  consoleErrorAllowlist.delete(page);
});

const requestDays = (
  requestBody: Record<string, unknown>,
  fallback: number,
) => {
  const value = (requestBody as { days?: number }).days;
  return typeof value === "number" ? value : fallback;
};

const respondJson = async (route: Route, payload: Record<string, unknown>) => {
  await route.fulfill({
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
};

const setupPagedFixture = async (page: Page, fixture: PagedFixture) => {
  const pages = [...(fixture.responses.pages || [])];
  await page.route("**/api/status", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.mode === "discover") {
      return respondJson(route, fixture.responses.discover);
    }
    if (body?.mode === "page") {
      const next = pages.shift();
      if (!next) throw new Error("No page fixture remaining");
      expect(body.cursor).toBe(next.request.cursor);
      expect(body.pageSize).toBe(next.request.pageSize);
      return respondJson(route, next.response);
    }
    if (body?.mode === "finalize") {
      return respondJson(route, fixture.responses.finalize);
    }
    throw new Error(`Unexpected mode ${body?.mode}`);
  });
};

test.describe("SnazzyBot UI fixtures", () => {
  test("DevTools paged run highlights two valid bugs and logs diagnostics", async ({
    page,
  }) => {
    const fixture = fixtures.devtoolsTwoValid;
    await setupPagedFixture(page, fixture);

    await page.goto("/");
    await page.fill("#components", "DevTools");
    await page.fill("#days", String(requestDays(fixture.requestBody, 21)));
    await page.getByRole("button", { name: "Run SnazzyBot" }).click();

    await expect(page.locator("#log")).toContainText("Window: last 21 days");
    await expect(page.locator("#log")).toContainText("Bugzilla Candidates: 2");

    const frame = page.frameLocator("#resultFrame");
    const [first, second] = fixture.meta?.valid ?? [];
    if (!first || !second) {
      throw new Error("Fixture is missing valid bug metadata");
    }
    await expect(frame.locator("body")).toContainText(
      "DevTools — Highlighted fixes",
    );
    await expect(frame.locator("body")).toContainText(first.assignee);
    await expect(frame.locator("body")).toContainText(`Bug ${first.id}`);
    await expect(frame.locator("body")).toContainText(`Bug ${second.id}`);
    await expect(frame.locator("body")).toContainText(
      "Security-restricted candidate omitted",
    );
    await expect(frame.locator("body")).toContainText(
      "OpenAI fixture response generated",
    );
    await expect(page.locator("#copy")).toBeEnabled();
    await expect(page.locator("#copy-rendered")).toBeEnabled();
  });

  test("DevTools paged run handles zero candidates gracefully", async ({
    page,
  }) => {
    const fixture = fixtures.devtoolsEmpty;
    await setupPagedFixture(page, fixture);

    await page.goto("/");
    await page.fill("#components", "DevTools:Imaginary Component");
    await page.fill("#days", String(requestDays(fixture.requestBody, 7)));
    await page.getByRole("button", { name: "Run SnazzyBot" }).click();

    await expect(page.locator("#log")).toContainText("Candidates: 0");
    const frame = page.frameLocator("#resultFrame");
    await expect(frame.locator("body")).toContainText(
      "No user-impacting DevTools changes detected",
    );
    await expect(frame.locator("body")).toContainText("View bugs in Bugzilla");
  });

  test("[fx-vpn] paged run renders three valid candidates", async ({
    page,
  }) => {
    const fixture = fixtures.fxVpn;
    await setupPagedFixture(page, fixture);

    await page.goto("/");
    await page.fill("#whiteboards", "[fx-vpn]");
    await page.fill("#days", String(requestDays(fixture.requestBody, 30)));
    await page.getByRole("button", { name: "Run SnazzyBot" }).click();

    await expect(page.locator("#log")).toContainText("Candidates: 3");
    const frame = page.frameLocator("#resultFrame");
    await expect(frame.locator("body")).toContainText(
      "[fx-vpn] deployment-ready fixes",
    );
    await expect(frame.locator("body")).toContainText("Bug 1976518");
    await expect(frame.locator("body")).toContainText("Bug 1980185");
    await expect(frame.locator("body")).toContainText("Bug 1976546");
    await expect(frame.locator("body")).toContainText("OpenAI fixture summary");
  });

  test("Paged discover failure shows the error banner", async ({ page }) => {
    allowConsoleErrors(page);
    await page.route("**/api/status", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.mode === "discover") {
        await route.fulfill({
          status: 500,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ error: "Bugzilla unavailable" }),
        });
        return;
      }
      throw new Error("Only the discover call should fire here");
    });

    await page.goto("/");
    await page.fill("#components", "DevTools");
    await page.getByRole("button", { name: "Run SnazzyBot" }).click();

    await expect(page.locator("#out")).toContainText(
      "ERROR: Bugzilla unavailable",
    );
  });

  test("Patch-context paged run shows patch progress and updates the title", async ({
    page,
  }) => {
    const fixture = fixtures.devtoolsPatch;
    await setupPagedFixture(page, fixture);

    await page.goto("/");
    await page.fill("#components", "DevTools");
    await page.selectOption("#patch-context", "include");
    await page.fill("#days", String(requestDays(fixture.requestBody, 21)));
    await page.getByRole("button", { name: "Run SnazzyBot" }).click();

    await expect(page.locator('[data-phase="patch-context"]')).toBeVisible();
    await expect(page.locator("#title-patch-context")).toContainText(
      "patch-context: done",
    );
    await expect(page).toHaveTitle(/Results ready/i);

    const frame = page.frameLocator("#resultFrame");
    await expect(frame.locator("body")).toContainText(
      "Patch-context candidates",
    );
  });

  test("Copy and download actions update the quick status pill", async ({
    page,
    context,
  }) => {
    const fixture = fixtures.devtoolsTwoValid;
    await setupPagedFixture(page, fixture);
    if (test.info().project.use?.browserName !== "firefox") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    }
    await page.addInitScript(() => {
      const copiedTexts: string[] = [];
      Object.defineProperty(globalThis, "__copiedTexts", {
        value: copiedTexts,
        writable: false,
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            copiedTexts.push(text);
          },
          write: async () => {},
        },
      });
      // @ts-expect-error - expose ClipboardItem for the app
      globalThis.ClipboardItem = class ClipboardItem {
        data: Record<string, Blob>;
        constructor(data: Record<string, Blob>) {
          this.data = data;
        }
      };
    });

    await page.goto("/");
    await page.fill("#components", "DevTools");
    await page.getByRole("button", { name: "Run SnazzyBot" }).click();

    await page.getByLabel("Copy .md").click();
    await expect(page.locator("#quick-status")).toHaveText("Copied Markdown");

    await page.getByLabel("Copy rendered result").click();
    await expect(page.locator("#quick-status")).toHaveText(
      "Copied rendered HTML",
    );

    const downloadMdPromise = page.waitForEvent("download");
    await page.getByLabel("Download .md").click();
    const downloadMd = await downloadMdPromise;
    await expect(downloadMd.suggestedFilename()).toBe("snazzybot-status.md");

    const downloadHtmlPromise = page.waitForEvent("download");
    await page.getByLabel("Download .html").click();
    const downloadHtml = await downloadHtmlPromise;
    await expect(downloadHtml.suggestedFilename()).toBe(
      "snazzybot-status.html",
    );
  });

  test("Query params hydrate the form and persist updated selections", async ({
    page,
  }) => {
    const fixture = fixtures.devtoolsTwoValid;
    await setupPagedFixture(page, fixture);
    await page.goto(
      "/?components=Firefox%3AGeneral&days=3&aud=product&nocache=1&pc=0",
    );

    await expect(page.locator("#components")).toHaveValue("Firefox:General");
    await expect(page.locator("#days")).toHaveValue("3");
    await expect(page.locator("#audience")).toHaveValue("product");
    await expect(page.locator("#cache")).toHaveValue("false");
    await expect(page.locator("#patch-context")).toHaveValue("omit");

    await page.fill("#components", "DevTools");
    await page.fill("#days", "11");
    await page.getByRole("button", { name: "Run SnazzyBot" }).click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("components"))
      .toBe("DevTools");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("days"))
      .toBe("11");
  });

  test("Skip patch context keeps the patch phase hidden", async ({ page }) => {
    const fixture = fixtures.devtoolsPatch;
    await setupPagedFixture(page, fixture);

    await page.goto("/");
    await page.fill("#components", "DevTools");
    await page.selectOption("#patch-context", "omit");
    await page.getByRole("button", { name: "Run SnazzyBot" }).click();

    await expect(page.locator('[data-phase="patch-context"]')).toHaveCount(0);
    const frame = page.frameLocator("#resultFrame");
    await expect(frame.locator("body")).toContainText(
      "Patch-context candidates",
    );
  });
});
