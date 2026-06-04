import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../utils/msw/node";
import { collectGithubContributors } from "../../src/status/githubStage.ts";
import type { EnvLike } from "../../src/status/types.ts";

const env: EnvLike = {
  GITHUB_API_KEY: "test-gh-token",
  OPENAI_API_KEY: "test-openai",
  BUGZILLA_API_KEY: "test-bz",
};

const hooks = {};

function mockFirefoxCommits() {
  return http.get(
    "https://api.github.com/repos/mozilla/firefox/commits",
    () => {
      return HttpResponse.json([
        {
          sha: "abc123",
          commit: {
            message: "Alice commit",
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
          sha: "def456",
          commit: {
            message: "Bob commit",
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
    },
  );
}

describe("collectGithubContributors – githubUsernames filter", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2025-10-29T09:36:11Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps all contributors when githubUsernames is empty", async () => {
    server.use(
      mockFirefoxCommits(),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () =>
        HttpResponse.json([]),
      ),
    );

    const { contributors } = await collectGithubContributors(
      env,
      {
        githubRepos: ["mozilla/firefox"],
        emailMapping: {},
        githubUsernames: [],
        sinceISO: "2025-10-21T00:00:00Z",
        includeGithubActivity: true,
      },
      hooks,
    );

    expect(contributors.size).toBe(2);
    expect(contributors.has("alicedev")).toBe(true);
    expect(contributors.has("bobdev")).toBe(true);
  });

  it("keeps only the listed usernames when githubUsernames is provided", async () => {
    server.use(
      mockFirefoxCommits(),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () =>
        HttpResponse.json([]),
      ),
    );

    const { contributors } = await collectGithubContributors(
      env,
      {
        githubRepos: ["mozilla/firefox"],
        emailMapping: {},
        githubUsernames: ["alicedev"],
        sinceISO: "2025-10-21T00:00:00Z",
        includeGithubActivity: true,
      },
      hooks,
    );

    expect(contributors.size).toBe(1);
    expect(contributors.has("alicedev")).toBe(true);
    expect(contributors.has("bobdev")).toBe(false);
  });

  it("searches GitHub by username when no repos are provided", async () => {
    let commitQuery = "";
    server.use(
      http.get("https://api.github.com/search/commits", ({ request }) => {
        commitQuery = new URL(request.url).searchParams.get("q") ?? "";
        return HttpResponse.json({
          total_count: 1,
          items: [
            {
              sha: "abc123",
              commit: {
                message: "Cross-repo commit",
                author: {
                  name: "Alice",
                  email: "alice@mozilla.org",
                  date: "2025-10-22T10:00:00Z",
                },
              },
              author: { login: "alicedev" },
              html_url: "https://github.com/mozilla/firefox/commit/abc123",
              repository: { full_name: "mozilla/firefox" },
            },
          ],
        });
      }),
      http.get("https://api.github.com/search/issues", () =>
        HttpResponse.json({ total_count: 0, items: [] }),
      ),
    );

    const { contributors } = await collectGithubContributors(
      env,
      {
        githubRepos: [],
        emailMapping: {},
        githubUsernames: ["alicedev"],
        githubOrgs: ["mozilla"],
        sinceISO: "2025-10-21T00:00:00Z",
        includeGithubActivity: true,
      },
      hooks,
    );

    expect(commitQuery).toContain("author:alicedev");
    expect(commitQuery).toContain("org:mozilla");
    expect(contributors.size).toBe(1);
    expect(contributors.get("alicedev")?.commits[0].message).toBe(
      "Cross-repo commit",
    );
  });

  it("returns empty when neither repos nor usernames are provided", async () => {
    const { contributors } = await collectGithubContributors(
      env,
      {
        githubRepos: [],
        emailMapping: {},
        githubUsernames: [],
        githubOrgs: [],
        sinceISO: "2025-10-21T00:00:00Z",
        includeGithubActivity: true,
      },
      hooks,
    );
    expect(contributors.size).toBe(0);
  });

  it("matches usernames case-insensitively", async () => {
    server.use(
      mockFirefoxCommits(),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls", () =>
        HttpResponse.json([]),
      ),
    );

    const { contributors } = await collectGithubContributors(
      env,
      {
        githubRepos: ["mozilla/firefox"],
        emailMapping: {},
        githubUsernames: ["BobDev"],
        sinceISO: "2025-10-21T00:00:00Z",
        includeGithubActivity: true,
      },
      hooks,
    );

    expect(contributors.size).toBe(1);
    expect(contributors.has("bobdev")).toBe(true);
  });
});
