import { GitHubClient } from "./githubClient.ts";
import { filterGithubActivity } from "./qualification.ts";
import type { GitHubActivity, GitHubContributor } from "./githubTypes.ts";
import type { DebugLog, EnvLike, ProgressHooks } from "./types.ts";

export type GithubContributorResult = {
  activity: GitHubActivity[];
  contributors: Map<string, GitHubContributor>;
  stats?: {
    candidates: { commits: number; prs: number };
    qualified: { commits: number; prs: number };
  };
};

const emptyResult = (): GithubContributorResult => ({
  activity: [],
  contributors: new Map(),
});

/**
 * Fetch GitHub repo activity, qualify it against the time window, and build the
 * per-contributor map the summarizer credits.
 *
 * Extracted from fetchGithubActivityStep so both the recipe step and the
 * paginated `summarizeBugPage` flow can fetch GitHub activity exactly once
 * (the paginated flow only calls this for the first chunk).
 */
export async function collectGithubContributors(
  env: EnvLike,
  options: {
    githubRepos: string[];
    emailMapping: Record<string, string>;
    githubUsernames?: string[];
    sinceISO: string;
    includeGithubActivity: boolean;
  },
  hooks: ProgressHooks,
  debugLog?: DebugLog,
): Promise<GithubContributorResult> {
  const {
    githubRepos,
    emailMapping,
    githubUsernames = [],
    sinceISO,
    includeGithubActivity,
  } = options;

  if (!includeGithubActivity || githubRepos.length === 0) {
    return emptyResult();
  }

  // When usernames are provided, restrict activity to just those people. Stored
  // lowercased so matching against commit/PR authors is case-insensitive.
  const usernameFilter =
    githubUsernames.length > 0
      ? new Set(githubUsernames.map((u) => u.trim().toLowerCase()))
      : undefined;

  if (!env.GITHUB_API_KEY) {
    hooks.warn?.("GitHub API key not provided; skipping GitHub activity");
    return emptyResult();
  }

  const client = new GitHubClient(env);
  const activities = [];

  for (const repo of githubRepos) {
    try {
      hooks.info?.(`Fetching GitHub activity for ${repo}`);
      const activity = await client.getRepoActivity(repo, sinceISO);
      activities.push(activity);
    } catch (error) {
      hooks.warn?.(`Failed to fetch GitHub activity for ${repo}: ${error}`);
    }
  }

  const filteredActivities = [];
  let droppedCommits = 0;
  let droppedPullRequests = 0;
  let totalCommits = 0;
  let totalPullRequests = 0;

  for (const activity of activities) {
    totalCommits += activity.commits.length;
    totalPullRequests += activity.pullRequests.length;
    const filtered = filterGithubActivity(activity, sinceISO);
    filteredActivities.push(filtered.activity);
    droppedCommits += filtered.droppedCommits;
    droppedPullRequests += filtered.droppedPullRequests;
  }

  hooks.info?.(
    `GitHub Candidates: ${totalCommits} commit${
      totalCommits === 1 ? "" : "s"
    }, ${totalPullRequests} PR${totalPullRequests === 1 ? "" : "s"}`,
  );

  if (droppedCommits + droppedPullRequests > 0) {
    hooks.info?.(
      `GitHub filters removed: ${droppedCommits} commits, ${droppedPullRequests} PRs`,
    );
  }

  hooks.info?.(
    `GitHub Qualified (window): ${totalCommits - droppedCommits} commit${
      totalCommits - droppedCommits === 1 ? "" : "s"
    }, ${totalPullRequests - droppedPullRequests} PR${
      totalPullRequests - droppedPullRequests === 1 ? "" : "s"
    }`,
  );

  const contributors = new Map<string, GitHubContributor>();

  const reverseEmailMapping = new Map<string, string>();
  for (const [bugzillaEmail, githubUsername] of Object.entries(emailMapping)) {
    reverseEmailMapping.set(githubUsername.toLowerCase(), bugzillaEmail);
  }

  for (const activity of filteredActivities) {
    for (const commit of activity.commits) {
      const username = commit.author;
      if (usernameFilter && !usernameFilter.has(username.toLowerCase())) {
        continue;
      }
      if (!contributors.has(username)) {
        const bugzillaEmail =
          reverseEmailMapping.get(username.toLowerCase()) ||
          Object.entries(emailMapping).find(
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
      if (usernameFilter && !usernameFilter.has(username.toLowerCase())) {
        continue;
      }
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

  debugLog?.(
    `[github] Collected ${activities.length} repos, ${contributors.size} contributors`,
  );

  return {
    activity: filteredActivities,
    contributors,
    stats: {
      candidates: { commits: totalCommits, prs: totalPullRequests },
      qualified: {
        commits: totalCommits - droppedCommits,
        prs: totalPullRequests - droppedPullRequests,
      },
    },
  };
}
