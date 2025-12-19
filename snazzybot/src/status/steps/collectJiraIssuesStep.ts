import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";
import { filterJiraIssues } from "../qualification.ts";

export const collectJiraIssuesStep: RecipeStep<StatusStepName, StatusContext> =
  {
    name: "collect-jira-issues",
    run: async (ctx) => {
      if (!ctx.jiraClient) {
        ctx.hooks.warn?.(
          "Jira client not initialized, skipping Jira collection",
        );
        return;
      }

      const allIssues = [];

      // Fetch issues by JQL queries
      if (ctx.jiraJql.length > 0) {
        ctx.hooks.info?.(
          `Collecting Jira issues from ${ctx.jiraJql.length} JQL quer${ctx.jiraJql.length === 1 ? "y" : "ies"}`,
        );
        const jqlIssues = await ctx.jiraClient.fetchIssuesByJQL(
          ctx.jiraJql,
          ctx.hooks,
        );
        allIssues.push(...jqlIssues);
      }

      // Fetch issues by project names
      if (ctx.jiraProjects.length > 0) {
        ctx.hooks.info?.(
          `Collecting Jira issues from ${ctx.jiraProjects.length} project${ctx.jiraProjects.length === 1 ? "" : "s"}`,
        );
        const projectIssues = await ctx.jiraClient.fetchIssuesByProjects(
          ctx.jiraProjects,
          ctx.days,
          ctx.hooks,
        );
        allIssues.push(...projectIssues);
      }

      // Deduplicate by key
      const uniqueIssues = new Map();
      for (const issue of allIssues) {
        if (!uniqueIssues.has(issue.key)) {
          uniqueIssues.set(issue.key, issue);
        }
      }

      const deduped = [...uniqueIssues.values()];
      const { qualified, excludedSecure, excludedStatus, excludedStale } =
        filterJiraIssues(deduped, ctx.sinceISO);

      ctx.jiraIssues = qualified;
      ctx.hooks.info?.(
        `Jira Candidates: ${ctx.jiraIssues.length} issue${ctx.jiraIssues.length === 1 ? "" : "s"}`,
      );
      if (excludedSecure + excludedStatus + excludedStale > 0) {
        ctx.hooks.info?.(
          `Jira filters removed: ${excludedSecure} secure, ${excludedStatus} status, ${excludedStale} stale`,
        );
      }

      if (ctx.isDebug && ctx.jiraIssues.length > 0) {
        ctx.debugLog?.(
          `sample Jira issues: ${ctx.jiraIssues
            .slice(0, 3)
            .map((i) => i.key)
            .join(", ")}`,
          { always: true },
        );
      }
    },
  };
