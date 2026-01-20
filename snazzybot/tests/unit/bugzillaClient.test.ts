import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BugzillaClient } from "../../src/status/bugzillaClient.ts";
import type { EnvLike, ProgressHooks } from "../../src/status/types.ts";

describe("BugzillaClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let capturedUrls: URL[] = [];

  const mockEnv: EnvLike = {
    BUGZILLA_API_KEY: "test-api-key",
    BUGZILLA_HOST: "https://bugzilla.mozilla.org",
    SNAZZY_SKIP_CACHE: "1", // Skip caching for tests
  };

  const emptyHooks: ProgressHooks = {};

  beforeEach(() => {
    capturedUrls = [];
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(input as string);
        capturedUrls.push(url);
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
});
