import { summarizeWithOpenAIAndTrack } from "../recipeHelpers.ts";
import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const summarizeOpenAiStep: RecipeStep<StatusStepName, StatusContext> = {
  name: "summarize-openai",
  run: async (ctx) => {
    const ai = await summarizeWithOpenAIAndTrack(ctx, ctx.aiCandidates);
    ctx.openAiResponse = ai;
  },
};
