import { escapeHtml, markdownToHtml } from "./markdown.ts";
import { buildBuglistURL } from "./output.ts";
import { summarizeWithOpenAI } from "./summarizer.ts";
import { SUB_OPERATION_PHASES } from "./phases.ts";
import type { CandidateCollection } from "./candidateCollector.ts";
import type { Bug, BugHistoryEntry, DebugLog, ProgressHooks } from "./types.ts";
import type { StatusContext } from "./context.ts";

const DEMO_SECTION_REGEX = /(^|\n)+#{0,3}\s*Demo suggestions[\s\S]*$/i;

export const formatSummaryOutput = (args: {
  summaryMd: string;
  demo: string[];
  trimmedCount: number;
  link: string;
}) => {
  const { summaryMd, demo, trimmedCount, link } = args;
  let summary = (summaryMd || "").trim().replace(DEMO_SECTION_REGEX, "").trim();

  if (demo.length > 0) {
    summary += `\n\n### Demo suggestions\n` + demo.join("\n");
  }

  if (trimmedCount > 0) {
    const noun = trimmedCount === 1 ? "bug" : "bugs";
    const verb = trimmedCount === 1 ? "was" : "were";
    summary += `\n\n_Note: ${trimmedCount} additional ${noun} ${verb} omitted from the AI summary due to size limits._`;
  }

  const markdown = `${summary}\n\n[View bugs in Bugzilla](${link})`;
  const html =
    markdownToHtml(summary) +
    `\n<p><a href="${escapeHtml(link)}">View bugs in Bugzilla</a></p>`;

  return { markdown, html };
};

export const logWindowContext = (
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

export const summarizeCandidateReasons = (
  collection: CandidateCollection,
  debugLog?: DebugLog,
) => {
  if (!debugLog) return;
  debugLog(`union candidates: ${collection.union.length}`, { always: true });
  debugLog(
    `security-restricted removed: ${collection.restricted.length}${
      collection.restricted.length > 0
        ? ` (sample: ${collection.restricted
            .slice(0, 6)
            .map((bug) => bug.id)
            .join(", ")})`
        : ""
    }`,
    { always: true },
  );
  debugLog(
    `candidates after security filter: ${collection.candidates.length}`,
    {
      always: true,
    },
  );
};

export const emitHistoryCoverage = (
  candidates: Bug[],
  histories: BugHistoryEntry[],
  byIdHistory: Map<number, BugHistoryEntry>,
  debugLog?: DebugLog,
) => {
  if (!debugLog) return;
  if (histories.length === candidates.length) {
    debugLog(
      `history coverage: ${histories.length}/${candidates.length} (complete)`,
      { always: true },
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
      { always: true },
    );
  }
};

export const logReasonBreakdown = (
  reasonCounts: Map<string, number>,
  reasonExamples: Map<string, number[]>,
  debugLog?: DebugLog,
) => {
  if (!debugLog) return;
  const entries = [...reasonCounts.entries()].toSorted((a, b) => b[1] - a[1]);
  if (entries.length === 0) return;
  debugLog("non-qualified reasons (top):", { always: true });
  for (const [why, count] of entries) {
    const ids = reasonExamples.get(why) || [];
    debugLog(
      `  • ${why}: ${count}${ids.length > 0 ? ` (eg: ${ids.join(", ")})` : ""}`,
      { always: true },
    );
  }
};

export const buildBuglistLink = (ctx: StatusContext, ids: number[]) =>
  buildBuglistURL({
    sinceISO: ctx.sinceISO,
    whiteboards: ctx.whiteboards,
    ids,
    components: ctx.components,
    assignees: ctx.assignees,
    host: ctx.env.BUGZILLA_HOST,
  });

export const buildEmptySummary = (ctx: StatusContext) => {
  const link = buildBuglistLink(ctx, []);
  const markdownBody = `_No user-impacting changes in the last ${ctx.days} days._\n\n[View bugs in Bugzilla](${link})`;
  const escapedLink = escapeHtml(link);
  const htmlBody = `<p><em>No user-impacting changes in the last ${ctx.days} days.</em></p><p><a href="${escapedLink}">View bugs in Bugzilla</a></p>`;
  return { link, markdownBody, htmlBody };
};

export const extractDemoSuggestions = (
  assessments: Array<{
    bug_id: number;
    impact_score: number;
    demo_suggestion?: string | null;
  }>,
) =>
  assessments
    .filter((assessment) => {
      const score = Number(assessment.impact_score);
      return (
        Number.isFinite(score) &&
        score >= 8 &&
        Boolean(assessment.demo_suggestion)
      );
    })
    .map(
      (assessment) =>
        `- [Bug ${assessment.bug_id}](https://bugzilla.mozilla.org/show_bug.cgi?id=${assessment.bug_id}): ${assessment.demo_suggestion}`,
    );

export const summarizeWithOpenAIAndTrack = async (
  ctx: StatusContext,
  bugs: StatusContext["aiCandidates"],
) => {
  ctx.hooks.phase?.(SUB_OPERATION_PHASES.OPENAI);
  return summarizeWithOpenAI(
    ctx.env,
    ctx.model,
    bugs,
    ctx.days,
    ctx.voice,
    ctx.audience,
    {
      patchContextByBug: ctx.patchContext,
      groupByAssignee: ctx.assignees.length > 0,
      singleAssignee: ctx.assignees.length === 1,
      githubContributors: ctx.githubContributors,
      jiraIssues: ctx.finalJiraIssues,
    },
  );
};
