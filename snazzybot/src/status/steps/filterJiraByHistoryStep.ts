import { qualifiesByJiraHistoryWhy } from "../jiraHistory.ts";
import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const filterJiraByHistoryStep: RecipeStep<
  StatusStepName,
  StatusContext
> = {
  name: "filter-jira-by-history",
  run: (ctx) => {
    if (ctx.jiraIssues.length === 0) {
      ctx.hooks.info?.("No Jira issues to filter");
      ctx.finalJiraIssues = [];
      return;
    }

    const reasonCounts = new Map<string, number>();
    const reasonExamples = new Map<string, string[]>();
    const bump = (why: string, key: string) => {
      reasonCounts.set(why, (reasonCounts.get(why) ?? 0) + 1);
      const list = reasonExamples.get(why) ?? [];
      if (list.length < 6) list.push(key);
      reasonExamples.set(why, list);
    };

    const allowedKeys = new Set<string>();
    for (const issue of ctx.jiraIssues) {
      const history = ctx.byKeyJiraHistory.get(issue.key);
      if (!history) {
        bump("no changelog returned for issue", issue.key);
        ctx.debugLog?.(
          `[jira-history] excluded ${issue.key}: no changelog returned`,
          { always: true },
        );
        continue;
      }

      const result = qualifiesByJiraHistoryWhy(history, ctx.sinceISO);
      if (result.ok) {
        allowedKeys.add(issue.key);
        ctx.debugLog?.(
          `[jira-history] qualified ${issue.key}${
            result.detail ? ` – ${result.detail}` : ""
          }`,
          { always: true },
        );
      } else {
        const reason = result.why || "failed history qualification";
        bump(reason, issue.key);
        ctx.debugLog?.(`[jira-history] excluded ${issue.key}: ${reason}`, {
          always: true,
        });
      }
    }

    // Log reason breakdown with string examples instead of number examples
    if (ctx.debugLog) {
      for (const [reason, count] of reasonCounts.entries()) {
        const examples = reasonExamples.get(reason) || [];
        ctx.debugLog(
          `[jira-history] ${reason}: ${count} issue${count === 1 ? "" : "s"}${
            examples.length > 0 ? ` (e.g., ${examples.join(", ")})` : ""
          }`,
        );
      }
    }

    const final = ctx.jiraIssues.filter((issue) => allowedKeys.has(issue.key));
    ctx.finalJiraIssues = final;
    ctx.hooks.info?.(`Qualified Jira issues: ${final.length}`);

    if (ctx.debugLog) {
      if (final.length > 0) {
        ctx.debugLog(
          `qualified Jira keys: ${final
            .slice(0, 20)
            .map((issue) => issue.key)
            .join(", ")}${final.length > 20 ? " …" : ""}`,
          { always: true },
        );
      } else {
        ctx.debugLog(
          "no qualified Jira issues → check reasons above; verify JQL filters and history window.",
          { always: true },
        );
      }
    }
  },
};
