import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../utils/msw/node";
import { JiraClient } from "../../src/status/jiraClient.ts";
import type { EnvLike } from "../../src/status/types.ts";

describe("JiraClient", () => {
  const env: EnvLike = {
    JIRA_URL: "https://test-org.atlassian.net",
    JIRA_API_KEY: "test-jira-token",
    OPENAI_API_KEY: "test-openai",
    BUGZILLA_API_KEY: "test-bz",
    SNAZZY_SKIP_CACHE: "true",
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2025-10-29T09:36:11Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws error if JIRA_URL is missing", () => {
    const badEnv = { ...env, JIRA_URL: undefined };
    expect(() => new JiraClient(badEnv as EnvLike)).toThrow(
      "JIRA_URL environment variable is required",
    );
  });

  it("throws error if JIRA_API_KEY is missing", () => {
    const badEnv = { ...env, JIRA_API_KEY: undefined };
    expect(() => new JiraClient(badEnv as EnvLike)).toThrow(
      "JIRA_API_KEY environment variable is required",
    );
  });

  it("fetches issues by JQL query", async () => {
    server.use(
      http.get(
        "https://test-org.atlassian.net/rest/api/3/search",
        ({ request }) => {
          const url = new URL(request.url);
          const jql = url.searchParams.get("jql");

          expect(jql).toContain("project = TEST");

          return HttpResponse.json({
            issues: [
              {
                key: "TEST-123",
                id: "10001",
                fields: {
                  summary: "Test issue summary",
                  project: {
                    key: "TEST",
                    name: "Test Project",
                  },
                  components: [{ name: "Backend" }],
                  status: {
                    name: "Done",
                    statusCategory: { key: "done" },
                  },
                  resolution: { name: "Fixed" },
                  assignee: {
                    displayName: "Alice Developer",
                    emailAddress: "alice@example.com",
                  },
                  updated: "2025-10-22T10:00:00.000+0000",
                  resolutiondate: "2025-10-22T10:00:00.000+0000",
                  labels: ["bug", "urgent"],
                  security: undefined,
                },
              },
            ],
            maxResults: 100,
            startAt: 0,
            total: 1,
          });
        },
      ),
    );

    const client = new JiraClient(env);
    const issues = await client.searchByJQL("project = TEST");

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      key: "TEST-123",
      id: "10001",
      summary: "Test issue summary",
      project: "TEST",
      projectName: "Test Project",
      component: "Backend",
      status: "Done",
      statusCategory: "done",
      resolution: "Fixed",
      assigneeDisplayName: "Alice Developer",
      assigneeEmail: "alice@example.com",
      labels: ["bug", "urgent"],
      isSecure: false,
    });
  });

  it("returns secure issues with security flag set", async () => {
    server.use(
      http.get("https://test-org.atlassian.net/rest/api/3/search", () => {
        return HttpResponse.json({
          issues: [
            {
              key: "TEST-123",
              id: "10001",
              fields: {
                summary: "Public issue",
                project: { key: "TEST", name: "Test Project" },
                status: {
                  name: "Done",
                  statusCategory: { key: "done" },
                },
                updated: "2025-10-22T10:00:00.000+0000",
                labels: [],
                security: undefined,
              },
            },
            {
              key: "TEST-124",
              id: "10002",
              fields: {
                summary: "Private issue",
                project: { key: "TEST", name: "Test Project" },
                status: {
                  name: "Done",
                  statusCategory: { key: "done" },
                },
                updated: "2025-10-22T10:00:00.000+0000",
                labels: [],
                security: { id: "10100", name: "Security Level" },
              },
            },
          ],
          maxResults: 100,
          startAt: 0,
          total: 2,
        });
      }),
    );

    const client = new JiraClient(env);
    const issues = await client.searchByJQL("project = TEST");

    expect(issues).toHaveLength(2);
    const publicIssue = issues.find((issue) => issue.key === "TEST-123");
    const secureIssue = issues.find((issue) => issue.key === "TEST-124");

    expect(publicIssue?.isSecure).toBe(false);
    expect(secureIssue?.isSecure).toBe(true);
  });

  it("fetches issues by project keys", async () => {
    server.use(
      http.get(
        "https://test-org.atlassian.net/rest/api/3/search",
        ({ request }) => {
          const url = new URL(request.url);
          const jql = url.searchParams.get("jql");

          expect(jql).toContain("project = TEST1");

          return HttpResponse.json({
            issues: [
              {
                key: "TEST1-42",
                id: "20001",
                fields: {
                  summary: "Issue from TEST1",
                  project: { key: "TEST1", name: "Test Project 1" },
                  status: {
                    name: "Done",
                    statusCategory: { key: "done" },
                  },
                  updated: "2025-10-23T12:00:00.000+0000",
                  labels: [],
                  security: undefined,
                },
              },
            ],
            maxResults: 100,
            startAt: 0,
            total: 1,
          });
        },
      ),
    );

    const client = new JiraClient(env);
    const issues = await client.fetchIssuesByProjects(["TEST1"], 7);

    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe("TEST1-42");
    expect(issues[0].project).toBe("TEST1");
  });

  it("fetches changelogs for issues", async () => {
    server.use(
      http.get(
        "https://test-org.atlassian.net/rest/api/3/issue/TEST-123/changelog",
        ({ request }) => {
          const url = new URL(request.url);
          const startAt = url.searchParams.get("startAt");
          const maxResults = url.searchParams.get("maxResults");

          expect(startAt).toBe("0");
          expect(maxResults).toBe("100");

          return HttpResponse.json({
            total: 1,
            maxResults: 100,
            startAt: 0,
            histories: [
              {
                id: "100001",
                created: "2025-10-22T10:00:00.000+0000",
                items: [
                  {
                    field: "status",
                    fieldtype: "jira",
                    from: "3",
                    fromString: "In Progress",
                    to: "10000",
                    toString: "Done",
                  },
                ],
              },
            ],
          });
        },
      ),
    );

    const client = new JiraClient(env);
    const histories = await client.fetchChangelogs(["TEST-123"], {});

    expect(histories).toHaveLength(1);
    expect(histories[0].key).toBe("TEST-123");
    expect(histories[0].changelog).toHaveLength(1);
    expect(histories[0].changelog[0].items[0]).toMatchObject({
      field: "status",
      fromString: "In Progress",
      toString: "Done",
    });
  });

  it("generates correct JQL for project filtering", () => {
    const client = new JiraClient(env);
    const jql = client.generateProjectJQL("MYPROJ", 7);

    expect(jql).toBe(
      "project = MYPROJ AND statusCategory = Done AND updated >= -7d",
    );
  });

  it("handles pagination correctly", async () => {
    let callCount = 0;

    server.use(
      http.get(
        "https://test-org.atlassian.net/rest/api/3/search",
        ({ request }) => {
          const url = new URL(request.url);
          const startAt = Number.parseInt(
            url.searchParams.get("startAt") ?? "0",
            10,
          );

          callCount++;

          if (startAt === 0) {
            return HttpResponse.json({
              issues: Array.from({ length: 100 }, (_, i) => ({
                key: `TEST-${i + 1}`,
                id: `${10_000 + i}`,
                fields: {
                  summary: `Issue ${i + 1}`,
                  project: { key: "TEST", name: "Test Project" },
                  status: {
                    name: "Done",
                    statusCategory: { key: "done" },
                  },
                  updated: "2025-10-22T10:00:00.000+0000",
                  labels: [],
                  security: undefined,
                },
              })),
              maxResults: 100,
              startAt: 0,
              total: 150,
            });
          }
          return HttpResponse.json({
            issues: Array.from({ length: 50 }, (_, i) => ({
              key: `TEST-${i + 101}`,
              id: `${10_100 + i}`,
              fields: {
                summary: `Issue ${i + 101}`,
                project: { key: "TEST", name: "Test Project" },
                status: {
                  name: "Done",
                  statusCategory: { key: "done" },
                },
                updated: "2025-10-22T10:00:00.000+0000",
                labels: [],
                security: undefined,
              },
            })),
            maxResults: 100,
            startAt: 100,
            total: 150,
          });
        },
      ),
    );

    const client = new JiraClient(env);
    const issues = await client.searchByJQL("project = TEST");

    expect(callCount).toBe(2);
    expect(issues).toHaveLength(150);
    expect(issues[0].key).toBe("TEST-1");
    expect(issues[149].key).toBe("TEST-150");
  });
});
