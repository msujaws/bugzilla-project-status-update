import { qualifiesByHistory, qualifiesByHistoryWhy } from "../history.ts";
import { logReasonBreakdown } from "../recipeHelpers.ts";
import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const filterByHistoryStep: RecipeStep<StatusStepName, StatusContext> = {
  name: "filter-by-history",
  run: (ctx) => {
    const reasonCounts = new Map<string, number>();
    const reasonExamples = new Map<string, number[]>();
    const bump = (why: string, id: number) => {
      reasonCounts.set(why, (reasonCounts.get(why) ?? 0) + 1);
      const list = reasonExamples.get(why) ?? [];
      if (list.length < 6) list.push(id);
      reasonExamples.set(why, list);
    };

    const allowed = new Set<number>();
    for (const bug of ctx.candidates) {
      const history = ctx.byIdHistory.get(bug.id);
      if (!history) {
        if (ctx.isDebug) bump("no history returned for id", bug.id);
        continue;
      }
      if (ctx.isDebug) {
        const result = qualifiesByHistoryWhy(history, ctx.sinceISO);
        if (result.ok) {
          allowed.add(bug.id);
        } else {
          bump(result.why || "failed history qualification", bug.id);
        }
      } else if (qualifiesByHistory(history, ctx.sinceISO)) {
        allowed.add(bug.id);
      }
    }

    logReasonBreakdown(reasonCounts, reasonExamples, ctx.debugLog);

    const final = ctx.candidates.filter((bug) => allowed.has(bug.id));
    ctx.finalBugs = final;
    ctx.ids = final.map((bug) => bug.id);
    ctx.hooks.info?.(`Qualified bugs: ${final.length}`);

    if (ctx.debugLog) {
      if (final.length > 0) {
        ctx.debugLog(
          `qualified IDs: ${final
            .slice(0, 20)
            .map((bug) => bug.id)
            .join(", ")}${final.length > 20 ? " …" : ""}`,
        );
      } else {
        ctx.debugLog(
          "no qualified bugs → check reasons above; also verify statuses/resolution and history window.",
        );
      }
    }
  },
};
