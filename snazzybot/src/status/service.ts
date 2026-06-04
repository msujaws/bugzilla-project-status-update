import { isoDaysAgo } from "../utils/time.ts";
import { BugzillaClient } from "./bugzillaClient.ts";
import { JiraClient } from "./jiraClient.ts";
import { runRecipe, type RecipeStep } from "./stateMachine.ts";
import { collectCandidates } from "./candidateCollector.ts";
import { qualifiesByHistoryWhy } from "./history.ts";
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
import {
  logWindowContext,
  formatSummaryOutput,
  extractDemoSuggestions,
} from "./recipeHelpers.ts";
import { loadPatchContextsForBugs } from "./patchStage.ts";
import { collectGithubContributors } from "./githubStage.ts";
import { summarizeWithOpenAI, type SummarizerResult } from "./summarizer.ts";
import { buildBuglistURL } from "./output.ts";
import { escapeHtml } from "./markdown.ts";
import { STEP_PHASE_CONFIG } from "./phases.ts";
import type { GitHubContributor } from "./githubTypes.ts";
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

const defaultModel = (model?: string) => model ?? "gpt-5-mini";

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
  // GitHub activity runs from either explicit repos or usernames-to-search.
  const hasGithubActivity =
    (context.githubRepos.length > 0 || context.githubUsernames.length > 0) &&
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
    if (hasGithubActivity) recipe.push(fetchGithubActivityStep);
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
  if (hasGithubActivity) recipe.push(fetchGithubActivityStep);
  recipe.push(handleEmptyStep, limitOpenAiStep);
  if (hasPatchContext) recipe.push(loadPatchContextStep);
  if (hasOpenAI) recipe.push(summarizeOpenAiStep);
  recipe.push(formatOutputStep);
  return recipe;
}

type StatusStats = {
  bugzilla?: { candidates: number; qualified: number };
  jira?: { candidates: number; qualified: number };
  github?: {
    candidates: { commits: number; prs: number };
    qualified: { commits: number; prs: number };
  };
};

const buildStatusStats = (ctx: StatusContext): StatusStats => {
  const hasBugzilla =
    (ctx.params.ids && ctx.params.ids.length > 0) ||
    ctx.components.length > 0 ||
    ctx.whiteboards.length > 0 ||
    ctx.metabugs.length > 0 ||
    ctx.assignees.length > 0;
  const hasJira = ctx.jiraProjects.length > 0 || ctx.jiraJql.length > 0;
  const hasGithub =
    (ctx.githubRepos.length > 0 || ctx.githubUsernames.length > 0) &&
    ctx.params.includeGithubActivity !== false;

  const stats: StatusStats = {};

  if (hasBugzilla) {
    const candidates =
      ctx.candidates.length > 0
        ? ctx.candidates.length
        : ctx.providedBugs.length > 0
          ? ctx.providedBugs.length
          : Math.max(ctx.finalBugs.length, 0);
    stats.bugzilla = {
      candidates,
      qualified: ctx.finalBugs.length,
    };
  }

  if (hasJira) {
    stats.jira = {
      candidates: ctx.jiraIssues.length,
      qualified: ctx.finalJiraIssues.length,
    };
  }

  if (hasGithub && ctx.githubStats) {
    stats.github = ctx.githubStats;
  }

  return stats;
};

export async function generateStatus(
  params: GenerateParams,
  env: EnvLike,
  hooks: ProgressHooks = defaultHooks,
): Promise<{
  output: string;
  html: string;
  ids: number[];
  stats: StatusStats;
}> {
  const includePatchContext = params.includePatchContext !== false;
  const isDebug = !!params.debug;
  const debugLog = debugLogger(isDebug, hooks);
  const client = new BugzillaClient(env, hooks);

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
    githubUsernames: params.githubUsernames ?? [],
    githubOrgs: params.githubOrgs ?? [],
    githubActivity: [],
    githubContributors: new Map(),
    ids: [],
  };

  const recipe = createStatusRecipe(context);
  const { snapshots } = await runRecipe(recipe, context, {
    phaseNames: STEP_PHASE_CONFIG,
    onPhase: (phaseName, meta) => hooks.phase?.(phaseName, meta),
    onError: (snapshot, error) => {
      const message = error instanceof Error ? error.message : String(error);
      hooks.warn?.(`[step "${snapshot.name}" failed] ${message}`);
    },
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

  return {
    output: context.output,
    html: context.html,
    ids: context.ids,
    stats: buildStatusStats(context),
  };
}

export async function discoverCandidates(
  params: Omit<GenerateParams, "ids">,
  env: EnvLike,
  hooks: ProgressHooks = defaultHooks,
): Promise<{ sinceISO: string; candidates: Bug[] }> {
  const client = new BugzillaClient(env, hooks);
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
  hooks.info?.(`Bugzilla Candidates: ${collection.candidates.length}`);
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
  results: Array<{
    id: number;
    qualified: boolean;
    reason?: string;
    detail?: string;
  }>;
}> {
  const client = new BugzillaClient(env, hooks);
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
  const results: Array<{
    id: number;
    qualified: boolean;
    reason?: string;
    detail?: string;
  }> = [];

  for (const bug of slice) {
    const history = byIdHistory.get(bug.id);
    if (!history) {
      results.push({
        id: bug.id,
        qualified: false,
        reason: "no history returned for id",
      });
      continue;
    }
    const result = qualifiesByHistoryWhy(history, sinceISO);
    if (result.ok) {
      qualified.push(bug.id);
      results.push({
        id: bug.id,
        qualified: true,
        detail: result.detail,
      });
    } else {
      results.push({
        id: bug.id,
        qualified: false,
        reason: result.why || "failed history qualification",
      });
    }
  }

  const nextCursor = end < candidates.length ? end : undefined;
  if (debug) {
    hooks.info?.(
      `[debug] page qualified=${qualified.length} (cursor ${start}→${end}/${candidates.length})`,
    );
  }

  return {
    qualifiedIds: qualified,
    nextCursor,
    total: candidates.length,
    results,
  };
}

/**
 * Summarize one bounded slice of pre-qualified bug ids.
 *
 * This is the summarization analogue of {@link qualifyHistoryPage}: instead of
 * running the entire OpenAI pipeline for every qualified bug in a single
 * request (which blows Cloudflare's ~100s edge budget and the Free-tier
 * subrequest cap once a user has many bugs), the client loops over the full
 * `ids` array in small pages. Each call fetches bug details + patch context for
 * its slice and runs OpenAI on just that slice, returning a partial summary
 * fragment. The caller accumulates the fragments and finishes with
 * {@link assembleSummary}.
 *
 * GitHub/Jira context describes the report as a whole, so it is only gathered
 * and attached on the first chunk (`cursor === 0`) to avoid duplicate sections
 * and repeated GitHub subrequests.
 */
export async function summarizeBugPage(
  params: GenerateParams,
  env: EnvLike,
  ids: number[],
  cursor: number,
  pageSize: number,
  hooks: ProgressHooks = defaultHooks,
  debug = false,
): Promise<{
  summaryFragment: string;
  assessments: SummarizerResult["assessments"];
  nextCursor: number | undefined;
  total: number;
  githubStats?: StatusStats["github"];
}> {
  const normalizedCursor = Number.isFinite(cursor) ? Math.trunc(cursor) : 0;
  const normalizedPageSize = Math.max(
    1,
    Number.isFinite(pageSize) ? Math.trunc(pageSize) : 1,
  );
  const start = Math.max(0, normalizedCursor);
  const end = Math.min(ids.length, start + normalizedPageSize);
  const idsSlice = ids.slice(start, end);
  const nextCursor = end < ids.length ? end : undefined;

  if (idsSlice.length === 0) {
    return {
      summaryFragment: "",
      assessments: [],
      nextCursor: undefined,
      total: ids.length,
    };
  }

  const client = new BugzillaClient(env, hooks);
  const debugLog = debugLogger(debug, hooks);
  const days = params.days ?? 8;
  const sinceISO = isoDaysAgo(days);
  const model = defaultModel(params.model);
  const voice = defaultVoice(params.voice);
  const audience = defaultAudience(ids.length > 0, params.audience);
  const assignees = (params.assignees ?? [])
    .map((email) => email?.trim())
    .filter(Boolean) as string[];
  const includePatchContext = params.includePatchContext !== false;

  hooks.info?.(
    `Summarizing pre-qualified bugs ${start + 1}-${end} of ${ids.length}…`,
  );
  const bugs = await client.fetchBugsByIds(idsSlice);

  const patchContext = await loadPatchContextsForBugs(env, bugs, hooks, {
    includePatchContext,
    debugLog,
  });

  const isFirstChunk = start === 0;
  let githubContributors: Map<string, GitHubContributor> | undefined;
  let githubStats: StatusStats["github"] | undefined;
  if (isFirstChunk) {
    const gh = await collectGithubContributors(
      env,
      {
        githubRepos: params.githubRepos ?? [],
        emailMapping: params.emailMapping ?? {},
        githubUsernames: params.githubUsernames ?? [],
        githubOrgs: params.githubOrgs ?? [],
        sinceISO,
        includeGithubActivity: params.includeGithubActivity === true,
      },
      hooks,
      debugLog,
    );
    githubContributors = gh.contributors.size > 0 ? gh.contributors : undefined;
    githubStats = gh.stats;
  }

  const result = await summarizeWithOpenAI(
    env,
    model,
    bugs,
    days,
    voice,
    audience,
    {
      patchContextByBug: patchContext,
      groupByAssignee: assignees.length > 0,
      singleAssignee: assignees.length === 1,
      githubContributors,
      jiraIssues: [],
      hooks,
    },
  );

  return {
    summaryFragment: result.summary_md ?? "",
    assessments: result.assessments ?? [],
    nextCursor,
    total: ids.length,
    githubStats,
  };
}

/**
 * Assemble the final report from summary fragments accumulated across
 * {@link summarizeBugPage} calls. Pure formatting — issues no subrequests — so
 * it always returns well inside Cloudflare's edge budget. Mirrors
 * `formatOutputStep`.
 */
export function assembleSummary(
  params: GenerateParams,
  env: EnvLike,
  ids: number[],
  summaryFragments: string[],
  assessments: SummarizerResult["assessments"],
  trimmedCount: number,
  candidatesTotal?: number,
): { output: string; html: string; stats: StatusStats } {
  const summary_md = (summaryFragments ?? [])
    .filter((md): md is string => typeof md === "string" && md.length > 0)
    .join("\n\n");
  const demo = extractDemoSuggestions(assessments ?? []);
  const assignees = (params.assignees ?? [])
    .map((email) => email?.trim())
    .filter(Boolean) as string[];
  const link = buildBuglistURL({
    sinceISO: isoDaysAgo(params.days ?? 8),
    whiteboards: params.whiteboards ?? [],
    ids,
    components: params.components ?? [],
    assignees,
    host: env.BUGZILLA_HOST,
  });

  const stats: StatusStats = {
    bugzilla: {
      candidates: candidatesTotal ?? ids.length,
      qualified: ids.length,
    },
  };

  // Nothing qualified → mirror handleEmptyStep's "no changes" message rather
  // than emitting a bare buglist link.
  if (summary_md.length === 0) {
    const days = params.days ?? 8;
    const markdownBody = `_No user-impacting changes in the last ${days} days._\n\n[View bugs in Bugzilla](${link})`;
    const htmlBody = `<p><em>No user-impacting changes in the last ${days} days.</em></p><p><a href="${escapeHtml(link)}">View bugs in Bugzilla</a></p>`;
    return {
      output: params.format === "html" ? htmlBody : markdownBody,
      html: htmlBody,
      stats,
    };
  }

  // Bugzilla-paginated path only (runs with bug ids); intentionally
  // Bugzilla-only — GitHub-only runs use the streaming recipe/formatOutputStep.
  const { markdown, html } = formatSummaryOutput({
    summaryMd: summary_md,
    demo,
    trimmedCount: trimmedCount ?? 0,
    links: [{ label: "View bugs in Bugzilla", url: link }],
  });

  return {
    output: params.format === "html" ? html : markdown,
    html,
    stats,
  };
}

export { buildBuglistURL } from "./output.ts";
export { isRestricted } from "./rules.ts";
