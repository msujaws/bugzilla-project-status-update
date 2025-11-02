import { HALT, type RecipeStep } from "../stateMachine.ts";
import { buildEmptySummary } from "../recipeHelpers.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const handleEmptyStep: RecipeStep<StatusStepName, StatusContext> = {
  name: "handle-empty",
  run: (ctx) => {
    if (ctx.finalBugs.length > 0) return;
    const { link, markdownBody, htmlBody } = buildEmptySummary(ctx);
    ctx.buglistLink = link;
    ctx.output = ctx.format === "html" ? htmlBody : markdownBody;
    ctx.html = htmlBody;
    ctx.ids = [];
    if (ctx.debugLog)
      ctx.debugLog(`buglist link for manual inspection: ${link}`);
    return HALT;
  },
};
