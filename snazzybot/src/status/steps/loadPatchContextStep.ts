import { loadPatchContextsForBugs } from "../patchStage.ts";
import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const loadPatchContextStep: RecipeStep<StatusStepName, StatusContext> = {
  name: "load-patch-context",
  run: async (ctx) => {
    const patchContext = await loadPatchContextsForBugs(
      ctx.env,
      ctx.aiCandidates,
      ctx.hooks,
      {
        includePatchContext: ctx.includePatchContext,
        debugLog: ctx.debugLog,
      },
    );
    ctx.patchContext = patchContext;
    if (ctx.debugLog) {
      const label =
        ctx.params.ids && ctx.params.ids.length > 0
          ? "[patch] pre-qualified run"
          : "[patch] summary run";
      ctx.debugLog(
        `${label} collected context for ${patchContext.size}/${ctx.aiCandidates.length} bug(s)`,
      );
    }
  },
};
