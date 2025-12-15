export type GitHubCommit = {
  sha: string;
  message: string;
  author: string;
  authorEmail: string;
  date: string;
  url: string;
  stats?: {
    additions: number;
    deletions: number;
  };
};

export type GitHubPullRequest = {
  number: number;
  title: string;
  author: string;
  url: string;
  state: "open" | "closed" | "merged";
  mergedAt?: string;
  closedAt?: string;
  additions: number;
  deletions: number;
};

export type GitHubActivity = {
  repo: string;
  commits: GitHubCommit[];
  pullRequests: GitHubPullRequest[];
};

export type GitHubContributor = {
  githubUsername: string;
  bugzillaEmail?: string;
  commits: GitHubCommit[];
  pullRequests: GitHubPullRequest[];
};

// Raw API response types from GitHub API
export type GitHubRawCommit = {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
  author?: { login: string } | null;
  html_url: string;
};

export type GitHubRawPullRequest = {
  number: number;
  title: string;
  user: { login: string };
  html_url: string;
  state: string;
  merged_at?: string | null;
  closed_at?: string | null;
};

export type GitHubRawPullRequestDetails = {
  additions?: number;
  deletions?: number;
};
