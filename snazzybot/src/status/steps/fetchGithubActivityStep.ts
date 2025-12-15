import { GitHubClient } from "../githubClient.ts";
import type { RecipeStep } from "../stateMachine.ts";
import type { StatusContext, StatusStepName } from "../context.ts";
import type { GitHubContributor } from "../githubTypes.ts";

export const fetchGithubActivityStep: RecipeStep<
  StatusStepName,
  StatusContext
> = {
  name: "fetch-github-activity",
  run: async (ctx) => {
    if (!ctx.params.includeGithubActivity || ctx.githubRepos.length === 0) {
      ctx.githubActivity = [];
      ctx.githubContributors = new Map();
      return;
    }

    if (!ctx.env.GITHUB_API_KEY) {
      ctx.hooks.warn?.("GitHub API key not provided; skipping GitHub activity");
      ctx.githubActivity = [];
      ctx.githubContributors = new Map();
      return;
    }

    const client = new GitHubClient(ctx.env);
    const activities = [];

    for (const repo of ctx.githubRepos) {
      try {
        ctx.hooks.info?.(`Fetching GitHub activity for ${repo}`);
        const activity = await client.getRepoActivity(repo, ctx.sinceISO);
        activities.push(activity);
      } catch (error) {
        ctx.hooks.warn?.(
          `Failed to fetch GitHub activity for ${repo}: ${error}`,
        );
      }
    }

    ctx.githubActivity = activities;

    const contributors = new Map<string, GitHubContributor>();

    const reverseEmailMapping = new Map<string, string>();
    for (const [bugzillaEmail, githubUsername] of Object.entries(
      ctx.emailMapping,
    )) {
      reverseEmailMapping.set(githubUsername.toLowerCase(), bugzillaEmail);
    }

    for (const activity of activities) {
      for (const commit of activity.commits) {
        const username = commit.author;
        if (!contributors.has(username)) {
          const bugzillaEmail =
            reverseEmailMapping.get(username.toLowerCase()) ||
            Object.entries(ctx.emailMapping).find(
              ([email]) =>
                email.toLowerCase() === commit.authorEmail.toLowerCase(),
            )?.[0];

          contributors.set(username, {
            githubUsername: username,
            bugzillaEmail,
            commits: [],
            pullRequests: [],
          });
        }
        contributors.get(username)!.commits.push(commit);
      }

      for (const pr of activity.pullRequests) {
        const username = pr.author;
        if (!contributors.has(username)) {
          const bugzillaEmail = reverseEmailMapping.get(username.toLowerCase());

          contributors.set(username, {
            githubUsername: username,
            bugzillaEmail,
            commits: [],
            pullRequests: [],
          });
        }
        contributors.get(username)!.pullRequests.push(pr);
      }
    }

    ctx.githubContributors = contributors;

    ctx.debugLog?.(
      `[github] Collected ${activities.length} repos, ${contributors.size} contributors`,
    );
  },
};
