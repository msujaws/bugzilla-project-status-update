import { describe, expect, it } from "vitest";
import {
  filterGithubActivity,
  filterJiraIssues,
  qualifiesBugSnapshot,
} from "../../src/status/qualification.ts";
import type { GitHubActivity } from "../../src/status/githubTypes.ts";
import type { JiraIssue } from "../../src/status/jiraTypes.ts";
import type { Bug } from "../../src/status/types.ts";

describe("qualification helpers", () => {
  it("filters Jira issues by security, status, and updated window", () => {
    const sinceISO = "2025-10-20T00:00:00Z";
    const issues: JiraIssue[] = [
      {
        key: "APP-1",
        id: "1",
        summary: "Done issue",
        project: "APP",
        projectName: "App",
        status: "Done",
        statusCategory: "done",
        updated: "2025-10-22T10:00:00Z",
        labels: [],
        isSecure: false,
      },
      {
        key: "APP-2",
        id: "2",
        summary: "Secure issue",
        project: "APP",
        projectName: "App",
        status: "Done",
        statusCategory: "done",
        updated: "2025-10-22T10:00:00Z",
        labels: [],
        isSecure: true,
      },
      {
        key: "APP-3",
        id: "3",
        summary: "In progress",
        project: "APP",
        projectName: "App",
        status: "In Progress",
        statusCategory: "in-progress",
        updated: "2025-10-22T10:00:00Z",
        labels: [],
        isSecure: false,
      },
      {
        key: "APP-4",
        id: "4",
        summary: "Stale done",
        project: "APP",
        projectName: "App",
        status: "Done",
        statusCategory: "done",
        updated: "2025-10-01T10:00:00Z",
        labels: [],
        isSecure: false,
      },
    ];

    const result = filterJiraIssues(issues, sinceISO);

    expect(result.qualified.map((issue) => issue.key)).toEqual(["APP-1"]);
    expect(result.excludedSecure).toBe(1);
    expect(result.excludedStatus).toBe(1);
    expect(result.excludedStale).toBe(1);
  });

  it("filters GitHub activity by since window", () => {
    const sinceISO = "2025-10-20T00:00:00Z";
    const activity: GitHubActivity = {
      repo: "mozilla/firefox",
      commits: [
        {
          sha: "old",
          message: "Old commit",
          author: "alice",
          authorEmail: "alice@example.com",
          date: "2025-10-01T10:00:00Z",
          url: "https://github.com/old",
        },
        {
          sha: "new",
          message: "New commit",
          author: "bob",
          authorEmail: "bob@example.com",
          date: "2025-10-22T10:00:00Z",
          url: "https://github.com/new",
        },
      ],
      pullRequests: [
        {
          number: 1,
          title: "Old PR",
          author: "alice",
          url: "https://github.com/pr/1",
          state: "closed",
          closedAt: "2025-10-01T10:00:00Z",
          additions: 0,
          deletions: 0,
        },
        {
          number: 2,
          title: "New PR",
          author: "bob",
          url: "https://github.com/pr/2",
          state: "merged",
          closedAt: "2025-10-22T10:00:00Z",
          mergedAt: "2025-10-22T10:00:00Z",
          additions: 10,
          deletions: 2,
        },
      ],
    };

    const result = filterGithubActivity(activity, sinceISO);

    expect(result.activity.commits.map((commit) => commit.sha)).toEqual([
      "new",
    ]);
    expect(result.activity.pullRequests.map((pr) => pr.number)).toEqual([2]);
    expect(result.droppedCommits).toBe(1);
    expect(result.droppedPullRequests).toBe(1);
  });

  it("qualifies Bugzilla snapshots by status, resolution, and time", () => {
    const sinceISO = "2025-10-20T00:00:00Z";
    const bug: Bug = {
      id: 123,
      summary: "Fixed bug",
      product: "Core",
      component: "Widget",
      status: "RESOLVED",
      resolution: "FIXED",
      last_change_time: "2025-10-21T12:00:00Z",
      groups: [],
    };
    const staleBug: Bug = {
      ...bug,
      id: 124,
      last_change_time: "2025-10-01T12:00:00Z",
    };
    const openBug: Bug = {
      ...bug,
      id: 125,
      status: "NEW",
    };

    expect(qualifiesBugSnapshot(bug, sinceISO)).toBe(true);
    expect(qualifiesBugSnapshot(staleBug, sinceISO)).toBe(false);
    expect(qualifiesBugSnapshot(openBug, sinceISO)).toBe(false);
  });
});
