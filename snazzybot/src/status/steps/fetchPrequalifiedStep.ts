import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const fetchPrequalifiedStep: RecipeStep<StatusStepName, StatusContext> =
  {
    name: "fetch-prequalified",
    run: async (ctx) => {
      const ids = ctx.params.ids ?? [];
      ctx.ids = [...ids];
      ctx.hooks.info?.(`Summarizing ${ids.length} pre-qualified bugs…`);
      const bugs = await ctx.client.fetchBugsByIds(ids, undefined, {
        filterResolved: false,
      });
      ctx.providedBugs = bugs;
      ctx.finalBugs = bugs;
    },
  };
