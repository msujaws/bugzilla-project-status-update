import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { EnvLike } from "../../src/core.ts";

const baseTime = new Date("2025-01-01T00:00:00Z");

const env: EnvLike = {
  BUGZILLA_API_KEY: "test-bz",
  OPENAI_API_KEY: "test-openai",
};

const sampleXml = `
<?xml version="1.0" encoding="UTF-8"?>
<bugzilla>
  <bug>
    <bug_id>123456</bug_id>
    <long_desc>
      <who name="Someone">dev@example.com</who>
      <bug_when>2025-01-01 00:00:00</bug_when>
      <thetext>Earlier comment</thetext>
    </long_desc>
    <long_desc>
      <who name="Pulsebot">pulsebot</who>
      <bug_when>2025-01-02 00:00:00</bug_when>
      <thetext>Landing at https://github.com/mozilla/example/commit/abcdef1234567890</thetext>
    </long_desc>
  </bug>
</bugzilla>
`;

const noPulsebotXml = `
<?xml version="1.0" encoding="UTF-8"?>
<bugzilla>
  <bug>
    <bug_id>123456</bug_id>
    <long_desc>
      <who name="SomeoneElse">dev@example.com</who>
      <bug_when>2025-01-01 00:00:00</bug_when>
      <thetext>No automation comment here.</thetext>
    </long_desc>
  </bug>
</bugzilla>
`;

const samplePatch = `From 6e83430b3c4c4f7bc3a456df530eb93d9163d6b4 Mon Sep 17 00:00:00 2001
From: Example Author <dev@example.com>
Date: Wed, 1 Jan 2025 12:34:56 +0000
Subject: [PATCH] Example fix

---
 file.txt | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

diff --git a/file.txt b/file.txt
index e69de29..4b825dc 100644
--- a/file.txt
+++ b/file.txt
@@
-old line
+new line
`;

const makeXmlResponse = (xml: string) =>
  new Response(xml, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });

const makePatchResponse = () =>
  new Response(samplePatch, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

describe("loadPatchContext", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns commit patches from pulsebot comments", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(makeXmlResponse(sampleXml));
    fetchSpy.mockResolvedValueOnce(makePatchResponse());

    const { loadPatchContext } = await import("../../src/patch.ts");

    const result = await loadPatchContext(env, 123_456);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      commitUrl: "https://github.com/mozilla/example/commit/abcdef1234567890",
      message: "Example fix",
      error: undefined,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns empty array for bugs without pulsebot comments", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(() =>
      Promise.resolve(makeXmlResponse(noPulsebotXml)),
    );

    const { loadPatchContext } = await import("../../src/patch.ts");

    const result = await loadPatchContext(env, 999_999);
    expect(result).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retains commit reference when patch download fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.includes("ctype=xml")) {
        return Promise.resolve(makeXmlResponse(sampleXml));
      }
      return Promise.resolve(
        new Response("Not found", {
          status: 404,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      );
    });

    const { loadPatchContext } = await import("../../src/patch.ts");
    const res = await loadPatchContext(env, 42);
    expect(res).toHaveLength(1);
    expect(res[0]?.commitUrl).toBe(
      "https://github.com/mozilla/example/commit/abcdef1234567890",
    );
    expect(res[0]?.error).toMatch(/404/);
    expect(res[0]?.patch).toBe("");
  });
});
