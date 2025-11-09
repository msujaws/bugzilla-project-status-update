import { test, expect, Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type StreamFixture = {
  name: string;
  kind: "stream";
  recordedAt: string;
  requestBody: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
  meta: {
    valid: Array<{ id: number; summary: string; assignee: string }>;
    invalid: Array<{ reason: string; id: number; summary: string }>;
  };
};

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
  meta?: Record<string, unknown>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "./fixtures/status");

const loadJson = <T>(name: string): T => {
  const raw = fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf8");
  return JSON.parse(raw) as T;
};

const fixtures = {
  devtoolsStream: loadJson<StreamFixture>("devtools-stream-two-valid"),
  devtoolsEmpty: loadJson<PagedFixture>("devtools-empty"),
  fxVpn: loadJson<PagedFixture>("fx-vpn-trio"),
};

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

test.describe("SnazzyBot UI fixtures", () => {
  test("DevTools streaming run highlights two valid bugs and logs restricted counts", async ({
    page,
  }) => {
    const fixture = fixtures.devtoolsStream;
    await page.route("**/api/status", async (route) => {
      const body =
        fixture.events.map((evt) => JSON.stringify(evt)).join("\n") + "\n";
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        body,
      });
    });

    await page.goto("/");
    await page.fill("#components", "DevTools");
    await page.fill("#days", String(requestDays(fixture.requestBody, 21)));
    await page.selectOption("#debug", "true");
    await page.getByRole("button", { name: "Run SnazzyBot" }).click();

    await expect(page.locator("#log")).toContainText(
      "DevTools bugs in response: 4 total",
    );
    await expect(page.locator("#log")).toContainText(
      "security-restricted removed: 1",
    );
    await expect(page.locator("#log")).toContainText(
      "confidential-restricted removed: 1",
    );

    const frame = page.frameLocator("#resultFrame");
    const [first, second] = fixture.meta.valid;
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
    await page.route("**/api/status", async (route) => {
      const body = route.request().postDataJSON();
      if (body.mode === "discover") {
        return respondJson(route, fixture.responses.discover);
      }
      if (body.mode === "finalize") {
        return respondJson(route, fixture.responses.finalize);
      }
      throw new Error(`Unexpected mode ${body.mode}`);
    });

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
    const pages = [...fixture.responses.pages];

    await page.route("**/api/status", async (route) => {
      const body = route.request().postDataJSON();
      if (body.mode === "discover") {
        return respondJson(route, fixture.responses.discover);
      }
      if (body.mode === "page") {
        const next = pages.shift();
        if (!next) throw new Error("No page fixture remaining");
        expect(body.cursor).toBe(next.request.cursor);
        expect(body.pageSize).toBe(next.request.pageSize);
        return respondJson(route, next.response);
      }
      if (body.mode === "finalize") {
        return respondJson(route, fixture.responses.finalize);
      }
      throw new Error(`Unexpected mode ${body.mode}`);
    });

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
});
