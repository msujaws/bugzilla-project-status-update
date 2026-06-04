import { collectGithubContributors } from "../githubStage.ts";
import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";

export const fetchGithubActivityStep: RecipeStep<
  StatusStepName,
  StatusContext
> = {
  name: "fetch-github-activity",
  run: async (ctx) => {
    const { activity, contributors, stats } = await collectGithubContributors(
      ctx.env,
      {
        githubRepos: ctx.githubRepos,
        emailMapping: ctx.emailMapping,
        githubUsernames: ctx.githubUsernames,
        githubOrgs: ctx.githubOrgs,
        sinceISO: ctx.sinceISO,
        includeGithubActivity: ctx.params.includeGithubActivity === true,
      },
      ctx.hooks,
      ctx.debugLog,
    );

    ctx.githubActivity = activity;
    ctx.githubContributors = contributors;
    if (stats) ctx.githubStats = stats;
  },
};
