import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { summarizeWithOpenAI } from "../../src/status/summarizer.ts";
import type { EnvLike } from "../../src/status/types.ts";
import type { GitHubContributor } from "../../src/status/githubTypes.ts";

const env: EnvLike = {
  BUGZILLA_API_KEY: "test-bz",
  OPENAI_API_KEY: "test-openai",
};

const okResponse = () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ assessments: [], summary_md: "ok" }),
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const contributor = (username: string): GitHubContributor => ({
  githubUsername: username,
  commits: [
    {
      sha: "abc123",
      message: "feat: add a thing",
      author: username,
      authorEmail: `${username}@example.com`,
      date: "2026-01-02T00:00:00Z",
      url: `https://github.com/org/repo/commit/abc123`,
      stats: { additions: 10, deletions: 2 },
    } as GitHubContributor["commits"][number],
  ],
  pullRequests: [
    {
      number: 42,
      title: "Add a thing",
      author: username,
      url: `https://github.com/org/repo/pull/42`,
      state: "merged",
      additions: 10,
      deletions: 2,
    } as GitHubContributor["pullRequests"][number],
  ],
});

describe("summarizeWithOpenAI GitHub-only", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let lastUserMessage = "";

  beforeEach(() => {
    lastUserMessage = "";
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ content?: string }>;
        };
        lastUserMessage = body.messages?.[1]?.content ?? "";
        return okResponse();
      });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("frames GitHub activity as the subject and avoids the 'no bugs' framing", async () => {
    const githubContributors = new Map<string, GitHubContributor>([
      ["alicedev", contributor("alicedev")],
    ]);

    await summarizeWithOpenAI(
      env,
      "gpt-5-mini",
      [],
      154,
      "normal",
      "technical",
      {
        githubContributors,
        jiraIssues: [],
      },
    );

    expect(lastUserMessage).not.toMatch(/no bugs or issues to summarize/i);
    expect(lastUserMessage).toContain("@alicedev");
    expect(lastUserMessage).toMatch(/GitHub contributions only/i);
    // The model is explicitly told not to lead with a "nothing happened" line.
    expect(lastUserMessage).toMatch(/the GitHub work below IS the report/i);
  });

  it("keeps the empty message when there is no GitHub activity either", async () => {
    await summarizeWithOpenAI(
      env,
      "gpt-5-mini",
      [],
      154,
      "normal",
      "technical",
      {
        githubContributors: new Map(),
        jiraIssues: [],
      },
    );

    expect(lastUserMessage).toContain("No bugs or issues to summarize.");
  });
});
