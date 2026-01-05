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
    expect(j.error).toMatch(/missing OPENAI_API_KEY/i);
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

  it("oneshot mode includes debug logs payload", async () => {
    const mf = await makeMiniflare({}, { forceFallback: true });
    const r = await mf.dispatchFetch("http://local/api/status", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ days: 8, whiteboards: ["[fx-vpn]"] }),
    });
    const j = await r.json();
    expect(Array.isArray(j.logs)).toBe(true);
    expect(
      j.logs.some(
        (entry: { msg?: string }) =>
          typeof entry.msg === "string" && entry.msg.includes("Window: last"),
      ),
    ).toBe(true);
    await mf.dispose();
  });
});
