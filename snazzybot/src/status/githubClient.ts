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
  GitHubRawSearchCommit,
  GitHubRawSearchIssue,
} from "./githubTypes.ts";

const MAX_COMMITS_PER_REPO = 500;
const MAX_PRS_PER_REPO = 100;
// Bound on search results per user/kind. The GitHub Search API caps total
// results at 1000 anyway; this keeps a single run well under Cloudflare's
// subrequest budget (each page is one subrequest).
const MAX_SEARCH_RESULTS = 200;

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
    author?: string,
  ): Promise<GitHubRawCommit[]> {
    const commits: GitHubRawCommit[] = [];
    let path = `/repos/${repo}/commits?since=${since}&per_page=100`;
    if (author) {
      path += `&author=${encodeURIComponent(author)}`;
    }

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

  // Paginated GitHub Search API fetch. Search responses wrap matches in
  // { total_count, items: [] } (unlike the per-repo endpoints which return bare
  // arrays), so we accumulate `items`. Commit search needs the cloak-preview
  // Accept header; pass it via `accept`.
  private async searchPaginated<T>(
    initialPath: string,
    accept: string,
  ): Promise<T[]> {
    const items: T[] = [];
    let path: string | undefined = initialPath;

    while (path && items.length < MAX_SEARCH_RESULTS) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          Accept: accept,
          "User-Agent": "Bugzilla-Status-Update-Bot",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(
          `GitHub API ${response.status}: ${await response.text()}`,
        );
      }

      const data = (await response.json()) as { items?: T[] };
      items.push(...(data.items ?? []));

      const { next } = this.parseLinkHeader(response.headers.get("Link"));
      if (!next || items.length >= MAX_SEARCH_RESULTS) {
        break;
      }
      path = new URL(next).pathname + new URL(next).search;
    }

    return items.slice(0, MAX_SEARCH_RESULTS);
  }

  async getRepoActivity(
    repo: string,
    since: string,
    authors?: string[],
  ): Promise<GitHubActivity> {
    // When specific authors are requested, query the commits API per author
    // (`?author=`) so GitHub filters server-side. This keeps commit volume and
    // subsequent per-PR detail fetches small on large repos — important under
    // Cloudflare's Free-tier subrequest cap.
    const filterAuthors = (authors ?? []).map((a) => a.trim()).filter(Boolean);
    const authorFilter =
      filterAuthors.length > 0
        ? new Set(filterAuthors.map((a) => a.toLowerCase()))
        : undefined;

    let commitsData: GitHubRawCommit[];
    if (filterAuthors.length > 0) {
      const perAuthor = await Promise.all(
        filterAuthors.map((author) =>
          this.fetchPaginatedCommits(repo, since, author),
        ),
      );
      commitsData = perAuthor.flat();
    } else {
      commitsData = await this.fetchPaginatedCommits(repo, since);
    }

    const commits: GitHubCommit[] = commitsData.map((c: GitHubRawCommit) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.author?.login ?? c.commit.author.name,
      authorEmail: c.commit.author.email,
      date: c.commit.author.date,
      url: c.html_url,
    }));

    const allPrsData = await this.fetchPaginatedPRs(repo);
    const prsData = authorFilter
      ? allPrsData.filter((pr) =>
          authorFilter.has((pr.user?.login ?? "").toLowerCase()),
        )
      : allPrsData;

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

  /**
   * Discover a person's activity across GitHub without naming repos, by
   * searching the Commit and Issue (PR) search APIs for `author:<user>`.
   * Optionally scoped to one or more orgs. Results are grouped into one
   * {@link GitHubActivity} per repository so the rest of the pipeline
   * (qualification, contributor mapping) is reused unchanged.
   */
  async searchUserActivity(
    usernames: string[],
    since: string,
    orgs?: string[],
  ): Promise<GitHubActivity[]> {
    const users = usernames.map((u) => u.trim()).filter(Boolean);
    if (users.length === 0) return [];

    const orgQualifier = (orgs ?? [])
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => `org:${o}`)
      .join(" ");
    const scope = orgQualifier ? ` ${orgQualifier}` : "";

    const byRepo = new Map<string, GitHubActivity>();
    const ensureRepo = (repo: string): GitHubActivity => {
      let activity = byRepo.get(repo);
      if (!activity) {
        activity = { repo, commits: [], pullRequests: [] };
        byRepo.set(repo, activity);
      }
      return activity;
    };

    for (const user of users) {
      // Commits authored by the user, on or after `since`.
      const commitQuery = `author:${user}${scope} author-date:>=${since}`;
      const commitItems = await this.searchPaginated<GitHubRawSearchCommit>(
        `/search/commits?q=${encodeURIComponent(commitQuery)}&per_page=100`,
        // Commit search historically required the cloak-preview media type; it
        // remains accepted and is harmless on the GA endpoint.
        "application/vnd.github.cloak-preview+json",
      );
      for (const item of commitItems) {
        const repo = item.repository?.full_name;
        if (!repo) continue;
        ensureRepo(repo).commits.push({
          sha: item.sha,
          message: item.commit.message,
          author: item.author?.login ?? item.commit.author.name,
          authorEmail: item.commit.author.email,
          date: item.commit.author.date,
          url: item.html_url,
        });
      }

      // Pull requests authored by the user, closed on or after `since`.
      const issueQuery = `author:${user} type:pr${scope} closed:>=${since}`;
      const issueItems = await this.searchPaginated<GitHubRawSearchIssue>(
        `/search/issues?q=${encodeURIComponent(issueQuery)}&per_page=100`,
        "application/vnd.github.v3+json",
      );
      for (const item of issueItems) {
        if (!item.pull_request) continue;
        const repo = item.repository_url.replace(
          "https://api.github.com/repos/",
          "",
        );
        if (!repo) continue;
        ensureRepo(repo).pullRequests.push({
          number: item.number,
          title: item.title,
          author: item.user?.login ?? user,
          url: item.html_url,
          state: item.pull_request.merged_at ? "merged" : "closed",
          mergedAt: item.pull_request.merged_at ?? undefined,
          closedAt: item.closed_at ?? undefined,
          additions: 0,
          deletions: 0,
        });
      }
    }

    return [...byRepo.values()];
  }
}
