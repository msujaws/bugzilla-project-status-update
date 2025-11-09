import { emitHistoryCoverage } from "../recipeHelpers.ts";
import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const fetchHistoriesStep: RecipeStep<StatusStepName, StatusContext> = {
  name: "fetch-histories",
  run: async (ctx) => {
    const histories = await ctx.client.fetchHistories(
      ctx.candidates.map((bug) => bug.id),
      ctx.hooks,
    );
    ctx.histories = histories;
    ctx.byIdHistory = new Map(histories.map((entry) => [entry.id, entry]));
    if (ctx.isDebug) {
      let shown = 0;
      for (const bug of ctx.candidates) {
        if (shown >= 3) break;
        const history = ctx.byIdHistory.get(bug.id);
        const firstChanges = history?.history?.[0]?.changes;
        const changes = Array.isArray(firstChanges) ? firstChanges : [];
        if (history?.history?.length && !Array.isArray(firstChanges)) {
          ctx.debugLog?.(
            `sample history #${bug.id} has non-array changes payload: ${JSON.stringify(firstChanges)}`,
          );
        } else if (!history?.history?.length) {
          ctx.debugLog?.(
            `sample history #${bug.id} has no history entries within fetched payload`,
          );
        }
        if (changes.length > 0) {
          ctx.debugLog?.(
            `sample history #${bug.id} first changes: ${JSON.stringify(
              changes.slice(0, 2),
            )}`,
          );
          shown++;
        }
      }
    }
    emitHistoryCoverage(
      ctx.candidates,
      histories,
      ctx.byIdHistory,
      ctx.debugLog,
    );
  },
};
