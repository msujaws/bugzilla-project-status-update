import type { CommitPatch } from "../patch.ts";
import type { CandidateCollection } from "./candidateCollector.ts";
import type { BugzillaClient } from "./bugzillaClient.ts";
import type { SummarizerResult } from "./summarizer.ts";
import type {
  Bug,
  BugHistoryEntry,
  EnvLike,
  GenerateParams,
  ProductComponent,
  ProgressHooks,
} from "./types.ts";

export const MAX_BUGS_FOR_OPENAI = 60;

export type AudienceOption = "technical" | "product" | "leadership";
export type VoiceOption = "normal" | "pirate" | "snazzy-robot";

export type StatusStepName =
  | "fetch-prequalified"
  | "log-window"
  | "collect-candidates"
  | "fetch-histories"
  | "filter-by-history"
  | "handle-empty"
  | "limit-openai"
  | "load-patch-context"
  | "summarize-openai"
  | "format-output";

export interface StatusContext {
  params: GenerateParams;
  env: EnvLike;
  hooks: ProgressHooks;
  client: BugzillaClient;
  includePatchContext: boolean;
  isDebug: boolean;
  debugLog?: (message: string) => void;
  days: number;
  sinceISO: string;
  components: ProductComponent[];
  whiteboards: string[];
  metabugs: number[];
  assignees: string[];
  voice: VoiceOption;
  audience: AudienceOption;
  model: string;
  format: string;
  collection?: CandidateCollection;
  candidates: Bug[];
  histories: BugHistoryEntry[];
  byIdHistory: Map<number, BugHistoryEntry>;
  finalBugs: Bug[];
  aiCandidates: Bug[];
  providedBugs: Bug[];
  trimmedCount: number;
  patchContext: Map<number, CommitPatch[]>;
  openAiResponse?: SummarizerResult;
  output?: string;
  html?: string;
  buglistLink?: string;
  ids: number[];
}
