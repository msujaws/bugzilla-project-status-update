import { describeError } from "../utils/errors.ts";
import { DAY_IN_SECONDS, getDefaultCache } from "../utils/cache.ts";
import type { EnvLike } from "./types.ts";
import type {
  GitHubCommit,
  GitHubPullRequest,
  GitHubActivity,
  GitHubRawCommit,
  GitHubRawPullRequest,
  GitHubRawPullRequestDetails,
} from "./githubTypes.ts";

const MAX_COMMITS_PER_REPO = 500;
const MAX_PRS_PER_REPO = 100;

export class GitHubClient {
  private readonly apiKey?: string;
  private readonly baseUrl = "https://api.github.com";
  private readonly bypass: boolean;

  constructor(private readonly env: EnvLike) {
    this.apiKey = env.GITHUB_API_KEY;
    this.bypass = !!env.SNAZZY_SKIP_CACHE;
  }

  private async get<T>(
    path: string,
    options: { bypassCache?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Bugzilla-Status-Update-Bot",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const url = `${this.baseUrl}${path}`;
    const cfCache =
      !this.bypass && !options.bypassCache ? getDefaultCache() : undefined;

    if (cfCache) {
      const cached = await cfCache.match(url);
      if (cached) {
        return cached.json() as Promise<T>;
      }
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 403) {
        const rateLimitRemaining = response.headers.get(
          "x-ratelimit-remaining",
        );
        const rateLimitReset = response.headers.get("x-ratelimit-reset");
        if (rateLimitRemaining === "0" && rateLimitReset) {
          const resetDate = new Date(
            Number.parseInt(rateLimitReset, 10) * 1000,
          );
          throw new Error(
            `GitHub API rate limit exceeded. Resets at ${resetDate.toISOString()}`,
          );
        }
      }
      throw new Error(
        `GitHub API ${response.status}: ${await response.text()}`,
      );
    }

    const json = (await response.json()) as T;

    if (cfCache) {
      try {
        await cfCache.put(
          url,
          new Response(JSON.stringify(json), {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": `public, s-maxage=${DAY_IN_SECONDS}, max-age=0, immutable`,
            },
          }),
        );
      } catch (error) {
        console.warn("Failed to cache GitHub response", error);
      }
    }

    return json;
  }

  private parseLinkHeader(linkHeader: string | null): { next?: string } {
    if (!linkHeader) return {};

    const links: Record<string, string> = {};
    const parts = linkHeader.split(",");

    for (const part of parts) {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match) {
        const [, url, rel] = match;
        links[rel] = url;
      }
    }

    return { next: links.next };
  }

  private async fetchPaginatedCommits(
    repo: string,
    since: string,
  ): Promise<GitHubRawCommit[]> {
    const commits: GitHubRawCommit[] = [];
    let path = `/repos/${repo}/commits?since=${since}&per_page=100`;

    while (path && commits.length < MAX_COMMITS_PER_REPO) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Bugzilla-Status-Update-Bot",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(
          `GitHub API ${response.status}: ${await response.text()}`,
        );
      }

      const data = await response.json();
      commits.push(...data);

      const linkHeader = response.headers.get("Link");
      const { next } = this.parseLinkHeader(linkHeader);

      if (!next || commits.length >= MAX_COMMITS_PER_REPO) {
        break;
      }

      path = new URL(next).pathname + new URL(next).search;
    }

    return commits.slice(0, MAX_COMMITS_PER_REPO);
  }

  private async fetchPaginatedPRs(
    repo: string,
  ): Promise<GitHubRawPullRequest[]> {
    const prs: GitHubRawPullRequest[] = [];
    let path = `/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`;

    while (path && prs.length < MAX_PRS_PER_REPO) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Bugzilla-Status-Update-Bot",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(
          `GitHub API ${response.status}: ${await response.text()}`,
        );
      }

      const data = await response.json();
      prs.push(...data);

      const linkHeader = response.headers.get("Link");
      const { next } = this.parseLinkHeader(linkHeader);

      if (!next || prs.length >= MAX_PRS_PER_REPO) {
        break;
      }

      path = new URL(next).pathname + new URL(next).search;
    }

    return prs.slice(0, MAX_PRS_PER_REPO);
  }

  async getRepoActivity(repo: string, since: string): Promise<GitHubActivity> {
    const commitsData = await this.fetchPaginatedCommits(repo, since);

    const commits: GitHubCommit[] = commitsData.map((c: GitHubRawCommit) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.author?.login ?? c.commit.author.name,
      authorEmail: c.commit.author.email,
      date: c.commit.author.date,
      url: c.html_url,
    }));

    const prsData = await this.fetchPaginatedPRs(repo);

    const pullRequests: GitHubPullRequest[] = [];

    for (const pr of prsData) {
      if (pr.merged_at) {
        try {
          const prDetails = await this.get<GitHubRawPullRequestDetails>(
            `/repos/${repo}/pulls/${pr.number}`,
          );
          pullRequests.push({
            number: pr.number,
            title: pr.title,
            author: pr.user.login,
            url: pr.html_url,
            state: "merged",
            mergedAt: pr.merged_at,
            closedAt: pr.closed_at,
            additions: prDetails.additions ?? 0,
            deletions: prDetails.deletions ?? 0,
          });
        } catch (error) {
          console.warn(
            `Failed to fetch PR details for #${pr.number}: ${describeError(error)}`,
          );
          pullRequests.push({
            number: pr.number,
            title: pr.title,
            author: pr.user.login,
            url: pr.html_url,
            state: "merged",
            mergedAt: pr.merged_at,
            closedAt: pr.closed_at,
            additions: 0,
            deletions: 0,
          });
        }
      } else {
        pullRequests.push({
          number: pr.number,
          title: pr.title,
          author: pr.user.login,
          url: pr.html_url,
          state: "closed",
          closedAt: pr.closed_at,
          additions: 0,
          deletions: 0,
        });
      }
    }

    return {
      repo,
      commits,
      pullRequests,
    };
  }
}
