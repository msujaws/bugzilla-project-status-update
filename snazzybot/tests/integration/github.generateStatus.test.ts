import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../utils/msw/node";
import { generateStatus } from "../../src/core.ts";

const env = {
  OPENAI_API_KEY: "test-openai",
  BUGZILLA_API_KEY: "test-bz",
  GITHUB_API_KEY: "test-gh",
};

describe("GitHub integration (with MSW mocks)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2025-10-29T09:36:11Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes GitHub activity in status when repos provided", async () => {
    let capturedOpenAi: unknown;

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "abc123",
            commit: {
              message: "Fix critical bug",
              author: {
                name: "Alice Dev",
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
        return HttpResponse.json([
          {
            number: 123,
            title: "Add new feature",
            user: { login: "alicedev" },
            html_url: "https://github.com/mozilla/firefox/pull/123",
            state: "closed",
            merged_at: "2025-10-23T11:00:00Z",
            closed_at: "2025-10-23T11:00:00Z",
          },
        ]);
      }),
      http.get("https://api.github.com/repos/mozilla/firefox/pulls/123", () => {
        return HttpResponse.json({
          additions: 150,
          deletions: 25,
        });
      }),
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request }) => {
          capturedOpenAi = await request.json();
          return HttpResponse.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assessments: [
                      {
                        bug_id: 1_987_802,
                        impact_score: 7,
                        short_reason: "Important fix",
                        demo_suggestion: "Test the fix",
                      },
                    ],
                    summary_md:
                      "### Weekly status\n- Fixed critical bug\n- GitHub activity included.",
                  }),
                },
              },
            ],
          });
        },
      ),
    );

    const { output } = await generateStatus(
      {
        days: 8,
        components: [{ product: "Firefox", component: "General" }],
        githubRepos: ["mozilla/firefox"],
        emailMapping: { "alice@mozilla.org": "alicedev" },
        includeGithubActivity: true,
      },
      env,
    );

    const payload = capturedOpenAi as
      | { messages?: Array<{ role: string; content: string }> }
      | undefined;

    expect(payload?.messages?.[1]?.content).toContain("GitHub Activity");
    expect(payload?.messages?.[1]?.content).toContain("@alicedev");
    expect(payload?.messages?.[1]?.content).toContain("Fix critical bug");
    expect(payload?.messages?.[1]?.content).toContain(
      "https://github.com/mozilla/firefox/commit/abc123",
    );
    expect(payload?.messages?.[1]?.content).toContain("Add new feature");
    expect(payload?.messages?.[1]?.content).toContain(
      "https://github.com/mozilla/firefox/pull/123",
    );
    expect(output).toContain("GitHub activity included");
  });

  it("continues with only GitHub activity when zero Bugzilla bugs found", async () => {
    const hooks = {
      info: vi.fn(),
      warn: vi.fn(),
      phase: vi.fn(),
      progress: vi.fn(),
    };

    server.resetHandlers();
    server.use(
      // Return empty Bugzilla results for all queries
      http.get("https://bugzilla.mozilla.org/rest/bug", () => {
        return HttpResponse.json({ bugs: [] });
      }),
      // Return empty history
      http.get("https://bugzilla.mozilla.org/rest/bug/:id/history", () => {
        return HttpResponse.json({ bugs: [] });
      }),
      // Return empty Bugzilla XML
      http.get("https://bugzilla.mozilla.org/show_bug.cgi", () => {
        return HttpResponse.text(
          '<?xml version="1.0" encoding="UTF-8"?><bugzilla></bugzilla>',
          { headers: { "content-type": "text/xml; charset=utf-8" } },
        );
      }),
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
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assessments: [],
                  summary_md: "### GitHub Activity\n- Contributions made.",
                }),
              },
            },
          ],
        });
      }),
    );

    const envWithSkipCache = { ...env, SNAZZY_SKIP_CACHE: "true" };

    const { output, ids } = await generateStatus(
      {
        days: 8,
        components: [{ product: "Firefox", component: "General" }],
        githubRepos: ["mozilla/firefox"],
        emailMapping: { "alice@mozilla.org": "alicedev" },
        includeGithubActivity: true,
      },
      envWithSkipCache,
      hooks,
    );

    expect(ids).toEqual([]);
    expect(output).toContain("GitHub Activity");
    expect(hooks.info).toHaveBeenCalledWith(
      expect.stringContaining(
        "No Bugzilla bugs found, but found 1 GitHub contributors",
      ),
    );
  });

  it("maps GitHub activity to Bugzilla emails correctly", async () => {
    let capturedOpenAi: unknown;

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "abc123",
            commit: {
              message: "Commit by Alice",
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
              message: "Commit by Bob",
              author: {
                name: "Bob",
                email: "bob@mozilla.org",
                date: "2025-10-22T11:00:00Z",
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
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request }) => {
          capturedOpenAi = await request.json();
          return HttpResponse.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assessments: [],
                    summary_md: "### Status\n- Activity tracked.",
                  }),
                },
              },
            ],
          });
        },
      ),
    );

    await generateStatus(
      {
        ids: [],
        days: 8,
        githubRepos: ["mozilla/firefox"],
        emailMapping: {
          "alice@mozilla.org": "alicedev",
          "bob@mozilla.org": "bobdev",
        },
        includeGithubActivity: true,
      },
      env,
    );

    const payload = capturedOpenAi as
      | { messages?: Array<{ content: string }> }
      | undefined;

    const content = payload?.messages?.[1]?.content ?? "";
    expect(content).toContain("@alicedev");
    expect(content).toContain("Bugzilla Email: alice@mozilla.org");
    expect(content).toContain("@bobdev");
    expect(content).toContain("Bugzilla Email: bob@mozilla.org");
  });

  it("skips GitHub integration when no API key provided", async () => {
    const hooks = {
      info: vi.fn(),
      warn: vi.fn(),
      phase: vi.fn(),
      progress: vi.fn(),
    };

    const envNoGithub = {
      OPENAI_API_KEY: "test-openai",
      BUGZILLA_API_KEY: "test-bz",
    };

    const { output } = await generateStatus(
      {
        days: 8,
        components: [{ product: "Firefox", component: "IP Protection" }],
        githubRepos: ["mozilla/firefox"],
        includeGithubActivity: true,
      },
      envNoGithub,
      hooks,
    );

    expect(hooks.warn).toHaveBeenCalledWith(
      expect.stringContaining("GitHub API key not provided"),
    );
    expect(output).not.toContain("GitHub Activity");
  });

  it("handles multiple repos with different contributors", async () => {
    let capturedOpenAi: unknown;

    server.use(
      http.get("https://api.github.com/repos/mozilla/firefox/commits", () => {
        return HttpResponse.json([
          {
            sha: "abc123",
            commit: {
              message: "Firefox commit",
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
              message: "DevTools commit",
              author: {
                name: "Bob",
                email: "bob@mozilla.org",
                date: "2025-10-22T11:00:00Z",
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
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request }) => {
          capturedOpenAi = await request.json();
          return HttpResponse.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assessments: [],
                    summary_md: "### Status\n- Multi-repo activity.",
                  }),
                },
              },
            ],
          });
        },
      ),
    );

    await generateStatus(
      {
        ids: [],
        days: 8,
        githubRepos: ["mozilla/firefox", "mozilla/devtools"],
        emailMapping: {
          "alice@mozilla.org": "alicedev",
          "bob@mozilla.org": "bobdev",
        },
        includeGithubActivity: true,
      },
      env,
    );

    const payload = capturedOpenAi as
      | { messages?: Array<{ content: string }> }
      | undefined;

    const content = payload?.messages?.[1]?.content ?? "";
    expect(content).toContain("@alicedev");
    expect(content).toContain("Firefox commit");
    expect(content).toContain("@bobdev");
    expect(content).toContain("DevTools commit");
  });

  it("continues when one repo fails and others succeed", async () => {
    const hooks = {
      info: vi.fn(),
      warn: vi.fn(),
      phase: vi.fn(),
      progress: vi.fn(),
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
              message: "Success commit",
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
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assessments: [],
                  summary_md: "### GitHub Activity\n- Contributions made.",
                }),
              },
            },
          ],
        });
      }),
    );

    const { output } = await generateStatus(
      {
        ids: [],
        days: 8,
        githubRepos: ["mozilla/nonexistent", "mozilla/firefox"],
        emailMapping: {},
        includeGithubActivity: true,
      },
      env,
      hooks,
    );

    expect(hooks.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to fetch GitHub activity for mozilla/nonexistent",
      ),
    );
    expect(output).toContain("GitHub Activity");
  });
});
