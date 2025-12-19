import type { CommitPatch } from "../patch.ts";
import type { CandidateCollection } from "./candidateCollector.ts";
import type { BugzillaClient } from "./bugzillaClient.ts";
import type { JiraClient } from "./jiraClient.ts";
import type { SummarizerResult } from "./summarizer.ts";
import type {
  Bug,
  BugHistoryEntry,
  DebugLog,
  EnvLike,
  GenerateParams,
  ProductComponent,
  ProgressHooks,
} from "./types.ts";
import type { GitHubActivity, GitHubContributor } from "./githubTypes.ts";
import type { JiraIssue, JiraIssueHistory } from "./jiraTypes.ts";

export const MAX_BUGS_FOR_OPENAI = 60;

export type AudienceOption = "technical" | "product" | "leadership";
export type VoiceOption = "normal" | "pirate" | "snazzy-robot";

export type StatusStepName =
  | "fetch-prequalified"
  | "log-window"
  | "collect-candidates"
  | "fetch-histories"
  | "filter-by-history"
  | "collect-jira-issues"
  | "fetch-jira-changelogs"
  | "filter-jira-by-history"
  | "handle-empty"
  | "limit-openai"
  | "load-patch-context"
  | "fetch-github-activity"
  | "summarize-openai"
  | "format-output";

export interface StatusContext {
  params: GenerateParams;
  env: EnvLike;
  hooks: ProgressHooks;
  client: BugzillaClient;
  jiraClient?: JiraClient;
  includePatchContext: boolean;
  isDebug: boolean;
  debugLog?: DebugLog;
  days: number;
  sinceISO: string;
  components: ProductComponent[];
  whiteboards: string[];
  metabugs: number[];
  assignees: string[];
  jiraProjects: string[];
  jiraJql: string[];
  voice: VoiceOption;
  audience: AudienceOption;
  model: string;
  format: string;
  collection?: CandidateCollection;
  candidates: Bug[];
  histories: BugHistoryEntry[];
  byIdHistory: Map<number, BugHistoryEntry>;
  jiraIssues: JiraIssue[];
  jiraHistories: JiraIssueHistory[];
  byKeyJiraHistory: Map<string, JiraIssueHistory>;
  finalJiraIssues: JiraIssue[];
  finalBugs: Bug[];
  aiCandidates: Bug[];
  providedBugs: Bug[];
  trimmedCount: number;
  patchContext: Map<number, CommitPatch[]>;
  githubRepos: string[];
  emailMapping: Record<string, string>;
  githubActivity: GitHubActivity[];
  githubContributors: Map<string, GitHubContributor>;
  githubStats?: {
    candidates: { commits: number; prs: number };
    qualified: { commits: number; prs: number };
  };
  openAiResponse?: SummarizerResult;
  output?: string;
  html?: string;
  buglistLink?: string;
  ids: number[];
}
