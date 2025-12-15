export type StepStatus = "pending" | "running" | "succeeded" | "failed";

export const HALT = Symbol("halt");

export type StepResult = typeof HALT | void;

export interface RecipeStep<Name extends string, Context> {
  name: Name;
  run: (context: Context) => Promise<StepResult> | StepResult;
}

export interface StepSnapshot<Name extends string> {
  name: Name;
  status: StepStatus;
  error?: unknown;
}

export interface RunOptions<Name extends string, Context> {
  onTransition?: (snapshot: StepSnapshot<Name>, context: Context) => void;
  /** Optional mapping of step names to friendly phase names */
  phaseNames?: Partial<Record<Name, string>>;
  /** Optional callback to emit phase notifications */
  onPhase?: (phaseName: string, meta?: Record<string, unknown>) => void;
}

export interface RunResult<Name extends string, Context> {
  context: Context;
  snapshots: StepSnapshot<Name>[];
}

export async function runRecipe<Name extends string, Context>(
  steps: RecipeStep<Name, Context>[],
  context: Context,
  options: RunOptions<Name, Context> = {},
): Promise<RunResult<Name, Context>> {
  const snapshots: StepSnapshot<Name>[] = steps.map((step) => ({
    name: step.name,
    status: "pending",
  }));

  for (const [index, step] of steps.entries()) {
    const snapshot = snapshots[index];

    snapshot.status = "running";

    // Emit phase start notification if this step has a phase name configured
    const phaseName =
      options.phaseNames && options.onPhase
        ? options.phaseNames[step.name]
        : undefined;
    if (phaseName && options.onPhase) {
      options.onPhase(phaseName);
    }

    options.onTransition?.({ ...snapshot }, context);

    try {
      const result = await step.run(context);
      snapshot.status = "succeeded";

      // Emit phase completion notification
      if (phaseName && options.onPhase) {
        options.onPhase(phaseName, { complete: true });
      }

      options.onTransition?.({ ...snapshot }, context);
      if (result === HALT) {
        break;
      }
    } catch (error) {
      snapshot.status = "failed";
      snapshot.error = error;

      // Emit phase failure notification
      if (phaseName && options.onPhase) {
        options.onPhase(phaseName, { complete: true, failed: true });
      }

      options.onTransition?.({ ...snapshot }, context);
      throw error;
    }
  }

  return { context, snapshots };
}
