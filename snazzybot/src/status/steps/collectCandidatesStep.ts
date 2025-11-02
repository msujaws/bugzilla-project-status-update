import { collectCandidates } from "../candidateCollector.ts";
import { summarizeCandidateReasons } from "../recipeHelpers.ts";
import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const collectCandidatesStep: RecipeStep<StatusStepName, StatusContext> =
  {
    name: "collect-candidates",
    run: async (ctx) => {
      const collection = await collectCandidates(
        ctx.client,
        ctx.hooks,
        ctx.sinceISO,
        {
          components: ctx.components,
          whiteboards: ctx.whiteboards,
          metabugs: ctx.metabugs,
          assignees: ctx.assignees,
          debugLog: ctx.debugLog,
        },
      );
      ctx.collection = collection;
      ctx.candidates = collection.candidates;
      summarizeCandidateReasons(collection, ctx.debugLog);
    },
  };
