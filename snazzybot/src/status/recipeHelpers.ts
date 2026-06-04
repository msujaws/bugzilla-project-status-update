import { escapeHtml, markdownToHtml } from "./markdown.ts";
import { buildBuglistURL, buildGithubSearchURL } from "./output.ts";
import { summarizeWithOpenAI } from "./summarizer.ts";
import { SUB_OPERATION_PHASES } from "./phases.ts";
import type { CandidateCollection } from "./candidateCollector.ts";
import type { Bug, BugHistoryEntry, DebugLog, ProgressHooks } from "./types.ts";
import type { StatusContext } from "./context.ts";

const DEMO_SECTION_REGEX = /(^|\n)+#{0,3}\s*Demo suggestions[\s\S]*$/i;

export type FooterLink = { label: string; url: string };

const footerMarkdown = (links: FooterLink[]) =>
  links.map((l) => `[${l.label}](${l.url})`).join(" · ");

const footerHtml = (links: FooterLink[]) =>
  `<p>` +
  links
    .map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`)
    .join(" · ") +
  `</p>`;

export const formatSummaryOutput = (args: {
  summaryMd: string;
  demo: string[];
  trimmedCount: number;
  links: FooterLink[];
}) => {
  const { summaryMd, demo, trimmedCount, links } = args;
  let summary = (summaryMd || "").trim().replace(DEMO_SECTION_REGEX, "").trim();

  if (demo.length > 0) {
    summary += `\n\n### Demo suggestions\n` + demo.join("\n");
  }

  if (trimmedCount > 0) {
    const noun = trimmedCount === 1 ? "bug" : "bugs";
    const verb = trimmedCount === 1 ? "was" : "were";
    summary += `\n\n_Note: ${trimmedCount} additional ${noun} ${verb} omitted from the AI summary due to size limits._`;
  }

  const markdown = `${summary}\n\n${footerMarkdown(links)}`;
  const html = markdownToHtml(summary) + `\n${footerHtml(links)}`;

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

/**
 * Build the footer link(s) for a report based on which data sources the run
 * drew from. Bugzilla-only → "View bugs in Bugzilla"; GitHub-only → "View work
 * on GitHub"; mixed → both (in that order).
 */
export const buildFooterLinks = (
  ctx: StatusContext,
  ids: number[],
): FooterLink[] => {
  const hasBugzilla =
    ctx.components.length > 0 ||
    ctx.whiteboards.length > 0 ||
    ctx.metabugs.length > 0 ||
    ctx.assignees.length > 0 ||
    ids.length > 0;
  const hasGithub =
    ctx.githubUsernames.length > 0 || ctx.githubRepos.length > 0;

  const links: FooterLink[] = [];
  if (hasBugzilla) {
    links.push({
      label: "View bugs in Bugzilla",
      url: buildBuglistLink(ctx, ids),
    });
  }
  if (hasGithub) {
    links.push({
      label: "View work on GitHub",
      url: buildGithubSearchURL({
        githubUsernames: ctx.githubUsernames,
        githubOrgs: ctx.githubOrgs,
        sinceISO: ctx.sinceISO,
      }),
    });
  }
  // Fallback: a run with no recognized source still gets a usable link.
  if (links.length === 0) {
    links.push({
      label: "View bugs in Bugzilla",
      url: buildBuglistLink(ctx, ids),
    });
  }
  return links;
};

export const buildEmptySummary = (ctx: StatusContext) => {
  const links = buildFooterLinks(ctx, []);
  const markdownBody = `_No user-impacting changes in the last ${ctx.days} days._\n\n${footerMarkdown(links)}`;
  const htmlBody = `<p><em>No user-impacting changes in the last ${ctx.days} days.</em></p>${footerHtml(links)}`;
  return { link: links[0]?.url ?? "", markdownBody, htmlBody };
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
      hooks: ctx.hooks,
    },
  );
};
