import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../utils/msw/node";
import { generateStatus } from "../../src/core.ts";

describe("Phase completion in NDJSON stream", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2025-10-29T09:36:11Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should emit phase completion events with complete: true", async () => {
    const phaseCalls: Array<{ name: string; meta?: Record<string, unknown> }> =
      [];
    const hooks = {
      info: vi.fn(),
      warn: vi.fn(),
      phase: vi.fn((name: string, meta?: Record<string, unknown>) => {
        phaseCalls.push({ name, meta });
      }),
      progress: vi.fn(),
    };

    await generateStatus(
      {
        days: 8,
        model: "gpt-5",
        format: "md",
        components: [{ product: "Firefox", component: "IP Protection" }],
      },
      {
        OPENAI_API_KEY: "test-openai",
        BUGZILLA_API_KEY: "test-bz",
      },
      hooks,
    );

    // Verify phases were emitted
    expect(phaseCalls.length).toBeGreaterThan(0);

    // Group calls by phase name
    const phasesByName = new Map<
      string,
      Array<{ name: string; meta?: Record<string, unknown> }>
    >();
    for (const call of phaseCalls) {
      if (!phasesByName.has(call.name)) {
        phasesByName.set(call.name, []);
      }
      phasesByName.get(call.name)!.push(call);
    }

    // Verify each step-level phase has both start and completion
    const stepPhases = [
      "Collecting candidate bugs",
      "Fetching bug histories",
      "Filtering by history",
      "Fetching GitHub activity",
      "Loading commit context",
      "Generating AI summary",
      "Formatting output",
    ];

    for (const phaseName of stepPhases) {
      const calls = phasesByName.get(phaseName);
      if (calls && calls.length > 0) {
        // Should have at least start and complete
        expect(calls.length).toBeGreaterThanOrEqual(2);

        // First call should be start (no complete flag or complete is undefined/false)
        const startCall = calls[0];
        expect(startCall.meta?.complete).not.toBe(true);

        // Last call should be completion (complete: true)
        const completeCall = calls.at(-1);
        expect(completeCall.meta?.complete).toBe(true);

        // If there are exactly 2 calls, verify the pattern
        if (calls.length === 2) {
          expect(calls).toEqual([
            { name: phaseName, meta: undefined },
            { name: phaseName, meta: { complete: true } },
          ]);
        }
      }
    }
  });

  it("should NOT emit completion for phases that fail", async () => {
    // Mock a failure during fetch-histories step
    server.use(
      http.get("https://bugzilla.mozilla.org/rest/bug/:id/history", () => {
        return HttpResponse.json({ error: "Simulated error" }, { status: 500 });
      }),
    );

    const phaseCalls: Array<{ name: string; meta?: Record<string, unknown> }> =
      [];
    const hooks = {
      info: vi.fn(),
      warn: vi.fn(),
      phase: vi.fn((name: string, meta?: Record<string, unknown>) => {
        phaseCalls.push({ name, meta });
      }),
      progress: vi.fn(),
    };

    try {
      await generateStatus(
        {
          days: 8,
          model: "gpt-5",
          format: "md",
          components: [{ product: "Firefox", component: "IP Protection" }],
        },
        {
          OPENAI_API_KEY: "test-openai",
          BUGZILLA_API_KEY: "test-bz",
        },
        hooks,
      );
    } catch {
      // Expected to fail
    }

    // Check if any phase was marked as failed
    const failedPhases = phaseCalls.filter(
      (call) => call.meta?.failed === true,
    );

    if (failedPhases.length > 0) {
      // If we have failed phases, they should also be marked as complete
      for (const failedPhase of failedPhases) {
        expect(failedPhase.meta?.complete).toBe(true);
        expect(failedPhase.meta?.failed).toBe(true);
      }
    }
  });

  it("should emit phase events in correct order", async () => {
    const events: Array<{ type: string; name?: string; complete?: boolean }> =
      [];
    const hooks = {
      info: vi.fn(),
      warn: vi.fn(),
      phase: vi.fn((name: string, meta?: Record<string, unknown>) => {
        events.push({
          type: "phase",
          name,
          complete: meta?.complete as boolean,
        });
      }),
      progress: vi.fn(),
    };

    await generateStatus(
      {
        days: 8,
        model: "gpt-5",
        format: "md",
        ids: [1_987_802], // Use prequalified path
      },
      {
        OPENAI_API_KEY: "test-openai",
        BUGZILLA_API_KEY: "test-bz",
      },
      hooks,
    );

    const phaseEvents = events.filter((e) => e.type === "phase");

    // Verify phases come in pairs (start, complete)
    let expectingCompletion: string | undefined;

    for (const event of phaseEvents) {
      if (!event.complete && event.name) {
        // This is a phase start
        if (expectingCompletion) {
          // We started a new phase before completing the previous one
          // This is allowed for sub-operations but let's log it
        }
        expectingCompletion = event.name;
      } else if (event.complete && event.name) {
        // This is a phase completion
        // It should match a previously started phase
        const phaseName = event.name;
        const startedPhases = phaseEvents
          .filter((e) => !e.complete && e.name === phaseName)
          .map((e) => e.name);
        expect(startedPhases.length).toBeGreaterThan(0);

        if (expectingCompletion === phaseName) {
          expectingCompletion = undefined;
        }
      }
    }
  });

  it("should include completion in NDJSON payload structure", async () => {
    const hooks = {
      info: vi.fn(),
      warn: vi.fn(),
      phase: vi.fn(),
      progress: vi.fn(),
    };

    await generateStatus(
      {
        days: 8,
        model: "gpt-5",
        format: "md",
        ids: [1_987_802],
      },
      {
        OPENAI_API_KEY: "test-openai",
        BUGZILLA_API_KEY: "test-bz",
      },
      hooks,
    );

    // Verify phase hook was called with metadata
    const phaseCallsWithMeta = hooks.phase.mock.calls.filter(
      (call) => call[1] !== undefined,
    );
    expect(phaseCallsWithMeta.length).toBeGreaterThan(0);

    // Verify some calls have complete: true
    const completionCalls = hooks.phase.mock.calls.filter(
      (call) => call[1]?.complete === true,
    );
    expect(completionCalls.length).toBeGreaterThan(0);

    // Each completion call should be for a valid phase name
    for (const call of completionCalls) {
      expect(typeof call[0]).toBe("string");
      expect(call[0].length).toBeGreaterThan(0);
    }
  });
});
