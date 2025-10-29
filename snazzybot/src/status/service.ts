import { escapeHtml, markdownToHtml } from "../../public/lib/markdown.js";
import { isoDaysAgo } from "../utils/time.ts";
import { BugzillaClient } from "./bugzillaClient.ts";
import {
  collectCandidates,
  type CandidateCollection,
} from "./candidateCollector.ts";
import { qualifiesByHistory, qualifiesByHistoryWhy } from "./history.ts";
import { loadPatchContextsForBugs } from "./patchStage.ts";
import { buildBuglistURL } from "./output.ts";
import { summarizeWithOpenAI } from "./summarizer.ts";
import type {
  Bug,
  BugHistoryEntry,
  EnvLike,
  GenerateParams,
  ProgressHooks,
} from "./types.ts";

const MAX_BUGS_FOR_OPENAI = 60;
const defaultHooks: ProgressHooks = {};

type AudienceOption = "technical" | "product" | "leadership";
type VoiceOption = "normal" | "pirate" | "snazzy-robot";

const DEMO_SECTION_REGEX = /(^|\n)+#{0,2}\s*Demo suggestions[\s\S]*$/i;

const defaultAudience = (idsProvided: boolean, audience?: AudienceOption) => {
  if (audience) return audience;
  return idsProvided ? "product" : "technical";
};

const defaultVoice = (voice?: VoiceOption): VoiceOption =>
  voice ?? "normal";

const defaultModel = (model?: string) => model ?? "gpt-5";

const debugLogger = (enabled: boolean, hooks: ProgressHooks) =>
  enabled
    ? (message: string) => hooks.info?.(`[debug] ${message}`)
    : undefined;

const formatSummaryOutput = (args: {
  summaryMd: string;
  demo: string[];
  trimmedCount: number;
  format: "md" | "html";
  link: string;
}) => {
  const { summaryMd, demo, trimmedCount, format, link } = args;
  let summary = (summaryMd || "").trim().replace(DEMO_SECTION_REGEX, "").trim();

  if (demo.length > 0) {
    summary += `\n\n## Demo suggestions\n` + demo.join("\n");
  }

  if (trimmedCount > 0) {
    const noun = trimmedCount === 1 ? "bug" : "bugs";
    const verb = trimmedCount === 1 ? "was" : "were";
    summary += `\n\n_Note: ${trimmedCount} additional ${noun} ${verb} omitted from the AI summary due to size limits._`;
  }

  if (format === "html") {
    return (
      markdownToHtml(summary) +
      `\n<p><a href="${escapeHtml(link)}">View bugs in Bugzilla</a></p>`
    );
  }
  return `${summary}\n\n[View bugs in Bugzilla](${link})`;
};

const logWindowContext = (
  hooks: ProgressHooks,
  sinceISO: string,
  days: number,
  components: string[],
  whiteboards: string[],
  metabugs: number[],
  assignees: string[],
) => {
  hooks.info?.(`Window: last ${days} days (since ${sinceISO})`);
  if (whiteboards.length > 0) {
    hooks.info?.(`Whiteboard filters: ${whiteboards.join(", ")}`);
  }
  if (components.length > 0) {
    hooks.info?.(`Components: ${components.join(", ")}`);
  }
  if (metabugs.length > 0) {
    hooks.info?.(`Metabugs: ${metabugs.join(", ")}`);
  }
  if (assignees.length > 0) {
    hooks.info?.(`Assignees: ${assignees.join(", ")}`);
  }
};

const summarizeCandidateReasons = (
  collection: CandidateCollection,
  debugLog?: (message: string) => void,
) => {
  if (!debugLog) return;
  debugLog(`union candidates: ${collection.union.length}`);
  debugLog(
    `security-restricted removed: ${collection.restricted.length}${
      collection.restricted.length > 0
        ? ` (sample: ${collection.restricted
            .slice(0, 6)
            .map((bug) => bug.id)
            .join(", ")})`
        : ""
    }`,
  );
  debugLog(
    `candidates after security filter: ${collection.candidates.length}`,
  );
};

const emitHistoryCoverage = (
  candidates: Bug[],
  histories: BugHistoryEntry[],
  byIdHistory: Map<number, BugHistoryEntry>,
  debugLog?: (message: string) => void,
) => {
  if (!debugLog) return;
  if (histories.length === candidates.length) {
    debugLog(
      `history coverage: ${histories.length}/${candidates.length} (complete)`,
    );
  } else {
    const missing = candidates
      .map((bug) => bug.id)
      .filter((id) => !byIdHistory.has(id))
      .slice(0, 12);
    debugLog(
      `history coverage: ${histories.length}/${candidates.length}${
        missing.length > 0 ? ` (no history for: ${missing.join(", ")})` : ""
      }`,
    );
  }
};

const logReasonBreakdown = (
  reasonCounts: Map<string, number>,
  reasonExamples: Map<string, number[]>,
  debugLog?: (message: string) => void,
) => {
  if (!debugLog) return;
  const entries = [...reasonCounts.entries()].toSorted(
    (a, b) => b[1] - a[1],
  );
  if (entries.length === 0) return;
  debugLog("non-qualified reasons (top):");
  for (const [why, count] of entries) {
    const ids = reasonExamples.get(why) || [];
    debugLog(
      `  • ${why}: ${count}${
        ids.length > 0 ? ` (eg: ${ids.join(", ")})` : ""
      }`,
    );
  }
};

export async function generateStatus(
  params: GenerateParams,
  env: EnvLike,
  hooks: ProgressHooks = defaultHooks,
): Promise<{ output: string; ids: number[] }> {
  const includePatchContext = params.includePatchContext !== false;
  const isDebug = !!params.debug;
  const debugLog = debugLogger(isDebug, hooks);
  const client = new BugzillaClient(env);
  const assignees = (params.assignees ?? [])
    .map((email) => email?.trim())
    .filter(Boolean);

  if (params.ids && params.ids.length > 0) {
    const days = params.days ?? 8;
    const sinceISO = isoDaysAgo(days);
    const components = params.components ?? [];
    const whiteboards = params.whiteboards ?? [];
    const ids = [...params.ids];
    const model = defaultModel(params.model);
    const voice = defaultVoice(params.voice);
    const audience = defaultAudience(true, params.audience);

    hooks.info?.(`Summarizing ${ids.length} pre-qualified bugs…`);

    const bugs = await client.fetchBugsByIds(ids, undefined, {
      filterResolved: false,
    });

    const link = buildBuglistURL({
      sinceISO,
      whiteboards,
      ids,
      components,
      assignees,
      host: env.BUGZILLA_HOST,
    });

    const limited = bugs.slice(0, Math.min(bugs.length, MAX_BUGS_FOR_OPENAI));
    if (bugs.length > MAX_BUGS_FOR_OPENAI) {
      hooks.warn?.(
        `Trimming ${
          bugs.length - MAX_BUGS_FOR_OPENAI
        } bug(s) before OpenAI call to stay within token limits`,
      );
    }

    const patchContext = await loadPatchContextsForBugs(
      env,
      limited,
      hooks,
      { includePatchContext, debugLog },
    );
    if (debugLog) {
      debugLog(
        `[patch] pre-qualified run collected context for ${patchContext.size}/${limited.length} bug(s)`,
      );
    }

    hooks.phase?.("openai");
    const ai = await summarizeWithOpenAI(
      env,
      model,
      limited,
      days,
      voice,
      audience,
      {
        patchContextByBug: patchContext,
        groupByAssignee: assignees.length > 0,
        singleAssignee: assignees.length === 1,
      },
    );

    const demo = (ai.assessments || [])
      .filter((assessment) => {
        const score = Number(assessment.impact_score);
        return Number.isFinite(score) && score >= 6 && assessment.demo_suggestion;
      })
      .map(
        (assessment) =>
          `- [Bug ${assessment.bug_id}](https://bugzilla.mozilla.org/show_bug.cgi?id=${assessment.bug_id}): ${assessment.demo_suggestion}`,
      );

    const output = formatSummaryOutput({
      summaryMd: ai.summary_md ?? "",
      demo,
      trimmedCount: Math.max(0, bugs.length - limited.length),
      format: params.format ?? "md",
      link,
    });

    return { output, ids };
  }

  const days = params.days ?? 8;
  const sinceISO = isoDaysAgo(days);
  const components = params.components ?? [];
  const whiteboards = params.whiteboards ?? [];
  const metabugs = params.metabugs ?? [];
  const model = defaultModel(params.model);
  const voice = defaultVoice(params.voice);
  const audience = defaultAudience(false, params.audience);

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
    debugLog,
  });
  summarizeCandidateReasons(collection, debugLog);

  const histories = await client.fetchHistories(
    collection.candidates.map((bug) => bug.id),
    hooks,
  );
  const byIdHistory = new Map(histories.map((entry) => [entry.id, entry]));

  if (isDebug) {
    let shown = 0;
    for (const bug of collection.candidates) {
      if (shown >= 3) break;
      const history = byIdHistory.get(bug.id);
      const firstChanges = history?.history?.[0]?.changes;
      const changes = Array.isArray(firstChanges) ? firstChanges : [];
      if (history?.history?.length && !Array.isArray(firstChanges)) {
        hooks.info?.(
          `[debug] sample history #${bug.id} has non-array changes payload: ${JSON.stringify(firstChanges)}`,
        );
      } else if (!history?.history?.length) {
        hooks.info?.(
          `[debug] sample history #${bug.id} has no history entries within fetched payload`,
        );
      }
      if (changes.length > 0) {
        hooks.info?.(
          `[debug] sample history #${bug.id} first changes: ${JSON.stringify(
            changes.slice(0, 2),
          )}`,
        );
        shown++;
      }
    }
  }

  const reasonCounts = new Map<string, number>();
  const reasonExamples = new Map<string, number[]>();
  const bump = (why: string, id: number) => {
    reasonCounts.set(why, (reasonCounts.get(why) ?? 0) + 1);
    const list = reasonExamples.get(why) ?? [];
    if (list.length < 6) list.push(id);
    reasonExamples.set(why, list);
  };

  const allowed = new Set<number>();
  for (const bug of collection.candidates) {
    const history = byIdHistory.get(bug.id);
    if (!history) {
      if (isDebug) bump("no history returned for id", bug.id);
      continue;
    }
    if (isDebug) {
      const result = qualifiesByHistoryWhy(history, sinceISO);
      if (result.ok) {
        allowed.add(bug.id);
      } else {
        bump(result.why || "failed history qualification", bug.id);
      }
    } else if (qualifiesByHistory(history, sinceISO)) {
      allowed.add(bug.id);
    }
  }

  logReasonBreakdown(reasonCounts, reasonExamples, debugLog);
  emitHistoryCoverage(collection.candidates, histories, byIdHistory, debugLog);

  const final = collection.candidates.filter((bug) => allowed.has(bug.id));
  hooks.info?.(`Qualified bugs: ${final.length}`);

  if (debugLog) {
    if (final.length > 0) {
      debugLog(
        `qualified IDs: ${final
          .slice(0, 20)
          .map((bug) => bug.id)
          .join(", ")}${final.length > 20 ? " …" : ""}`,
      );
    } else {
      debugLog(
        "no qualified bugs → check reasons above; also verify statuses/resolution and history window.",
      );
    }
  }

  if (final.length === 0) {
    const link = buildBuglistURL({
      sinceISO,
      whiteboards,
      ids: [],
      components,
      assignees,
      host: env.BUGZILLA_HOST,
    });
    const body =
      params.format === "html"
        ? `<p><em>No user-impacting changes in the last ${days} days.</em></p><p><a href="${link}">View bugs in Bugzilla</a></p>`
        : `_No user-impacting changes in the last ${days} days._\n\n[View bugs in Bugzilla](${link})`;
    if (debugLog) debugLog(`buglist link for manual inspection: ${link}`);
    return { output: body, ids: [] };
  }

  let aiCandidates = final;
  let trimmedCount = 0;
  if (final.length > MAX_BUGS_FOR_OPENAI) {
    trimmedCount = final.length - MAX_BUGS_FOR_OPENAI;
    hooks.warn?.(
      `Trimming ${trimmedCount} bug(s) before OpenAI call to stay within token limits`,
    );
    aiCandidates = final.slice(0, MAX_BUGS_FOR_OPENAI);
    if (debugLog) {
      debugLog(
        `OpenAI candidate IDs (trimmed to ${MAX_BUGS_FOR_OPENAI}): ${aiCandidates
          .slice(0, 30)
          .map((bug) => bug.id)
          .join(", ")}${final.length > 30 ? " …" : ""}`,
      );
    }
  } else if (debugLog) {
    debugLog(
      `OpenAI candidate IDs (${aiCandidates.length}): ${aiCandidates
        .slice(0, 30)
        .map((bug) => bug.id)
        .join(", ")}${aiCandidates.length > 30 ? " …" : ""}`,
    );
  }

  const patchContext = await loadPatchContextsForBugs(
    env,
    aiCandidates,
    hooks,
    { includePatchContext, debugLog },
  );
  if (debugLog) {
    debugLog(
      `[patch] summary run collected context for ${patchContext.size}/${aiCandidates.length} bug(s)`,
    );
  }

  hooks.phase?.("openai");
  const ai = await summarizeWithOpenAI(
    env,
    model,
    aiCandidates,
    days,
    voice,
    audience,
    {
      patchContextByBug: patchContext,
      groupByAssignee: assignees.length > 0,
      singleAssignee: assignees.length === 1,
    },
  );

  const demo = (ai.assessments || [])
    .filter((assessment) => {
      const score = Number(assessment.impact_score);
      return (
        Number.isFinite(score) && score >= 6 && assessment.demo_suggestion
      );
    })
    .map(
      (assessment) =>
        `- [Bug ${assessment.bug_id}](https://bugzilla.mozilla.org/show_bug.cgi?id=${assessment.bug_id}): ${assessment.demo_suggestion}`,
    );

  const link = buildBuglistURL({
    sinceISO,
    whiteboards,
    ids: final.map((bug) => bug.id),
    components,
    assignees,
    host: env.BUGZILLA_HOST,
  });

  const output = formatSummaryOutput({
    summaryMd: ai.summary_md ?? "",
    demo,
    trimmedCount,
    format: params.format ?? "md",
    link,
  });

  return { output, ids: final.map((bug) => bug.id) };
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
  hooks.info?.(`Candidates after initial query: ${collection.candidates.length}`);
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

export { isRestricted } from "./rules.ts";
export { buildBuglistURL } from "./output.ts";
