import { isoDaysAgo } from "../utils/time.ts";
import { BugzillaClient } from "./bugzillaClient.ts";
import { JiraClient } from "./jiraClient.ts";
import { runRecipe, type RecipeStep } from "./stateMachine.ts";
import { collectCandidates } from "./candidateCollector.ts";
import { qualifiesByHistory } from "./history.ts";
import {
  type AudienceOption,
  type StatusContext,
  type StatusStepName,
  type VoiceOption,
} from "./context.ts";
import {
  collectCandidatesStep,
  collectJiraIssuesStep,
  fetchGithubActivityStep,
  fetchHistoriesStep,
  fetchJiraChangelogsStep,
  fetchPrequalifiedStep,
  filterByHistoryStep,
  filterJiraByHistoryStep,
  formatOutputStep,
  handleEmptyStep,
  limitOpenAiStep,
  loadPatchContextStep,
  logWindowStep,
  summarizeOpenAiStep,
} from "./steps/index.ts";
import { logWindowContext } from "./recipeHelpers.ts";
import { STEP_PHASE_CONFIG } from "./phases.ts";
import type {
  Bug,
  DebugLog,
  EnvLike,
  GenerateParams,
  ProgressHooks,
} from "./types.ts";

const defaultHooks: ProgressHooks = {};

const defaultAudience = (idsProvided: boolean, audience?: AudienceOption) => {
  if (audience) return audience;
  return idsProvided ? "product" : "technical";
};

const defaultVoice = (voice?: VoiceOption): VoiceOption => voice ?? "normal";

const defaultModel = (model?: string) => model ?? "gpt-5";

const debugLogger = (enabled: boolean, hooks: ProgressHooks): DebugLog => {
  return (message, options) => {
    if (!enabled && !options?.always) return;
    const payload = `[status] ${message}`;
    console.debug(payload);
    if (enabled) hooks.info?.(`[debug] ${message}`);
  };
};

function createStatusRecipe(
  context: StatusContext,
): RecipeStep<StatusStepName, StatusContext>[] {
  const hasGithubRepo =
    context.githubRepos.length > 0 &&
    context.params.includeGithubActivity !== false;
  const hasBugzillaQueries =
    context.components.length > 0 ||
    context.whiteboards.length > 0 ||
    context.metabugs.length > 0 ||
    context.assignees.length > 0;
  const hasJiraQueries =
    (context.jiraProjects.length > 0 || context.jiraJql.length > 0) &&
    !!context.jiraClient;
  const hasPatchContext = context.includePatchContext;
  const hasOpenAI = !!context.env.OPENAI_API_KEY;

  if (context.params.ids && context.params.ids.length > 0) {
    const recipe: RecipeStep<StatusStepName, StatusContext>[] = [
      fetchPrequalifiedStep,
      limitOpenAiStep,
    ];
    if (hasPatchContext) recipe.push(loadPatchContextStep);
    if (hasGithubRepo) recipe.push(fetchGithubActivityStep);
    recipe.push(handleEmptyStep);
    if (hasOpenAI) recipe.push(summarizeOpenAiStep);
    recipe.push(formatOutputStep);
    return recipe;
  }

  const recipe: RecipeStep<StatusStepName, StatusContext>[] = [logWindowStep];
  if (hasBugzillaQueries) {
    recipe.push(collectCandidatesStep, fetchHistoriesStep, filterByHistoryStep);
  }
  if (hasJiraQueries) {
    recipe.push(
      collectJiraIssuesStep,
      fetchJiraChangelogsStep,
      filterJiraByHistoryStep,
    );
  }
  if (hasGithubRepo) recipe.push(fetchGithubActivityStep);
  recipe.push(handleEmptyStep, limitOpenAiStep);
  if (hasPatchContext) recipe.push(loadPatchContextStep);
  if (hasOpenAI) recipe.push(summarizeOpenAiStep);
  recipe.push(formatOutputStep);
  return recipe;
}

export async function generateStatus(
  params: GenerateParams,
  env: EnvLike,
  hooks: ProgressHooks = defaultHooks,
): Promise<{ output: string; html: string; ids: number[] }> {
  const includePatchContext = params.includePatchContext !== false;
  const isDebug = !!params.debug;
  const debugLog = debugLogger(isDebug, hooks);
  const client = new BugzillaClient(env);

  // Initialize Jira client if credentials are provided
  let jiraClient: JiraClient | undefined;
  if (env.JIRA_URL && env.JIRA_API_KEY) {
    try {
      jiraClient = new JiraClient(env);
    } catch (error) {
      hooks.warn?.(
        `Failed to initialize Jira client: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const assignees = (params.assignees ?? [])
    .map((email) => email?.trim())
    .filter(Boolean);
  const idsProvided =
    Array.isArray(params.ids) && params.ids.length > 0 ? true : false;

  const days = params.days ?? 8;
  const sinceISO = isoDaysAgo(days);
  const components = params.components ?? [];
  const whiteboards = params.whiteboards ?? [];
  const metabugs = params.metabugs ?? [];
  const jiraProjects = params.jiraProjects ?? [];
  const jiraJql = params.jiraJql ?? [];
  const model = defaultModel(params.model);
  const voice = defaultVoice(params.voice);
  const audience = defaultAudience(idsProvided, params.audience);
  const format = params.format ?? "md";

  const context: StatusContext = {
    params,
    env,
    hooks,
    client,
    jiraClient,
    includePatchContext,
    isDebug,
    debugLog,
    days,
    sinceISO,
    components,
    whiteboards,
    metabugs,
    assignees,
    jiraProjects,
    jiraJql,
    voice,
    audience,
    model,
    format,
    candidates: [],
    histories: [],
    byIdHistory: new Map(),
    jiraIssues: [],
    jiraHistories: [],
    byKeyJiraHistory: new Map(),
    finalJiraIssues: [],
    finalBugs: [],
    aiCandidates: [],
    providedBugs: [],
    trimmedCount: 0,
    patchContext: new Map(),
    githubRepos: params.githubRepos ?? [],
    emailMapping: params.emailMapping ?? {},
    githubActivity: [],
    githubContributors: new Map(),
    ids: [],
  };

  const recipe = createStatusRecipe(context);
  const { snapshots } = await runRecipe(recipe, context, {
    phaseNames: STEP_PHASE_CONFIG,
    onPhase: (phaseName, meta) => hooks.phase?.(phaseName, meta),
  });

  if (!context.output || !context.html) {
    const failed = snapshots
      .filter((snap) => snap.status === "failed")
      .map((snap) => snap.name)
      .join(", ");
    throw new Error(
      failed
        ? `State machine failed in steps: ${failed}`
        : "State machine recipe did not produce output",
    );
  }

  return { output: context.output, html: context.html, ids: context.ids };
}

export async function discoverCandidates(
  params: Omit<GenerateParams, "ids">,
  env: EnvLike,
  hooks: ProgressHooks = defaultHooks,
): Promise<{ sinceISO: string; candidates: Bug[] }> {
  const client = new BugzillaClient(env);
  const days = params.days ?? 8;
  const sinceISO = isoDaysAgo(days);
  const components = params.components ?? [];
  const whiteboards = params.whiteboards ?? [];
  const metabugs = params.metabugs ?? [];
  const assignees = (params.assignees ?? [])
    .map((email) => email?.trim())
    .filter(Boolean);

  logWindowContext(
    hooks,
    sinceISO,
    days,
    components.map((pc) =>
      pc.component ? `${pc.product}:${pc.component}` : pc.product,
    ),
    whiteboards,
    metabugs,
    assignees,
  );

  const collection = await collectCandidates(client, hooks, sinceISO, {
    components,
    whiteboards,
    metabugs,
    assignees,
  });
  hooks.info?.(
    `Candidates after initial query: ${collection.candidates.length}`,
  );
  return { sinceISO, candidates: collection.candidates };
}

export async function qualifyHistoryPage(
  env: EnvLike,
  sinceISO: string,
  candidates: Bug[],
  cursor: number,
  pageSize: number,
  hooks: ProgressHooks = defaultHooks,
  debug = false,
): Promise<{
  qualifiedIds: number[];
  nextCursor: number | undefined;
  total: number;
}> {
  const client = new BugzillaClient(env);
  const normalizedCursor = Number.isFinite(cursor) ? Math.trunc(cursor) : 0;
  const normalizedPageSize = Math.max(
    1,
    Number.isFinite(pageSize) ? Math.trunc(pageSize) : 1,
  );
  const start = Math.max(0, normalizedCursor);
  const end = Math.min(candidates.length, start + normalizedPageSize);
  const slice = candidates.slice(start, end);
  hooks.phase?.(STEP_PHASE_CONFIG["fetch-histories"] || "histories", {
    total: slice.length,
  });

  const histories = await client.fetchHistories(
    slice.map((bug) => bug.id),
    hooks,
  );
  const byIdHistory = new Map(histories.map((entry) => [entry.id, entry]));

  const qualified: number[] = [];
  for (const bug of slice) {
    const history = byIdHistory.get(bug.id);
    if (!history) continue;
    if (qualifiesByHistory(history, sinceISO)) {
      qualified.push(bug.id);
    }
  }

  const nextCursor = end < candidates.length ? end : undefined;
  if (debug) {
    hooks.info?.(
      `[debug] page qualified=${qualified.length} (cursor ${start}→${end}/${candidates.length})`,
    );
  }

  return { qualifiedIds: qualified, nextCursor, total: candidates.length };
}

export { buildBuglistURL } from "./output.ts";
export { isRestricted } from "./rules.ts";
