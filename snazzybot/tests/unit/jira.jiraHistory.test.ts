import { describe, expect, it } from "vitest";
import { qualifiesByJiraHistory } from "../../src/status/jiraHistory.ts";
import type { JiraIssueHistory } from "../../src/status/jiraTypes.ts";

describe("qualifiesByJiraHistory", () => {
  const sinceISO = "2025-10-21T00:00:00Z";

  it("qualifies when issue transitions to Done within time window", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [
        {
          id: "100001",
          created: "2025-10-22T10:00:00Z",
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
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(true);
  });

  it("qualifies when issue transitions to Resolved within time window", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [
        {
          id: "100001",
          created: "2025-10-22T10:00:00Z",
          items: [
            {
              field: "status",
              fieldtype: "jira",
              from: "3",
              fromString: "In Progress",
              to: "10001",
              toString: "Resolved",
            },
          ],
        },
      ],
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(true);
  });

  it("qualifies when issue transitions to Closed within time window", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [
        {
          id: "100001",
          created: "2025-10-22T10:00:00Z",
          items: [
            {
              field: "status",
              fieldtype: "jira",
              from: "3",
              fromString: "In Progress",
              to: "10002",
              toString: "Closed",
            },
          ],
        },
      ],
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(true);
  });

  it("qualifies when issue transitions to Complete within time window", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [
        {
          id: "100001",
          created: "2025-10-22T10:00:00Z",
          items: [
            {
              field: "status",
              fieldtype: "jira",
              from: "3",
              fromString: "In Progress",
              to: "10003",
              toString: "Complete",
            },
          ],
        },
      ],
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(true);
  });

  it("does not qualify when status change is before time window", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [
        {
          id: "100001",
          created: "2025-10-20T10:00:00Z",
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
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(false);
  });

  it("does not qualify when no status change to Done", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [
        {
          id: "100001",
          created: "2025-10-22T10:00:00Z",
          items: [
            {
              field: "status",
              fieldtype: "jira",
              from: "1",
              fromString: "To Do",
              to: "3",
              toString: "In Progress",
            },
          ],
        },
      ],
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(false);
  });

  it("qualifies when one of multiple changes is to Done", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [
        {
          id: "100001",
          created: "2025-10-20T10:00:00Z",
          items: [
            {
              field: "status",
              fieldtype: "jira",
              from: "1",
              fromString: "To Do",
              to: "3",
              toString: "In Progress",
            },
          ],
        },
        {
          id: "100002",
          created: "2025-10-22T10:00:00Z",
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
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(true);
  });

  it("does not qualify with empty changelog", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [],
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(false);
  });

  it("does not qualify when status field has no toString value", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [
        {
          id: "100001",
          created: "2025-10-22T10:00:00Z",
          items: [
            {
              field: "status",
              fieldtype: "jira",
              from: "3",
              fromString: "In Progress",
              to: "10000",
              toString: undefined,
            },
          ],
        },
      ],
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(false);
  });

  it("handles mixed case status names", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [
        {
          id: "100001",
          created: "2025-10-22T10:00:00Z",
          items: [
            {
              field: "status",
              fieldtype: "jira",
              from: "3",
              fromString: "In Progress",
              to: "10000",
              toString: "DONE",
            },
          ],
        },
      ],
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(true);
  });

  it("ignores non-status field changes", () => {
    const history: JiraIssueHistory = {
      key: "TEST-123",
      changelog: [
        {
          id: "100001",
          created: "2025-10-22T10:00:00Z",
          items: [
            {
              field: "assignee",
              fieldtype: "jira",
              from: "alice",
              fromString: "Alice",
              to: "bob",
              toString: "Bob",
            },
            {
              field: "priority",
              fieldtype: "jira",
              from: "3",
              fromString: "Medium",
              to: "2",
              toString: "High",
            },
          ],
        },
      ],
    };

    expect(qualifiesByJiraHistory(history, sinceISO)).toBe(false);
  });
});
