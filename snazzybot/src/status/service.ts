import { isoDaysAgo } from "../utils/time.ts";
import { BugzillaClient } from "./bugzillaClient.ts";
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
  fetchGithubActivityStep,
  fetchHistoriesStep,
  fetchPrequalifiedStep,
  filterByHistoryStep,
  formatOutputStep,
  handleEmptyStep,
  limitOpenAiStep,
  loadPatchContextStep,
  logWindowStep,
  summarizeOpenAiStep,
} from "./steps/index.ts";
import { logWindowContext } from "./recipeHelpers.ts";
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
  if (context.params.ids && context.params.ids.length > 0) {
    return [
      fetchPrequalifiedStep,
      limitOpenAiStep,
      loadPatchContextStep,
      fetchGithubActivityStep,
      handleEmptyStep,
      summarizeOpenAiStep,
      formatOutputStep,
    ];
  }

  return [
    logWindowStep,
    collectCandidatesStep,
    fetchHistoriesStep,
    filterByHistoryStep,
    fetchGithubActivityStep,
    handleEmptyStep,
    limitOpenAiStep,
    loadPatchContextStep,
    summarizeOpenAiStep,
    formatOutputStep,
  ];
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
  const model = defaultModel(params.model);
  const voice = defaultVoice(params.voice);
  const audience = defaultAudience(idsProvided, params.audience);
  const format = params.format ?? "md";

  const context: StatusContext = {
    params,
    env,
    hooks,
    client,
    includePatchContext,
    isDebug,
    debugLog,
    days,
    sinceISO,
    components,
    whiteboards,
    metabugs,
    assignees,
    voice,
    audience,
    model,
    format,
    candidates: [],
    histories: [],
    byIdHistory: new Map(),
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
  const { snapshots } = await runRecipe(recipe, context);

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
  hooks.phase?.("histories", { total: slice.length });

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
