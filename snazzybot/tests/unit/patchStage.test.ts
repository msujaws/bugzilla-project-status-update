import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Bug, EnvLike } from "../../src/core.ts";

const env: EnvLike = {
  BUGZILLA_API_KEY: "test-bz",
  OPENAI_API_KEY: "test-openai",
};

const makeBug = (id: number): Bug => ({
  id,
  summary: `Bug ${id}`,
  product: "TestProduct",
  component: "TestComponent",
  status: "RESOLVED",
  resolution: "FIXED",
  last_change_time: "2025-01-01T00:00:00Z",
});

describe("loadPatchContextsForBugs", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caps patch-context fetches at 8 concurrent in-flight calls", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    vi.doMock("../../src/patch.ts", () => ({
      loadPatchContext: vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return [];
      }),
    }));

    const { loadPatchContextsForBugs } = await import(
      "../../src/status/patchStage.ts"
    );

    const bugs = Array.from({ length: 32 }, (_, index) => makeBug(index + 1));
    await loadPatchContextsForBugs(
      env,
      bugs,
      {},
      { includePatchContext: true },
    );

    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("still processes every bug when concurrency is capped", async () => {
    const seen = new Set<number>();

    vi.doMock("../../src/patch.ts", () => ({
      loadPatchContext: vi.fn(async (_env: EnvLike, bugId: number) => {
        seen.add(bugId);
        return [];
      }),
    }));

    const { loadPatchContextsForBugs } = await import(
      "../../src/status/patchStage.ts"
    );

    const bugs = Array.from({ length: 20 }, (_, index) => makeBug(index + 1));
    await loadPatchContextsForBugs(
      env,
      bugs,
      {},
      { includePatchContext: true },
    );

    expect(seen.size).toBe(20);
  });

  it("does not block the pool when one bug rejects", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    vi.doMock("../../src/patch.ts", () => ({
      loadPatchContext: vi.fn(async (_env: EnvLike, bugId: number) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        if (bugId % 3 === 0) {
          throw new Error(`fail bug ${bugId}`);
        }
        return [];
      }),
    }));

    const { loadPatchContextsForBugs } = await import(
      "../../src/status/patchStage.ts"
    );

    const bugs = Array.from({ length: 16 }, (_, index) => makeBug(index + 1));
    await loadPatchContextsForBugs(
      env,
      bugs,
      {},
      { includePatchContext: true },
    );

    expect(maxInFlight).toBeLessThanOrEqual(8);
  });
});
