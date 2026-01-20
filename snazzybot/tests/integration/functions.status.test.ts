import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMiniflare } from "../utils/miniflare";

describe("functions/api/status.ts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2025-10-29T09:36:11Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 500 when env keys missing", async () => {
    const mf = await makeMiniflare(
      {
        OPENAI_API_KEY: "",
        BUGZILLA_API_KEY: "",
      },
      { forceFallback: true },
    );
    const r = await mf.dispatchFetch("http://local/api/status", {
      method: "POST",
      body: "{}",
    });
    expect(r.status).toBe(500);
    const j = await r.json();
    expect(j.error).toMatch(/server configuration error/i);
    await mf.dispose();
  });

  it("oneshot mode returns output with link", async () => {
    const mf = await makeMiniflare({}, { forceFallback: true });
    const r = await mf.dispatchFetch("http://local/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        days: 8,
        format: "md",
        whiteboards: ["[fx-vpn]"],
      }),
    });
    const j = await r.json();
    expect(j.output).toMatch(/View bugs in Bugzilla/);
    await mf.dispose();
  });

  it("paging protocol: discover → page → finalize", async () => {
    const mf = await makeMiniflare({}, { forceFallback: true });
    const discover = await mf.dispatchFetch("http://local/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "discover",
        days: 8,
        whiteboards: ["[fx-vpn]"],
      }),
    });
    const d = await discover.json();
    expect(d.total).toBeGreaterThan(0);

    const page = await mf.dispatchFetch("http://local/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "page",
        cursor: 0,
        pageSize: 35,
        days: 8,
        whiteboards: ["[fx-vpn]"],
      }),
    });
    const p = await page.json();
    expect(p.qualifiedIds.length).toBeGreaterThan(0);

    const finalize = await mf.dispatchFetch("http://local/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "finalize",
        ids: p.qualifiedIds,
        format: "md",
        whiteboards: ["[fx-vpn]"],
      }),
    });
    const f = await finalize.json();
    expect(f.output).toMatch(/View bugs in Bugzilla/);
    await mf.dispose();
  });

  it("streaming NDJSON emits start → phase/progress → done", async () => {
    const mf = await makeMiniflare({}, { forceFallback: true });
    const r = await mf.dispatchFetch("http://local/api/status?stream=1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/x-ndjson",
      },
      body: JSON.stringify({ days: 8, whiteboards: ["[fx-vpn]"] }),
    });
    const text = await r.text();
    const lines = text
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(lines[0].kind).toBe("start");
    expect(
      lines.some(
        (l) => l.kind === "phase" && l.name === "Generating AI summary",
      ),
    ).toBe(true);
    expect(lines.at(-1)?.kind).toBe("done");
    await mf.dispose();
  });

  describe("CSRF protection", () => {
    it("allows requests without Origin header", async () => {
      const mf = await makeMiniflare({}, { forceFallback: true });
      const r = await mf.dispatchFetch("http://local/api/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: 7, whiteboards: ["[fx-vpn]"] }),
      });
      // Should not be rejected for CSRF (may be 200 or other status, but not 403)
      expect(r.status).not.toBe(403);
      await mf.dispose();
    });

    it("allows same-origin requests", async () => {
      const mf = await makeMiniflare({}, { forceFallback: true });
      const r = await mf.dispatchFetch("http://local/api/status", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: "http://local",
        },
        body: JSON.stringify({ days: 7, whiteboards: ["[fx-vpn]"] }),
      });
      expect(r.status).not.toBe(403);
      await mf.dispose();
    });

    it("rejects cross-origin requests", async () => {
      const mf = await makeMiniflare({}, { forceFallback: true });
      const r = await mf.dispatchFetch("http://local/api/status", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: "http://evil.com",
        },
        body: JSON.stringify({ days: 7, whiteboards: ["[fx-vpn]"] }),
      });
      expect(r.status).toBe(403);
      const j = await r.json();
      expect(j.error).toMatch(/cross-origin/i);
      await mf.dispose();
    });

    it("rejects invalid Origin header", async () => {
      const mf = await makeMiniflare({}, { forceFallback: true });
      const r = await mf.dispatchFetch("http://local/api/status", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: "not-a-valid-url",
        },
        body: JSON.stringify({ days: 7, whiteboards: ["[fx-vpn]"] }),
      });
      expect(r.status).toBe(403);
      const j = await r.json();
      expect(j.error).toMatch(/invalid origin/i);
      await mf.dispose();
    });
  });

  describe("input validation", () => {
    it("rejects arrays exceeding max length", async () => {
      const mf = await makeMiniflare({}, { forceFallback: true });
      const r = await mf.dispatchFetch("http://local/api/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // MAX_ARRAY_LENGTH is 100, so 101 should fail
          components: Array.from({ length: 101 }, (_, i) => `component-${i}`),
          days: 7,
        }),
      });
      expect(r.status).toBe(400);
      const j = await r.json();
      expect(j.error).toMatch(/array exceeds maximum/i);
      await mf.dispose();
    });

    it("rejects strings exceeding max length", async () => {
      const mf = await makeMiniflare({}, { forceFallback: true });
      const r = await mf.dispatchFetch("http://local/api/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // MAX_STRING_LENGTH is 500, so 501 chars should fail
          components: ["a".repeat(501)],
          days: 7,
        }),
      });
      expect(r.status).toBe(400);
      const j = await r.json();
      expect(j.error).toMatch(/string exceeds maximum/i);
      await mf.dispose();
    });

    it("rejects days outside valid range", async () => {
      const mf = await makeMiniflare({}, { forceFallback: true });
      const r = await mf.dispatchFetch("http://local/api/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          components: ["Firefox"],
          days: 366, // MAX_DAYS is 365
        }),
      });
      expect(r.status).toBe(400);
      const j = await r.json();
      expect(j.error).toMatch(/days must be between/i);
      await mf.dispose();
    });

    it("rejects pageSize outside valid range", async () => {
      const mf = await makeMiniflare({}, { forceFallback: true });
      const r = await mf.dispatchFetch("http://local/api/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "page",
          components: ["Firefox"],
          pageSize: 1001, // MAX_PAGE_SIZE is 1000
        }),
      });
      expect(r.status).toBe(400);
      const j = await r.json();
      expect(j.error).toMatch(/pageSize must be between/i);
      await mf.dispose();
    });

    it("rejects invalid mode values", async () => {
      const mf = await makeMiniflare({}, { forceFallback: true });
      const r = await mf.dispatchFetch("http://local/api/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "invalid-mode",
          components: ["Firefox"],
        }),
      });
      expect(r.status).toBe(400);
      const j = await r.json();
      expect(j.error).toMatch(/invalid mode/i);
      await mf.dispose();
    });

    it("accepts valid input within limits", async () => {
      const mf = await makeMiniflare({}, { forceFallback: true });
      const r = await mf.dispatchFetch("http://local/api/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          components: ["Firefox", "DevTools"],
          days: 30,
          mode: "oneshot",
        }),
      });
      // Should not return 400 validation error
      expect(r.status).not.toBe(400);
      await mf.dispose();
    });
  });
});
