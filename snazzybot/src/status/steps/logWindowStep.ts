import { logWindowContext } from "../recipeHelpers.ts";
import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const logWindowStep: RecipeStep<StatusStepName, StatusContext> = {
  name: "log-window",
  run: (ctx) => {
    logWindowContext(
      ctx.hooks,
      ctx.sinceISO,
      ctx.days,
      ctx.components.map((pc) =>
        pc.component ? `${pc.product}:${pc.component}` : pc.product,
      ),
      ctx.whiteboards,
      ctx.metabugs,
      ctx.assignees,
    );
  },
};
