import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { summarizeWithOpenAI } from "../../src/status/summarizer.ts";
import type { Bug, EnvLike } from "../../src/status/types.ts";

const env: EnvLike = {
  BUGZILLA_API_KEY: "test-bz",
  OPENAI_API_KEY: "test-openai",
};

const sampleBug: Bug = {
  id: 12_345,
  summary: "Sample bug",
  product: "TestProduct",
  component: "TestComponent",
  status: "RESOLVED",
  resolution: "FIXED",
  last_change_time: "2025-01-01T00:00:00Z",
};

describe("summarizeWithOpenAI timeout", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ assessments: [], summary_md: "ok" }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("passes an AbortSignal to the OpenAI fetch so the request can time out", async () => {
    await summarizeWithOpenAI(
      env,
      "gpt-5-mini",
      [sampleBug],
      7,
      "normal",
      "technical",
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as { signal?: unknown };
    expect(init.signal).toBeDefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("translates a TimeoutError (from AbortSignal.timeout) into a human-readable timeout error", async () => {
    fetchSpy.mockRestore();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      // AbortSignal.timeout() throws DOMException with name "TimeoutError"
      // (per the WHATWG spec) — not "AbortError" like manual abort().
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      return Promise.reject(error);
    });

    await expect(
      summarizeWithOpenAI(
        env,
        "gpt-5-mini",
        [sampleBug],
        7,
        "normal",
        "technical",
      ),
    ).rejects.toThrow(/OpenAI request timed out/i);
  });

  it("also recognizes manual AbortError as a timeout", async () => {
    fetchSpy.mockRestore();
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });

    await expect(
      summarizeWithOpenAI(
        env,
        "gpt-5-mini",
        [sampleBug],
        7,
        "normal",
        "technical",
      ),
    ).rejects.toThrow(/OpenAI request timed out/i);
  });
});
