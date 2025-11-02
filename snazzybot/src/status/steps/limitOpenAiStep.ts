import {
  MAX_BUGS_FOR_OPENAI,
  type StatusContext,
  type StatusStepName,
} from "../context.ts";
import type { RecipeStep } from "../stateMachine.ts";

export const limitOpenAiStep: RecipeStep<StatusStepName, StatusContext> = {
  name: "limit-openai",
  run: (ctx) => {
    const final = ctx.finalBugs;
    ctx.trimmedCount = 0;
    ctx.aiCandidates = final;
    if (final.length > MAX_BUGS_FOR_OPENAI) {
      ctx.trimmedCount = final.length - MAX_BUGS_FOR_OPENAI;
      ctx.hooks.warn?.(
        `Trimming ${ctx.trimmedCount} bug(s) before OpenAI call to stay within token limits`,
      );
      ctx.aiCandidates = final.slice(0, MAX_BUGS_FOR_OPENAI);
      if (ctx.debugLog) {
        ctx.debugLog(
          `OpenAI candidate IDs (trimmed to ${MAX_BUGS_FOR_OPENAI}): ${ctx.aiCandidates
            .slice(0, 30)
            .map((bug) => bug.id)
            .join(", ")}${final.length > 30 ? " …" : ""}`,
        );
      }
    } else if (ctx.debugLog) {
      ctx.debugLog(
        `OpenAI candidate IDs (${ctx.aiCandidates.length}): ${ctx.aiCandidates
          .slice(0, 30)
          .map((bug) => bug.id)
          .join(", ")}${ctx.aiCandidates.length > 30 ? " …" : ""}`,
      );
    }
  },
};
