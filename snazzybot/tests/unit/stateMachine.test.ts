import { describe, expect, it } from "vitest";
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
});
