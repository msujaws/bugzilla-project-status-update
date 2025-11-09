import { qualifiesByHistoryWhy } from "../history.ts";
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
        bump("no history returned for id", bug.id);
        ctx.debugLog?.(
          `[history] excluded #${bug.id}: no history returned for id`,
          { always: true },
        );
        continue;
      }
      const result = qualifiesByHistoryWhy(history, ctx.sinceISO);
      if (result.ok) {
        allowed.add(bug.id);
        ctx.debugLog?.(
          `[history] qualified #${bug.id}${
            result.detail ? ` – ${result.detail}` : ""
          }`,
          { always: true },
        );
      } else {
        const reason = result.why || "failed history qualification";
        bump(reason, bug.id);
        ctx.debugLog?.(`[history] excluded #${bug.id}: ${reason}`, {
          always: true,
        });
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
          { always: true },
        );
      } else {
        ctx.debugLog(
          "no qualified bugs → check reasons above; also verify statuses/resolution and history window.",
          { always: true },
        );
      }
    }
  },
};
