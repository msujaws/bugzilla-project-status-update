import {
  buildBuglistLink,
  extractDemoSuggestions,
  formatSummaryOutput,
} from "../recipeHelpers.ts";
import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const formatOutputStep: RecipeStep<StatusStepName, StatusContext> = {
  name: "format-output",
  run: (ctx) => {
    const ai = ctx.openAiResponse;
    if (!ai) {
      throw new Error("OpenAI summary is missing from context");
    }

    const demo = extractDemoSuggestions(ai.assessments || []);
    const link = buildBuglistLink(ctx, ctx.ids);
    ctx.buglistLink = link;

    const { markdown, html } = formatSummaryOutput({
      summaryMd: ai.summary_md ?? "",
      demo,
      trimmedCount: ctx.trimmedCount,
      link,
    });

    ctx.html = html;
    ctx.output = ctx.format === "html" ? html : markdown;
  },
};
