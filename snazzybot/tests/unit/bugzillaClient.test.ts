import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BugzillaClient } from "../../src/status/bugzillaClient.ts";
import type { EnvLike, ProgressHooks } from "../../src/status/types.ts";

describe("BugzillaClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let capturedUrls: URL[] = [];
  let capturedHeaders: Headers[] = [];

  const mockEnv: EnvLike = {
    BUGZILLA_API_KEY: "test-api-key",
    BUGZILLA_HOST: "https://bugzilla.mozilla.org",
    SNAZZY_SKIP_CACHE: "1", // Skip caching for tests
  };

  const emptyHooks: ProgressHooks = {};

  beforeEach(() => {
    capturedUrls = [];
    capturedHeaders = [];
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(input as string);
        capturedUrls.push(url);
        if (init?.headers) {
          capturedHeaders.push(
            new Headers(init.headers as Record<string, string>),
          );
        }
        return new Response(JSON.stringify({ bugs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("fetchBugsByWhiteboards", () => {
    it("should use chfield=resolution and chfieldfrom for temporal filtering", async () => {
      const client = new BugzillaClient(mockEnv);
      const sinceISO = "2026-01-13T00:00:00.000Z";

      await client.fetchBugsByWhiteboards(["[test-tag]"], sinceISO, emptyHooks);

      expect(capturedUrls).toHaveLength(1);
      const url = capturedUrls[0];

      // Should use chfield/chfieldfrom for resolution-specific filtering
      expect(url.searchParams.get("chfield")).toBe("resolution");
      expect(url.searchParams.get("chfieldfrom")).toBe(sinceISO);

      // Should NOT use last_change_time (which matches any change)
      expect(url.searchParams.has("last_change_time")).toBe(false);
    });
  });

  describe("fetchBugsByComponents", () => {
    it("should use chfield=resolution and chfieldfrom for temporal filtering", async () => {
      const client = new BugzillaClient(mockEnv);
      const sinceISO = "2026-01-13T00:00:00.000Z";

      await client.fetchBugsByComponents(
        [{ product: "Firefox", component: "General" }],
        sinceISO,
      );

      expect(capturedUrls).toHaveLength(1);
      const url = capturedUrls[0];

      expect(url.searchParams.get("chfield")).toBe("resolution");
      expect(url.searchParams.get("chfieldfrom")).toBe(sinceISO);
      expect(url.searchParams.has("last_change_time")).toBe(false);
    });
  });

  describe("fetchBugsByAssignees", () => {
    it("should use chfield=resolution and chfieldfrom for temporal filtering", async () => {
      const client = new BugzillaClient(mockEnv);
      const sinceISO = "2026-01-13T00:00:00.000Z";

      await client.fetchBugsByAssignees(["dev@example.com"], sinceISO);

      expect(capturedUrls).toHaveLength(1);
      const url = capturedUrls[0];

      expect(url.searchParams.get("chfield")).toBe("resolution");
      expect(url.searchParams.get("chfieldfrom")).toBe(sinceISO);
      expect(url.searchParams.has("last_change_time")).toBe(false);
    });
  });

  describe("fetchBugsByIds", () => {
    it("should fetch multiple chunks in parallel", async () => {
      const requestTimes: { chunk: string; start: number; end: number }[] = [];

      fetchSpy.mockImplementation(async (input) => {
        const url = new URL(input as string);
        const ids = url.searchParams.get("id") || "";

        const start = Date.now();
        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 50));
        const end = Date.now();

        requestTimes.push({ chunk: ids, start, end });

        const bugIds = ids.split(",").map(Number);
        return new Response(
          JSON.stringify({
            bugs: bugIds.map((id) => ({
              id,
              summary: `Bug ${id}`,
              status: "RESOLVED",
              resolution: "FIXED",
            })),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      });

      const client = new BugzillaClient(mockEnv);

      // Create 900 IDs - this will require 3 chunks of 300
      const ids = Array.from({ length: 900 }, (_, i) => i + 1);

      vi.useRealTimers(); // Need real timers for parallel timing test

      const bugs = await client.fetchBugsByIds(ids);

      expect(bugs).toHaveLength(900);
      expect(requestTimes).toHaveLength(3); // 3 chunks

      // Verify requests overlapped (parallel execution)
      // With sequential execution, 3 chunks × 50ms = 150ms+
      // With parallel execution, they should overlap significantly
      const firstStart = Math.min(...requestTimes.map((r) => r.start));
      const lastEnd = Math.max(...requestTimes.map((r) => r.end));
      const totalDuration = lastEnd - firstStart;

      // If parallel, should complete in ~50-80ms; if sequential, ~150ms+
      expect(totalDuration).toBeLessThan(120);

      vi.useFakeTimers();
    });
  });

  describe("API key handling", () => {
    it("should send API key via X-BUGZILLA-API-KEY header, not in URL", async () => {
      const client = new BugzillaClient(mockEnv);

      await client.fetchBugsByWhiteboards(["[test]"], "2026-01-01", emptyHooks);

      expect(capturedUrls).toHaveLength(1);
      const url = capturedUrls[0];

      // API key should NOT be in URL query params
      expect(url.searchParams.has("api_key")).toBe(false);
      expect(url.toString()).not.toContain("test-api-key");

      // API key should be in header
      expect(capturedHeaders).toHaveLength(1);
      expect(capturedHeaders[0].get("X-BUGZILLA-API-KEY")).toBe("test-api-key");
    });

    it("should not expose API key in cache keys", async () => {
      const client = new BugzillaClient(mockEnv);

      await client.fetchBugsByWhiteboards(["[test]"], "2026-01-01", emptyHooks);

      // The URL used for caching should not contain the API key
      expect(capturedUrls[0].toString()).not.toContain("api_key");
      expect(capturedUrls[0].toString()).not.toContain("test-api-key");
    });
  });
});
