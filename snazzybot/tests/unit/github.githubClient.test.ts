import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../utils/msw/node";
import { GitHubClient } from "../../src/status/githubClient.ts";
import type { EnvLike } from "../../src/status/types.ts";

describe("GitHubClient", () => {
  const env: EnvLike = {
    GITHUB_API_KEY: "test-gh-token",
    OPENAI_API_KEY: "test-openai",
    BUGZILLA_API_KEY: "test-bz",
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2025-10-29T09:36:11Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches commits for a repository with pagination", async () => {
    const repo = "mozilla/firefox";
    const since = "2025-10-21T00:00:00Z";

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "abc123",
            commit: {
              message: "Fix issue #1",
              author: {
                name: "Alice Dev",
                email: "alice@mozilla.org",
                date: "2025-10-22T10:00:00Z",
              },
            },
            author: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/commit/abc123",
          },
          {
            sha: "def456",
            commit: {
              message: "Add feature",
              author: {
                name: "Bob Dev",
                email: "bob@mozilla.org",
                date: "2025-10-23T14:30:00Z",
              },
            },
            author: { login: "bobdev" },
            html_url: "https://github.com/mozilla/firefox/commit/def456",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([]);
      }),
    );

    const client = new GitHubClient(env);
    const activity = await client.getRepoActivity(repo, since);

    expect(activity.repo).toBe(repo);
    expect(activity.commits).toHaveLength(2);
    expect(activity.commits[0]).toMatchObject({
      sha: "abc123",
      message: "Fix issue #1",
      author: "alicedev",
      authorEmail: "alice@mozilla.org",
      url: "https://github.com/mozilla/firefox/commit/abc123",
    });
    expect(activity.commits[1]).toMatchObject({
      sha: "def456",
      message: "Add feature",
      author: "bobdev",
      authorEmail: "bob@mozilla.org",
    });
  });

  it("fetches merged pull requests with additions/deletions", async () => {
    const repo = "mozilla/devtools";
    const since = "2025-10-21T00:00:00Z";

    server.use(
      http.get("https://api.github.com/repos/mozilla/devtools/commits", () => {
        return HttpResponse.json([]);
      }),
      http.get("https://api.github.com/repos/mozilla/devtools/pulls", () => {
        return HttpResponse.json([
          {
            number: 123,
            title: "Add dark mode",
            user: { login: "alicedev" },
            html_url: "https://github.com/mozilla/devtools/pull/123",
            state: "closed",
            merged_at: "2025-10-22T11:00:00Z",
            closed_at: "2025-10-22T11:00:00Z",
          },
          {
            number: 124,
            title: "Fix typo",
            user: { login: "bobdev" },
            html_url: "https://github.com/mozilla/devtools/pull/124",
            state: "closed",
            merged_at: undefined,
            closed_at: "2025-10-23T09:00:00Z",
          },
        ]);
      }),
      http.get(
        "https://api.github.com/repos/mozilla/devtools/pulls/123",
        () => {
          return HttpResponse.json({
            additions: 150,
            deletions: 25,
          });
        },
      ),
    );

    const client = new GitHubClient(env);
    const activity = await client.getRepoActivity(repo, since);

    expect(activity.pullRequests).toHaveLength(2);
    expect(activity.pullRequests[0]).toMatchObject({
      number: 123,
      title: "Add dark mode",
      author: "alicedev",
      state: "merged",
      additions: 150,
      deletions: 25,
    });
    expect(activity.pullRequests[1]).toMatchObject({
      number: 124,
      title: "Fix typo",
      author: "bobdev",
      state: "closed",
      additions: 0,
      deletions: 0,
    });
  });

  it("returns pull requests regardless of since date", async () => {
    const repo = "mozilla/firefox";
    const since = "2025-10-25T00:00:00Z";

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([
          {
            number: 100,
            title: "Old PR",
            user: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/pull/100",
            state: "closed",
            merged_at: "2025-10-20T10:00:00Z",
            closed_at: "2025-10-20T10:00:00Z",
          },
          {
            number: 101,
            title: "Recent PR",
            user: { login: "bobdev" },
            html_url: "https://github.com/mozilla/firefox/pull/101",
            state: "closed",
            merged_at: "2025-10-26T10:00:00Z",
            closed_at: "2025-10-26T10:00:00Z",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls/101", () => {
        return HttpResponse.json({
          additions: 50,
          deletions: 10,
        });
      }),
    );

    const client = new GitHubClient(env);
    const activity = await client.getRepoActivity(repo, since);

    expect(activity.pullRequests).toHaveLength(2);
    expect(activity.pullRequests.map((pr) => pr.number)).toEqual([100, 101]);
  });

  it("handles commits with missing author login", async () => {
    const repo = "mozilla/firefox";
    const since = "2025-10-21T00:00:00Z";

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "xyz789",
            commit: {
              message: "Commit without GitHub account",
              author: {
                name: "External Contributor",
                email: "external@example.com",
                date: "2025-10-22T10:00:00Z",
              },
            },
            author: undefined,
            html_url: "https://github.com/mozilla/firefox/commit/xyz789",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([]);
      }),
    );

    const client = new GitHubClient(env);
    const activity = await client.getRepoActivity(repo, since);

    expect(activity.commits).toHaveLength(1);
    expect(activity.commits[0].author).toBe("External Contributor");
    expect(activity.commits[0].authorEmail).toBe("external@example.com");
  });

  it("handles rate limit errors gracefully", async () => {
    const repo = "mozilla/firefox";
    const since = "2025-10-21T00:00:00Z";

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": "1698840000",
            },
          },
        );
      }),
    );

    const client = new GitHubClient(env);

    await expect(client.getRepoActivity(repo, since)).rejects.toThrow(
      /rate limit exceeded/i,
    );
  });

  it("handles generic API errors", async () => {
    const repo = "mozilla/nonexistent";
    const since = "2025-10-21T00:00:00Z";

    server.use(
      http.get(
        "https://api.github.com/repos/mozilla/nonexistent/commits",
        () => {
          return HttpResponse.json({ message: "Not Found" }, { status: 404 });
        },
      ),
    );

    const client = new GitHubClient(env);

    await expect(client.getRepoActivity(repo, since)).rejects.toThrow(
      /GitHub API 404/,
    );
  });

  it("works without API key and makes unauthenticated requests", async () => {
    const envNoKey: EnvLike = {
      OPENAI_API_KEY: "test-openai",
      BUGZILLA_API_KEY: "test-bz",
    };
    const repo = "mozilla/firefox";
    const since = "2025-10-21T00:00:00Z";

    let commitsRequested = false;
    let pullsRequested = false;

    server.use(
      http.get(
        "https://api.github.com/repos/mozilla/firefox/commits",
        ({ request }) => {
          const authHeader = request.headers.get("Authorization");
          expect(authHeader).toBeNull();
          commitsRequested = true;
          return HttpResponse.json([
            {
              sha: "test123",
              commit: {
                message: "Test commit",
                author: {
                  name: "Test User",
                  email: "test@example.com",
                  date: "2025-10-22T10:00:00Z",
                },
              },
              author: { login: "testuser" },
              html_url: "https://github.com/mozilla/firefox/commit/test123",
            },
          ]);
        },
      ),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        pullsRequested = true;
        return HttpResponse.json([]);
      }),
    );

    const client = new GitHubClient(envNoKey);
    const activity = await client.getRepoActivity(repo, since);

    expect(commitsRequested).toBe(true);
    expect(pullsRequested).toBe(true);
    expect(activity.repo).toBe(repo);
    expect(activity.commits).toHaveLength(1);
    expect(activity.commits[0]).toMatchObject({
      sha: "test123",
      message: "Test commit",
      author: "testuser",
    });
  });

  it("includes User-Agent header in all requests", async () => {
    const repo = "mozilla/firefox";
    const since = "2025-10-21T00:00:00Z";

    let userAgentChecked = false;

    server.use(
      http.get(
        "https://api.github.com/repos/mozilla/firefox/commits",
        ({ request }) => {
          const userAgent = request.headers.get("User-Agent");
          expect(userAgent).toBe("Bugzilla-Status-Update-Bot");
          userAgentChecked = true;
          return HttpResponse.json([]);
        },
      ),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([]);
      }),
    );

    const client = new GitHubClient(env);
    await client.getRepoActivity(repo, since);

    expect(userAgentChecked).toBe(true);
  });

  it("handles PR details fetch errors gracefully", async () => {
    const repo = "mozilla/firefox";
    const since = "2025-10-21T00:00:00Z";
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([
          {
            number: 123,
            title: "Test PR",
            user: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/pull/123",
            state: "closed",
            merged_at: "2025-10-22T11:00:00Z",
            closed_at: "2025-10-22T11:00:00Z",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls/123", () => {
        return HttpResponse.json({ message: "Server error" }, { status: 500 });
      }),
    );

    const client = new GitHubClient(env);
    const activity = await client.getRepoActivity(repo, since);

    expect(activity.pullRequests).toHaveLength(1);
    expect(activity.pullRequests[0]).toMatchObject({
      number: 123,
      additions: 0,
      deletions: 0,
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to fetch PR details for #123"),
    );

    consoleSpy.mockRestore();
  });
});
