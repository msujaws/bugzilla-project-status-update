import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { summarizeWithOpenAI } from "../../src/status/summarizer.ts";
import type { Bug, EnvLike, ProgressHooks } from "../../src/status/types.ts";

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

const makeOpenAIResponse = (bugIds: number[]) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              assessments: bugIds.map((id) => ({
                bug_id: id,
                impact_score: 5,
                short_reason: `reason for ${id}`,
                demo_suggestion: undefined,
              })),
              summary_md: `Batch summary for ${bugIds.join(",")}`,
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("summarizeWithOpenAI batching", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ content?: string }>;
        };
        const userMessage = body.messages?.[1]?.content ?? "";
        const ids = [...userMessage.matchAll(/"id":(\d+)/g)].map((m) =>
          Number(m[1]),
        );
        return makeOpenAIResponse(ids);
      });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("makes a single OpenAI call when bugs fit in one batch", async () => {
    const bugs = Array.from({ length: 5 }, (_, i) => makeBug(i + 1));
    await summarizeWithOpenAI(
      env,
      "gpt-5-mini",
      bugs,
      7,
      "normal",
      "technical",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("splits 12 bugs into 3 batches and concatenates assessments in original order", async () => {
    const bugs = Array.from({ length: 12 }, (_, i) => makeBug(i + 1));
    const result = await summarizeWithOpenAI(
      env,
      "gpt-5-mini",
      bugs,
      7,
      "normal",
      "technical",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.assessments).toHaveLength(12);
    expect(result.assessments.map((a) => a.bug_id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(result.summary_md).toContain("Batch summary");
  });

  it("emits a progress info hook before each batch", async () => {
    const infos: string[] = [];
    const hooks: ProgressHooks = { info: (msg) => infos.push(msg) };
    const bugs = Array.from({ length: 12 }, (_, i) => makeBug(i + 1));
    await summarizeWithOpenAI(
      env,
      "gpt-5-mini",
      bugs,
      7,
      "normal",
      "technical",
      { hooks },
    );
    const batchInfos = infos.filter((m) => /batch \d+\/\d+/i.test(m));
    expect(batchInfos.length).toBe(3);
    expect(batchInfos[0]).toMatch(/batch 1\/3/);
    expect(batchInfos[1]).toMatch(/batch 2\/3/);
    expect(batchInfos[2]).toMatch(/batch 3\/3/);
  });

  it("emits a determinate phase event and a progress event for every batch", async () => {
    const phaseEvents: Array<{
      name: string;
      meta?: Record<string, unknown>;
    }> = [];
    const progressEvents: Array<{
      name: string;
      current: number;
      total?: number;
    }> = [];
    const hooks: ProgressHooks = {
      phase: (name, meta) => phaseEvents.push({ name, meta }),
      progress: (name, current, total) =>
        progressEvents.push({ name, current, total }),
    };

    const bugs = Array.from({ length: 12 }, (_, i) => makeBug(i + 1));
    await summarizeWithOpenAI(
      env,
      "gpt-5-mini",
      bugs,
      7,
      "normal",
      "technical",
      { hooks },
    );

    // At least one phase event whose meta.total matches the batch count, so the
    // client switches the OpenAI progress bar to determinate.
    const determinatePhase = phaseEvents.find(
      (event) => event.meta && event.meta.total === 3,
    );
    expect(
      determinatePhase,
      "expected a phase event with total=3",
    ).toBeDefined();
    expect(determinatePhase?.name).toMatch(/AI summary|openai/i);

    // One progress event per completed batch, counting up to total.
    const phaseName = determinatePhase!.name;
    const matching = progressEvents.filter((event) => event.name === phaseName);
    expect(matching).toHaveLength(3);
    expect(matching.map((event) => event.current).toSorted()).toEqual([
      1, 2, 3,
    ]);
    for (const event of matching) {
      expect(event.total).toBe(3);
    }
  });

  it("does not emit determinate progress when bugs fit a single batch", async () => {
    const phaseEvents: Array<{
      name: string;
      meta?: Record<string, unknown>;
    }> = [];
    const progressEvents: unknown[] = [];
    const hooks: ProgressHooks = {
      phase: (name, meta) => phaseEvents.push({ name, meta }),
      progress: (name, current, total) =>
        progressEvents.push({ name, current, total }),
    };

    const bugs = Array.from({ length: 4 }, (_, i) => makeBug(i + 1));
    await summarizeWithOpenAI(
      env,
      "gpt-5-mini",
      bugs,
      7,
      "normal",
      "technical",
      { hooks },
    );

    expect(phaseEvents.some((event) => event.meta?.total)).toBe(false);
    expect(progressEvents).toHaveLength(0);
  });

  it("each batch only sees its own bug ids in the user prompt", async () => {
    const bugs = Array.from({ length: 12 }, (_, i) => makeBug(i + 1));
    await summarizeWithOpenAI(
      env,
      "gpt-5-mini",
      bugs,
      7,
      "normal",
      "technical",
    );
    const calls = fetchSpy.mock.calls;
    const idsPerCall = calls.map((call) => {
      const init = call[1] as { body?: string };
      const body = JSON.parse(init.body ?? "{}") as {
        messages?: Array<{ content?: string }>;
      };
      const userMessage = body.messages?.[1]?.content ?? "";
      return [...userMessage.matchAll(/"id":(\d+)/g)].map((m) => Number(m[1]));
    });
    const flat = idsPerCall.flat().toSorted((a, b) => a - b);
    expect(flat).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const idsInCall of idsPerCall) {
      expect(idsInCall.length).toBeLessThanOrEqual(5);
    }
  });
});
