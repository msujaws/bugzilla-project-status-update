import type { StatusStepName } from "./context.ts";

/**
 * Configuration for phase reporting in the state machine.
 * Maps step names to their friendly display names.
 * Steps without entries will not emit phases.
 */
export const STEP_PHASE_CONFIG: Partial<Record<StatusStepName, string>> = {
  "fetch-prequalified": "Loading bugs",
  "collect-candidates": "Collecting candidate bugs",
  "fetch-histories": "Fetching bug histories",
  "filter-by-history": "Filtering by history",
  "collect-jira-issues": "Collecting Jira issues",
  "fetch-jira-changelogs": "Fetching Jira changelogs",
  "filter-jira-by-history": "Filtering Jira by history",
  "fetch-github-activity": "Fetching GitHub activity",
  "load-patch-context": "Loading commit context",
  "summarize-openai": "Generating AI summary",
  "format-output": "Formatting output",
};

/**
 * Friendly names for sub-operation phases.
 * These are used by individual operations for granular progress tracking.
 */
export const SUB_OPERATION_PHASES = {
  PATCH_CONTEXT: "Loading commit context",
  COLLECT_WHITEBOARDS: "Collecting whiteboard bugs",
  HISTORIES: "Fetching bug histories",
  OPENAI: "Generating AI summary",
} as const;
