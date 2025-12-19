import type { Bug } from "./types.ts";
import type { JiraIssue } from "./jiraTypes.ts";
import type {
  GitHubActivity,
  GitHubCommit,
  GitHubPullRequest,
} from "./githubTypes.ts";

const RESOLVED_BUG_STATUSES = new Set(["RESOLVED", "VERIFIED", "CLOSED"]);
const JIRA_DONE_STATUS = "done";

const isAfterSince = (dateString: string | undefined, sinceISO?: string) => {
  if (!sinceISO) return true;
  if (!dateString) return false;
  const since = Date.parse(sinceISO);
  const when = Date.parse(dateString);
  if (Number.isNaN(since) || Number.isNaN(when)) return false;
  return when >= since;
};

export const isRestrictedBug = (groups?: string[]): boolean => {
  return (
    !!groups?.some((group) => /security/i.test(group)) ||
    !!groups?.some((group) => /confidential/i.test(group))
  );
};

export const qualifiesBugSnapshot = (bug: Bug, sinceISO?: string): boolean => {
  const statusOk = RESOLVED_BUG_STATUSES.has(bug.status);
  const resolutionOk = bug.resolution === "FIXED";
  const timeOk = isAfterSince(bug.last_change_time, sinceISO);
  return statusOk && resolutionOk && timeOk;
};

export const partitionRestrictedBugs = (bugs: Bug[]) => {
  const restricted: Bug[] = [];
  const unrestricted: Bug[] = [];
  for (const bug of bugs) {
    if (isRestrictedBug(bug.groups)) {
      restricted.push(bug);
    } else {
      unrestricted.push(bug);
    }
  }
  return { restricted, unrestricted };
};

export const qualifiesJiraIssue = (
  issue: JiraIssue,
  sinceISO?: string,
): boolean => {
  const statusOk = issue.statusCategory.toLowerCase() === JIRA_DONE_STATUS;
  const timeOk = isAfterSince(issue.updated, sinceISO);
  const securityOk = !issue.isSecure;
  return statusOk && timeOk && securityOk;
};

export const filterJiraIssues = (issues: JiraIssue[], sinceISO?: string) => {
  const qualified: JiraIssue[] = [];
  let excludedSecure = 0;
  let excludedStatus = 0;
  let excludedStale = 0;

  for (const issue of issues) {
    if (issue.isSecure) {
      excludedSecure++;
      continue;
    }
    if (issue.statusCategory.toLowerCase() !== JIRA_DONE_STATUS) {
      excludedStatus++;
      continue;
    }
    if (!isAfterSince(issue.updated, sinceISO)) {
      excludedStale++;
      continue;
    }
    qualified.push(issue);
  }

  return { qualified, excludedSecure, excludedStatus, excludedStale };
};

const filterCommitsBySince = (commits: GitHubCommit[], sinceISO?: string) =>
  commits.filter((commit) => isAfterSince(commit.date, sinceISO));

const filterPullRequestsBySince = (
  pullRequests: GitHubPullRequest[],
  sinceISO?: string,
) => pullRequests.filter((pr) => isAfterSince(pr.closedAt, sinceISO));

export const filterGithubActivity = (
  activity: GitHubActivity,
  sinceISO?: string,
) => {
  const commits = filterCommitsBySince(activity.commits, sinceISO);
  const pullRequests = filterPullRequestsBySince(
    activity.pullRequests,
    sinceISO,
  );
  return {
    activity: {
      ...activity,
      commits,
      pullRequests,
    },
    droppedCommits: activity.commits.length - commits.length,
    droppedPullRequests: activity.pullRequests.length - pullRequests.length,
  };
};
