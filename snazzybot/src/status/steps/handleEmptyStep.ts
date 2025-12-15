import { HALT, type RecipeStep } from "../stateMachine.ts";
import { buildEmptySummary } from "../recipeHelpers.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const handleEmptyStep: RecipeStep<StatusStepName, StatusContext> = {
  name: "handle-empty",
  run: (ctx) => {
    // If there are Bugzilla bugs, continue
    if (ctx.finalBugs.length > 0) return;

    // If there are GitHub contributors, continue (even with no Bugzilla bugs)
    if (ctx.githubContributors.size > 0) {
      ctx.hooks.info?.(
        `No Bugzilla bugs found, but found ${ctx.githubContributors.size} GitHub contributors`,
      );
      return;
    }

    // No Bugzilla bugs and no GitHub activity - halt with empty summary
    const { link, markdownBody, htmlBody } = buildEmptySummary(ctx);
    ctx.buglistLink = link;
    ctx.output = ctx.format === "html" ? htmlBody : markdownBody;
    ctx.html = htmlBody;
    ctx.ids = [];
    if (ctx.debugLog)
      ctx.debugLog(`buglist link for manual inspection: ${link}`, {
        always: true,
      });
    return HALT;
  },
};
