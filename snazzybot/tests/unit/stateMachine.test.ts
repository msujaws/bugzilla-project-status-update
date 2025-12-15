import { describe, expect, it, vi } from "vitest";
import {
  HALT,
  runRecipe,
  type RecipeStep,
} from "../../src/status/stateMachine.ts";

describe("state machine utility", () => {
  it("runs steps in order and returns snapshots", async () => {
    type Ctx = { count: number; order: string[] };
    type StepName = "increment" | "double";
    const context: Ctx = { count: 1, order: [] };
    const steps: RecipeStep<StepName, Ctx>[] = [
      {
        name: "increment",
        run: (ctx) => {
          ctx.count += 1;
          ctx.order.push("increment");
        },
      },
      {
        name: "double",
        run: (ctx) => {
          ctx.count *= 2;
          ctx.order.push("double");
        },
      },
    ];

    const { snapshots } = await runRecipe(steps, context);

    expect(context.count).toBe(4);
    expect(context.order).toEqual(["increment", "double"]);
    expect(snapshots.map((snap) => snap.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
  });

  it("halts execution when a step returns HALT", async () => {
    type StepName = "first" | "second";
    const context = { calls: [] as string[] };
    const steps: RecipeStep<StepName, typeof context>[] = [
      {
        name: "first",
        run: (ctx) => {
          ctx.calls.push("first");
          return HALT;
        },
      },
      {
        name: "second",
        run: (ctx) => {
          ctx.calls.push("second");
        },
      },
    ];

    const { snapshots } = await runRecipe(steps, context);

    expect(context.calls).toEqual(["first"]);
    expect(snapshots[0].status).toBe("succeeded");
    expect(snapshots[1].status).toBe("pending");
  });

  it("records failures and surfaces the thrown error", async () => {
    type StepName = "ok" | "boom" | "skip";
    const context = { count: 0 };
    const transitions: Array<{ name: StepName; status: string }> = [];

    const steps: RecipeStep<StepName, typeof context>[] = [
      {
        name: "ok",
        run: (ctx) => {
          ctx.count = 1;
        },
      },
      {
        name: "boom",
        run: () => {
          throw new Error("fail");
        },
      },
      {
        name: "skip",
        run: (ctx) => {
          ctx.count = 99;
        },
      },
    ];

    await expect(
      runRecipe(steps, context, {
        onTransition: (snapshot) => {
          transitions.push({ name: snapshot.name, status: snapshot.status });
        },
      }),
    ).rejects.toThrow("fail");

    expect(context.count).toBe(1);
    expect(transitions).toEqual([
      { name: "ok", status: "running" },
      { name: "ok", status: "succeeded" },
      { name: "boom", status: "running" },
      { name: "boom", status: "failed" },
    ]);
  });

  it("emits phases for steps with configured phase names", async () => {
    type StepName = "step-a" | "step-b" | "step-c";
    const context = { value: 0 };
    const phaseEmissions: Array<{
      name: string;
      meta?: Record<string, unknown>;
    }> = [];

    const steps: RecipeStep<StepName, typeof context>[] = [
      {
        name: "step-a",
        run: (ctx) => {
          ctx.value += 1;
        },
      },
      {
        name: "step-b",
        run: (ctx) => {
          ctx.value += 2;
        },
      },
      {
        name: "step-c",
        run: (ctx) => {
          ctx.value += 3;
        },
      },
    ];

    await runRecipe(steps, context, {
      phaseNames: {
        "step-a": "Phase A",
        "step-b": "Phase B",
        // step-c intentionally omitted - should not emit
      },
      onPhase: (phaseName, meta) => {
        phaseEmissions.push({ name: phaseName, meta });
      },
    });

    expect(context.value).toBe(6);
    expect(phaseEmissions).toEqual([
      { name: "Phase A", meta: undefined },
      { name: "Phase A", meta: { complete: true } },
      { name: "Phase B", meta: undefined },
      { name: "Phase B", meta: { complete: true } },
    ]);
  });

  it("does not emit phases when phaseNames is not provided", async () => {
    type StepName = "step-a";
    const context = { value: 0 };
    const onPhaseMock = vi.fn();

    const steps: RecipeStep<StepName, typeof context>[] = [
      {
        name: "step-a",
        run: (ctx) => {
          ctx.value = 42;
        },
      },
    ];

    await runRecipe(steps, context, {
      onPhase: onPhaseMock,
    });

    expect(context.value).toBe(42);
    expect(onPhaseMock).not.toHaveBeenCalled();
  });

  it("does not emit phases when onPhase is not provided", async () => {
    type StepName = "step-a";
    const context = { value: 0 };

    const steps: RecipeStep<StepName, typeof context>[] = [
      {
        name: "step-a",
        run: (ctx) => {
          ctx.value = 42;
        },
      },
    ];

    // Should not throw even though we provide phaseNames without onPhase
    await expect(
      runRecipe(steps, context, {
        phaseNames: {
          "step-a": "Phase A",
        },
      }),
    ).resolves.toBeDefined();

    expect(context.value).toBe(42);
  });

  it("emits phases before onTransition when step starts running", async () => {
    type StepName = "tracked-step";
    const context = { value: 0 };
    const emissions: Array<{
      type: string;
      data: string;
      complete?: boolean;
    }> = [];

    const steps: RecipeStep<StepName, typeof context>[] = [
      {
        name: "tracked-step",
        run: (ctx) => {
          ctx.value = 100;
        },
      },
    ];

    await runRecipe(steps, context, {
      phaseNames: {
        "tracked-step": "Tracked Phase",
      },
      onPhase: (phaseName, meta) => {
        emissions.push({
          type: "phase",
          data: phaseName,
          complete: meta?.complete as boolean | undefined,
        });
      },
      onTransition: (snapshot) => {
        emissions.push({ type: "transition", data: snapshot.status });
      },
    });

    expect(context.value).toBe(100);
    expect(emissions).toEqual([
      { type: "phase", data: "Tracked Phase", complete: undefined },
      { type: "transition", data: "running" },
      { type: "phase", data: "Tracked Phase", complete: true },
      { type: "transition", data: "succeeded" },
    ]);
  });

  it("does not emit phase when step is halted before starting", async () => {
    type StepName = "first" | "second";
    const context = { calls: [] as string[] };
    const phaseEmissions: Array<{
      name: string;
      complete?: boolean;
    }> = [];

    const steps: RecipeStep<StepName, typeof context>[] = [
      {
        name: "first",
        run: (ctx) => {
          ctx.calls.push("first");
          return HALT;
        },
      },
      {
        name: "second",
        run: (ctx) => {
          ctx.calls.push("second");
        },
      },
    ];

    await runRecipe(steps, context, {
      phaseNames: {
        first: "First Phase",
        second: "Second Phase",
      },
      onPhase: (phaseName, meta) => {
        phaseEmissions.push({
          name: phaseName,
          complete: meta?.complete as boolean | undefined,
        });
      },
    });

    expect(context.calls).toEqual(["first"]);
    // Only first phase should be emitted (start + complete), second step never runs
    expect(phaseEmissions).toEqual([
      { name: "First Phase", complete: undefined },
      { name: "First Phase", complete: true },
    ]);
  });

  it("emits phase even when step fails", async () => {
    type StepName = "failing-step";
    const context = { value: 0 };
    const phaseEmissions: Array<{
      name: string;
      complete?: boolean;
      failed?: boolean;
    }> = [];

    const steps: RecipeStep<StepName, typeof context>[] = [
      {
        name: "failing-step",
        run: () => {
          throw new Error("intentional failure");
        },
      },
    ];

    await expect(
      runRecipe(steps, context, {
        phaseNames: {
          "failing-step": "Failing Phase",
        },
        onPhase: (phaseName, meta) => {
          phaseEmissions.push({
            name: phaseName,
            complete: meta?.complete as boolean | undefined,
            failed: meta?.failed as boolean | undefined,
          });
        },
      }),
    ).rejects.toThrow("intentional failure");

    // Phase should be emitted with start and failure completion
    expect(phaseEmissions).toEqual([
      { name: "Failing Phase", complete: undefined, failed: undefined },
      { name: "Failing Phase", complete: true, failed: true },
    ]);
  });
});
