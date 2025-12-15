import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../utils/msw/node";
import { fetchGithubActivityStep } from "../../src/status/steps/fetchGithubActivityStep.ts";
import type { StatusContext } from "../../src/status/context.ts";

describe("fetchGithubActivityStep", () => {
  it.each([
    {
      name: "includeGithubActivity is false",
      ctx: {
        params: { includeGithubActivity: false },
        githubRepos: ["mozilla/firefox"],
      },
      expectWarning: false,
    },
    {
      name: "no GitHub repos provided",
      ctx: {
        params: { includeGithubActivity: true },
        githubRepos: [],
      },
      expectWarning: false,
    },
    {
      name: "no GitHub API key provided",
      ctx: {
        params: { includeGithubActivity: true },
        githubRepos: ["mozilla/firefox"],
        env: { OPENAI_API_KEY: "test", BUGZILLA_API_KEY: "test" },
      },
      expectWarning: true,
    },
  ])("skips when $name", async ({ ctx, expectWarning }) => {
    const warnSpy = vi.fn();
    const contextWithHooks = {
      ...ctx,
      hooks: { warn: warnSpy },
    };

    await fetchGithubActivityStep.run(contextWithHooks as StatusContext);

    expect(contextWithHooks.githubActivity).toEqual([]);
    expect(contextWithHooks.githubContributors).toEqual(new Map());

    if (expectWarning) {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("GitHub API key not provided"),
      );
    } else {
      expect(warnSpy).not.toHaveBeenCalled();
    }
  });

  it("fetches activity for multiple repositories", async () => {
    const infoSpy = vi.fn();
    const ctx: Partial<StatusContext> = {
      params: { includeGithubActivity: true },
      githubRepos: ["mozilla/firefox", "mozilla/devtools"],
      env: {
        GITHUB_API_KEY: "test-key",
        OPENAI_API_KEY: "test",
        BUGZILLA_API_KEY: "test",
      },
      hooks: { info: infoSpy },
      emailMapping: {},
      sinceISO: "2025-10-21T00:00:00Z",
    };

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "abc123",
            commit: {
              message: "Fix bug",
              author: {
                name: "Alice",
                email: "alice@mozilla.org",
                date: "2025-10-22T10:00:00Z",
              },
            },
            author: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/commit/abc123",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([]);
      }),
      http.get("https://api.github.com/repos/mozilla/devtools/commits", () => {
        return HttpResponse.json([
          {
            sha: "def456",
            commit: {
              message: "Add feature",
              author: {
                name: "Bob",
                email: "bob@mozilla.org",
                date: "2025-10-23T10:00:00Z",
              },
            },
            author: { login: "bobdev" },
            html_url: "https://github.com/mozilla/devtools/commit/def456",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/devtools/pulls", () => {
        return HttpResponse.json([]);
      }),
    );

    await fetchGithubActivityStep.run(ctx as StatusContext);

    expect(ctx.githubActivity).toHaveLength(2);
    expect(ctx.githubActivity?.[0].repo).toBe("mozilla/firefox");
    expect(ctx.githubActivity?.[1].repo).toBe("mozilla/devtools");
    expect(infoSpy).toHaveBeenCalledWith(
      "Fetching GitHub activity for mozilla/firefox",
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "Fetching GitHub activity for mozilla/devtools",
    );
  });

  it("groups contributors by GitHub username", async () => {
    const ctx: Partial<StatusContext> = {
      params: { includeGithubActivity: true },
      githubRepos: ["mozilla/firefox"],
      env: {
        GITHUB_API_KEY: "test-key",
        OPENAI_API_KEY: "test",
        BUGZILLA_API_KEY: "test",
      },
      hooks: {},
      emailMapping: {},
      sinceISO: "2025-10-21T00:00:00Z",
    };

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "abc123",
            commit: {
              message: "Fix bug 1",
              author: {
                name: "Alice",
                email: "alice@mozilla.org",
                date: "2025-10-22T10:00:00Z",
              },
            },
            author: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/commit/abc123",
          },
          {
            sha: "abc124",
            commit: {
              message: "Fix bug 2",
              author: {
                name: "Alice",
                email: "alice@mozilla.org",
                date: "2025-10-22T11:00:00Z",
              },
            },
            author: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/commit/abc124",
          },
          {
            sha: "def456",
            commit: {
              message: "Add feature",
              author: {
                name: "Bob",
                email: "bob@mozilla.org",
                date: "2025-10-23T10:00:00Z",
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

    await fetchGithubActivityStep.run(ctx as StatusContext);

    expect(ctx.githubContributors?.size).toBe(2);

    const alice = ctx.githubContributors?.get("alicedev");
    expect(alice).toBeDefined();
    expect(alice?.commits).toHaveLength(2);
    expect(alice?.commits[0].message).toBe("Fix bug 1");
    expect(alice?.commits[1].message).toBe("Fix bug 2");

    const bob = ctx.githubContributors?.get("bobdev");
    expect(bob).toBeDefined();
    expect(bob?.commits).toHaveLength(1);
    expect(bob?.commits[0].message).toBe("Add feature");
  });

  it("maps GitHub usernames to Bugzilla emails using email mapping", async () => {
    const ctx: Partial<StatusContext> = {
      params: { includeGithubActivity: true },
      githubRepos: ["mozilla/firefox"],
      env: {
        GITHUB_API_KEY: "test-key",
        OPENAI_API_KEY: "test",
        BUGZILLA_API_KEY: "test",
      },
      hooks: {},
      emailMapping: {
        "alice@mozilla.org": "alicedev",
        "bob@mozilla.org": "bobdev",
      },
      sinceISO: "2025-10-21T00:00:00Z",
    };

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "abc123",
            commit: {
              message: "Fix bug",
              author: {
                name: "Alice",
                email: "alice@mozilla.org",
                date: "2025-10-22T10:00:00Z",
              },
            },
            author: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/commit/abc123",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([]);
      }),
    );

    await fetchGithubActivityStep.run(ctx as StatusContext);

    const alice = ctx.githubContributors?.get("alicedev");
    expect(alice?.bugzillaEmail).toBe("alice@mozilla.org");
  });

  it("does not set bugzillaEmail when no email mapping exists", async () => {
    const ctx: Partial<StatusContext> = {
      params: { includeGithubActivity: true },
      githubRepos: ["mozilla/firefox"],
      env: {
        GITHUB_API_KEY: "test-key",
        OPENAI_API_KEY: "test",
        BUGZILLA_API_KEY: "test",
      },
      hooks: {},
      emailMapping: {},
      sinceISO: "2025-10-21T00:00:00Z",
    };

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "abc123",
            commit: {
              message: "Fix bug",
              author: {
                name: "Alice",
                email: "alice@mozilla.org",
                date: "2025-10-22T10:00:00Z",
              },
            },
            author: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/commit/abc123",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([]);
      }),
    );

    await fetchGithubActivityStep.run(ctx as StatusContext);

    const alice = ctx.githubContributors?.get("alicedev");
    expect(alice?.bugzillaEmail).toBeUndefined();
  });

  it("groups pull requests by contributor", async () => {
    const ctx: Partial<StatusContext> = {
      params: { includeGithubActivity: true },
      githubRepos: ["mozilla/firefox"],
      env: {
        GITHUB_API_KEY: "test-key",
        OPENAI_API_KEY: "test",
        BUGZILLA_API_KEY: "test",
      },
      hooks: {},
      emailMapping: {},
      sinceISO: "2025-10-21T00:00:00Z",
    };

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([
          {
            number: 123,
            title: "Add feature",
            user: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/pull/123",
            state: "closed",
            merged_at: "2025-10-22T11:00:00Z",
            closed_at: "2025-10-22T11:00:00Z",
          },
          {
            number: 124,
            title: "Fix bug",
            user: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/pull/124",
            state: "closed",
            merged_at: "2025-10-23T11:00:00Z",
            closed_at: "2025-10-23T11:00:00Z",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls/123", () => {
        return HttpResponse.json({ additions: 100, deletions: 10 });
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls/124", () => {
        return HttpResponse.json({ additions: 50, deletions: 5 });
      }),
    );

    await fetchGithubActivityStep.run(ctx as StatusContext);

    expect(ctx.githubContributors?.size).toBe(1);
    const alice = ctx.githubContributors?.get("alicedev");
    expect(alice?.pullRequests).toHaveLength(2);
    expect(alice?.pullRequests[0].number).toBe(123);
    expect(alice?.pullRequests[1].number).toBe(124);
  });

  it("handles API errors gracefully and continues with other repos", async () => {
    const warnSpy = vi.fn();
    const ctx: Partial<StatusContext> = {
      params: { includeGithubActivity: true },
      githubRepos: ["mozilla/nonexistent", "mozilla/firefox"],
      env: {
        GITHUB_API_KEY: "test-key",
        OPENAI_API_KEY: "test",
        BUGZILLA_API_KEY: "test",
      },
      hooks: { warn: warnSpy },
      emailMapping: {},
      sinceISO: "2025-10-21T00:00:00Z",
    };

    server.use(
      http.get(
        "https://api.github.com/repos/mozilla/nonexistent/commits",
        () => {
          return HttpResponse.json({ message: "Not Found" }, { status: 404 });
        },
      ),
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "abc123",
            commit: {
              message: "Fix bug",
              author: {
                name: "Alice",
                email: "alice@mozilla.org",
                date: "2025-10-22T10:00:00Z",
              },
            },
            author: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/commit/abc123",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([]);
      }),
    );

    await fetchGithubActivityStep.run(ctx as StatusContext);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to fetch GitHub activity for mozilla/nonexistent",
      ),
    );
    expect(ctx.githubActivity).toHaveLength(1);
    expect(ctx.githubActivity?.[0].repo).toBe("mozilla/firefox");
  });

  it("uses case-insensitive matching for email mapping", async () => {
    const ctx: Partial<StatusContext> = {
      params: { includeGithubActivity: true },
      githubRepos: ["mozilla/firefox"],
      env: {
        GITHUB_API_KEY: "test-key",
        OPENAI_API_KEY: "test",
        BUGZILLA_API_KEY: "test",
      },
      hooks: {},
      emailMapping: {
        "alice@mozilla.org": "AliceDev",
      },
      sinceISO: "2025-10-21T00:00:00Z",
    };

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "abc123",
            commit: {
              message: "Fix bug",
              author: {
                name: "Alice",
                email: "alice@mozilla.org",
                date: "2025-10-22T10:00:00Z",
              },
            },
            author: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/commit/abc123",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () => {
        return HttpResponse.json([]);
      }),
    );

    await fetchGithubActivityStep.run(ctx as StatusContext);

    const alice = ctx.githubContributors?.get("alicedev");
    expect(alice?.bugzillaEmail).toBe("alice@mozilla.org");
  });
});
