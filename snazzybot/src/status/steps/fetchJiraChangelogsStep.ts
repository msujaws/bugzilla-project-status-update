import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const fetchJiraChangelogsStep: RecipeStep<
  StatusStepName,
  StatusContext
> = {
  name: "fetch-jira-changelogs",
  run: async (ctx) => {
    if (!ctx.jiraClient) {
      ctx.hooks.warn?.(
        "Jira client not initialized, skipping changelog fetching",
      );
      return;
    }

    if (ctx.jiraIssues.length === 0) {
      ctx.hooks.info?.("No Jira issues to fetch changelogs for");
      return;
    }

    const histories = await ctx.jiraClient.fetchChangelogs(
      ctx.jiraIssues.map((issue) => issue.key),
      ctx.hooks,
    );

    ctx.jiraHistories = histories;
    ctx.byKeyJiraHistory = new Map(
      histories.map((entry) => [entry.key, entry]),
    );

    if (ctx.isDebug) {
      let shown = 0;
      for (const issue of ctx.jiraIssues) {
        if (shown >= 3) break;
        const history = ctx.byKeyJiraHistory.get(issue.key);
        const firstChangelog = history?.changelog?.[0];
        const items = Array.isArray(firstChangelog?.items)
          ? firstChangelog.items
          : [];

        if (history?.changelog?.length && items.length > 0) {
          ctx.debugLog?.(
            `sample Jira history ${issue.key} first changes: ${JSON.stringify(
              items.slice(0, 2),
            )}`,
          );
          shown++;
        } else if (!history?.changelog?.length) {
          ctx.debugLog?.(
            `sample Jira history ${issue.key} has no changelog entries`,
          );
        }
      }
    }

    ctx.hooks.info?.(
      `Fetched changelogs for ${histories.length}/${ctx.jiraIssues.length} Jira issues`,
    );
  },
};
