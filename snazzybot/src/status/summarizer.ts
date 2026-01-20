import type { CommitPatch } from "../patch.ts";
import type { Bug, EnvLike } from "./types.ts";
import type { GitHubContributor } from "./githubTypes.ts";
import type { JiraIssue } from "./jiraTypes.ts";

type VoiceOption = "normal" | "pirate" | "snazzy-robot";
type AudienceOption = "technical" | "product" | "leadership";

type SummarizeOptions = {
  patchContextByBug?: Map<number, CommitPatch[]>;
  groupByAssignee?: boolean;
  singleAssignee?: boolean;
  githubContributors?: Map<string, GitHubContributor>;
  jiraIssues?: JiraIssue[];
};

const technicalAudienceHint = `
Audience: engineers. Include specific technical details where valuable (file/feature areas, prefs/flags, APIs, perf metrics, platform scopes). Assume context; keep acronyms if common. Avoid business framing.
Refer to each bug's assignee using the provided \`assignee.name\` (fall back to the email handle if the name is missing). Start every sentence with that assignee so the update credits the correct person.
Structure: one concise sentence per bug with a blank line separating each sentence so they render as distinct paragraphs. Use the inline Markdown link style from the samples so the spoken summary can call out the bug ID.
Keep the tone crisp and technical; highlight concrete fixes, affected surfaces, and any measurable impact.

Below are samples showing the intended style. Replace the names, bug descriptions, and IDs with real data from the payload—never emit placeholders like "[Name]". All Bugzilla links should use shorthand style of 'https://bugzil.la/<ID>', where ID is replaced with the bug's specific ID.

✅ Good examples:
Rosa Kim [added a dedicated switch_to_parent_frame method to the WebDriver Classic Python client and renamed switch_frame to switch_to_frame](https://bugzil.la/1900453) for spec alignment.\n
\n
Mateo Singh updated the network.getData command to [return response bodies for data: scheme requests](https://bugzil.la/1900453).\n
\n
Priya Iqbal fixed a bug where [different requests could reuse the same id](https://bugzil.la/1900453), which broke targeted commands like network.provideResponse and network.getData.\n

❌ Avoid these patterns:
- [Fixed bug 1900453](https://bugzil.la/1900453) (too vague, no assignee, no technical detail)
- Rosa Kim made improvements to bug [1900453](https://bugzil.la/1900453) (link on bug ID instead of description)
- Update: various fixes (no specific assignee or technical content)
`;
const technicalAudienceHintGrouped = `
Audience: engineers. Include specific technical details where valuable (file/feature areas, prefs/flags, APIs, perf metrics, platform scopes). Assume context; keep acronyms if common. Avoid business framing.
Group the summary by assignee: for each assignee, emit a Markdown h2 heading like \`## Rosa Kim\` followed by bullet points describing each of their bugs. Use inline Markdown links so the spoken summary can call out the bug ID. The heading already credits the assignee—do not repeat their name inside every bullet.
Keep the tone crisp and technical; highlight concrete fixes, affected surfaces, and any measurable impact. Summaries should stay within the requested length budget overall.
`;
const technicalAudienceHintSingle = `
Audience: engineers. Include specific technical details where valuable (file/feature areas, prefs/flags, APIs, perf metrics, platform scopes). Assume context; keep acronyms if common. Avoid business framing.
All bugs belong to a single assignee; mention their name once near the start, then describe each bug's impact without repeating their name in every sentence. Keep one concise sentence per bug with inline Markdown links for IDs, and leave a blank line between sentences so they render separately.
Maintain a crisp, technical tone and highlight concrete fixes, affected surfaces, and measurable impact.
`;
const leadershipAudienceHint = `
Audience: leadership. Be high-level and concise. Focus on user/business impact, risks, timelines, and cross-team blockers. Avoid low-level tech details and code paths.

Structure: Group updates by feature or subproject area using Markdown headings (e.g., \`## WebDriver\`, \`## Network\`). For each area, write a brief paragraph (2-3 sentences) describing the collective improvements and their user/business impact. Lead with what changed and why it matters—do not lead with individual names.

Attribution: At the end of each feature/subproject section, add a separate line crediting contributors with linked bug numbers: \`Contributors: Name ([bug_id](https://bugzil.la/bug_id))\`. If a contributor fixed multiple bugs, list all their bug IDs. This keeps the focus on the product changes while still acknowledging the team members and their specific contributions.

Below is a sample showing the intended style. Replace the feature areas, descriptions, and names with real data from the payload.

✅ Good example:
## WebDriver
Improved spec compliance for frame switching and added support for response bodies on data: scheme requests. These changes bring the implementation closer to W3C standards and unblock automated testing workflows that depend on data URLs.

Contributors: Rosa Kim ([1900453](https://bugzil.la/1900453)), Mateo Singh ([1900454](https://bugzil.la/1900454), [1900455](https://bugzil.la/1900455))

## Network
Fixed an issue where different requests could incorrectly share the same internal identifier, which was causing targeted commands to fail silently. This improves reliability for teams using fine-grained network interception.

Contributors: Priya Iqbal ([1900456](https://bugzil.la/1900456))

❌ Avoid these patterns:
- Rosa Kim improved WebDriver this week... (leading with individual names)
- 5 bugs were fixed in Network (using counts instead of narrative)
- Fixed bug 1900453 (too vague, no context on impact)
- Contributors: Rosa Kim, Mateo Singh (missing bug links)
`;
const productAudienceHint = `
Audience: product managers. Emphasize user impact, product implications, rollout/experimentation notes, and notable tradeoffs. Include light technical context only when it clarifies impact.
`;

const buildAudienceHint = (
  audience: AudienceOption,
  options: { groupByAssignee: boolean; singleAssignee: boolean },
) => {
  const { groupByAssignee, singleAssignee } = options;
  if (audience === "technical") {
    if (groupByAssignee && singleAssignee) return technicalAudienceHintSingle;
    if (groupByAssignee) return technicalAudienceHintGrouped;
    return technicalAudienceHint;
  }
  let base =
    audience === "leadership" ? leadershipAudienceHint : productAudienceHint;
  if (groupByAssignee && singleAssignee) {
    base += `
All bugs belong to a single assignee; mention their name once near the start, then cover each bug without repeating it.`;
  } else if (groupByAssignee) {
    base += `
Group the summary by assignee with Markdown \`## Name\` headings and bullets so ownership is obvious without repeating the name.`;
  }
  return base;
};

export type SummarizerResult = {
  assessments: Array<{
    bug_id: number;
    impact_score: number;
    short_reason?: string;
    demo_suggestion?: string | null;
  }>;
  summary_md: string;
};

/**
 * Filter patch content to remove noise and prioritize meaningful changes.
 * Removes generated files, lockfiles, and other low-signal content.
 */
function filterPatchContent(patch: string): {
  filtered: string;
  removed: string[];
} {
  const lines = patch.split("\n");
  const removed: string[] = [];
  const filtered: string[] = [];

  // Patterns for files to skip entirely
  const skipPatterns = [
    /^diff --git .*package-lock\.json/,
    /^diff --git .*yarn\.lock/,
    /^diff --git .*pnpm-lock\.yaml/,
    /^diff --git .*Cargo\.lock/,
    /^diff --git .*Gemfile\.lock/,
    /^diff --git .*poetry\.lock/,
    /^diff --git .*\.min\.js/,
    /^diff --git .*\.bundle\.js/,
    /^diff --git .*\/dist\//,
    /^diff --git .*\/build\//,
    /^diff --git .*\/target\//,
    /^diff --git .*\.generated\./,
  ];

  let inSkippedFile = false;

  for (const line of lines) {
    // Check if this is a new file diff
    if (line.startsWith("diff --git ")) {
      inSkippedFile = skipPatterns.some((pattern) => pattern.test(line));

      if (inSkippedFile) {
        // Extract filename for reporting
        const match = line.match(/diff --git a\/(.*?) b\//);
        if (match) removed.push(match[1]);
      }
    }

    // If we're in a skipped file, don't include this line
    if (!inSkippedFile) {
      filtered.push(line);
    }
  }

  return {
    filtered: filtered.join("\n"),
    removed,
  };
}

/**
 * Smart truncation that preserves context at both ends of the patch.
 * Keeps the first and last portions while removing the middle if content is too long.
 */
function smartTruncate(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;

  // Keep 60% at the start and 40% at the end to preserve both context
  const startChars = Math.floor(maxLength * 0.6);
  const endChars = Math.floor(maxLength * 0.4) - 50; // Reserve space for truncation message

  const start = content.slice(0, startChars);
  const end = content.slice(-endChars);

  return `${start}\n\n... [truncated ${content.length - maxLength} characters] ...\n\n${end}`;
}

/**
 * Clean up Bugzilla usernames by removing common suffixes and IRC nicknames.
 * Examples:
 * - "John Doe (please needinfo? me)" -> "John Doe"
 * - "Jane Smith [:jsmith]" -> "Jane Smith"
 * - "Nobody; OK to take it and work on it" -> "Unassigned"
 */
export function cleanBugzillaUsername(
  name: string | undefined,
): string | undefined {
  if (name === undefined) return undefined;

  const trimmed = name.trim();

  // Return undefined for empty strings
  if (!trimmed) return undefined;

  // Handle the "Nobody" case for unassigned bugs
  if (trimmed.toLowerCase().startsWith("nobody")) {
    return "Unassigned";
  }

  // Remove pipe character and everything after it (Out of Office messages)
  let cleaned = trimmed.replaceAll(/\s*\|.*$/g, "");

  // Remove IRC-style nicknames in parentheses like "(:mconley)" anywhere
  cleaned = cleaned.replaceAll(/\s*\(:[^)]*\)/g, "");

  // Remove multi-word phrases in parentheses (contains spaces) anywhere
  cleaned = cleaned.replaceAll(/\s*\([^)]*\s[^)]*\)/g, "");

  // Remove trailing single-word parenthetical content
  cleaned = cleaned.replaceAll(/\s*\([^)]*\)\s*$/g, "");

  // Remove multi-word phrases in square brackets (contains spaces) anywhere - OOO messages
  cleaned = cleaned.replaceAll(/\s*\[[^\]]*\s[^\]]*\]/g, "");

  // Remove IRC-style nicknames like "[:jaws]" or "[jaws]" anywhere in the name
  cleaned = cleaned.replaceAll(/\s*\[:\w+\]/g, "");
  cleaned = cleaned.replaceAll(/\s*\[\w+\]/g, "");

  const result = cleaned.trim();
  return result || undefined;
}

export async function summarizeWithOpenAI(
  env: EnvLike,
  model: string,
  bugs: Bug[],
  days: number,
  voice: VoiceOption,
  audience: AudienceOption,
  options: SummarizeOptions = {},
): Promise<SummarizerResult> {
  const {
    patchContextByBug,
    groupByAssignee = false,
    singleAssignee = false,
    githubContributors,
    jiraIssues = [],
  } = options;

  const voiceHint =
    voice === "pirate"
      ? "Write in light, readable pirate-speak (sprinkle nautical words like ‘Ahoy’, ‘ship’, ‘crew’). Keep it professional, clear, and not overdone."
      : voice === "snazzy-robot"
        ? "Write as a friendly, upbeat robot narrator (light ‘beep boop’, ‘systems nominal’). Keep it human-readable and charming, not spammy."
        : "Write in a clear, friendly, professional tone.";

  const audienceHint = buildAudienceHint(audience, {
    groupByAssignee,
    singleAssignee,
  });

  const lengthHint =
    audience === "technical"
      ? "~220 words total."
      : audience === "leadership"
        ? "~120 words total."
        : "~170 words total.";

  const system =
    "You are an expert release PM creating a short, spoken weekly update.\n" +
    "Focus ONLY on user impact. Skip items with no obvious user impact.\n" +
    "Separate each bug update with a blank line so Markdown renders them as distinct paragraphs.\n" +
    `Keep the overall summary ${lengthHint} Output valid JSON only.\n` +
    `${voiceHint}\n` +
    `${audienceHint}`;

  const bugPayload = bugs.map((bug) => {
    const detail = bug.assigned_to_detail;
    const primaryName =
      detail?.real_name?.trim() || detail?.name?.trim() || detail?.nick?.trim();
    const fallbackName =
      bug.assigned_to && bug.assigned_to.includes("@")
        ? bug.assigned_to.split("@")[0]
        : (bug.assigned_to ?? "Someone");

    // Clean up Bugzilla username patterns
    const cleanedName = cleanBugzillaUsername(primaryName || fallbackName);

    return {
      id: bug.id,
      summary: bug.summary,
      product: bug.product,
      component: bug.component,
      assignee: {
        name: cleanedName || fallbackName,
        email: bug.assigned_to ?? "dev-null+email-unknown@example.com",
      },
    };
  });

  const summaryInstruction = groupByAssignee
    ? singleAssignee
      ? "In assessments, credit each bug's assignee by name. In the summary, mention the assignee once near the start and describe each bug without repeating their name."
      : "In assessments, credit each bug's assignee by name. In the summary, group bugs under Markdown headings for each assignee (use `## Name`) and list their bugs as bullets without repeating the assignee's name inside each bullet."
    : "In both the assessments and the summary, credit the bug's assignee by name (use assignee.name; if missing, fall back to the assignee email handle).";

  // Build Jira payload if present
  const jiraPayload = jiraIssues.map((issue) => ({
    key: issue.key,
    summary: issue.summary,
    project: issue.project,
    component: issue.component || "",
    assignee: {
      name: issue.assigneeDisplayName || "Unassigned",
      email: issue.assigneeEmail || "",
    },
  }));

  const hasBugs = bugs.length > 0;
  const hasJira = jiraIssues.length > 0;

  const impactScoreRubric = `
Impact Score Calibration (1-10):
• 1-3: Internal/tooling changes, code cleanup, refactoring with no direct user-facing impact
• 4-6: Bug fixes or minor features affecting some users in specific scenarios
• 7-8: Significant features, widely-used bug fixes, or notable performance improvements
• 9-10: Major features, critical bug fixes, or changes affecting all users
Provide a one-line technical reason citing specific changes from the patch context when available.`;

  let user = `Data window: last ${days} days.\n`;

  if (hasBugs && hasJira) {
    user += `\nBugzilla Bugs (done/fixed):
${JSON.stringify(bugPayload)}

Jira Issues (done/resolved):
${JSON.stringify(jiraPayload)}

${impactScoreRubric}

Tasks:
1) For each Bugzilla bug, assess user-facing impact using the rubric above and provide an impact score 1-10 with a one-line reason in the assessments array.
2) For Jira issues, assess user-facing impact using the rubric and provide an impact score 1-10. Add them to assessments with the issue key as the bug_id field (e.g., "PROJ-123" as bug_id).
3) For bugs/issues with score >= 9, suggest a one-sentence demo idea.
4) Write a Markdown summary with TWO sections:
   - First section titled "## Bugzilla Issues" summarizing the Bugzilla bugs
   - Second section titled "## Jira Issues" summarizing the Jira issues
   - Use inline Markdown links: [description](https://bugzil.la/ID) for Bugzilla and [description](JIRA_URL/browse/KEY) for Jira
5) ${summaryInstruction}`;
  } else if (hasBugs) {
    user += `Bugs (done/fixed):
${JSON.stringify(bugPayload)}

${impactScoreRubric}

Tasks:
1) For each bug, assess user-facing impact using the rubric above and provide an impact score 1-10 with a one-line reason.
2) For bugs with score >= 9, suggest a one-sentence demo idea.
3) Write a concise Markdown summary emphasizing user impact only.
4) ${summaryInstruction}`;
  } else if (hasJira) {
    user += `Jira Issues (done/resolved):
${JSON.stringify(jiraPayload)}

${impactScoreRubric}

Tasks:
1) For each Jira issue, assess user-facing impact using the rubric above and provide an impact score 1-10 with a one-line reason. Use the issue key as the bug_id field (e.g., "PROJ-123" as bug_id).
2) For issues with score >= 9, suggest a one-sentence demo idea.
3) Write a concise Markdown summary emphasizing user impact only.
4) Credit the assignee by name (use assignee.name; if missing or "Unassigned", skip attribution).`;
  } else {
    user += `No bugs or issues to summarize.`;
  }

  user += `

Return JSON:
{
  "assessments": [
    { "bug_id": number, "impact_score": number, "short_reason": string, "demo_suggestion": string | null }
  ],
  "summary_md": string
}`;

  if (patchContextByBug && patchContextByBug.size > 0) {
    const perBug: string[] = [];
    for (const bug of bugs) {
      const patches = patchContextByBug.get(bug.id);
      if (!patches || patches.length === 0) continue;
      const snippetLines: string[] = [];
      let totalFilesRemoved: string[] = [];

      for (const entry of patches) {
        const parts = [`Commit: ${entry.commitUrl}`];
        if (entry.error) {
          parts.push(`Note: ${entry.error}`, `Message: ${entry.message}`);
          snippetLines.push(parts.join("\n"));
        } else {
          // Filter out generated files and noise from the patch
          const { filtered, removed } = filterPatchContent(entry.patch);
          totalFilesRemoved.push(...removed);

          parts.push(`Message: ${entry.message}`);

          if (filtered.trim()) {
            parts.push(`Patch:\n${filtered}`);
          } else if (removed.length > 0) {
            parts.push(`Patch: [Only generated/lock files changed]`);
          }

          snippetLines.push(parts.join("\n"));
        }
      }
      if (snippetLines.length === 0) continue;

      const combined = snippetLines.join("\n\n");
      const limit = 8000;
      const truncated = smartTruncate(combined, limit);

      // Add note about filtered files if any were removed
      let bugContext = `Bug ${bug.id}:\n${truncated}`;
      if (totalFilesRemoved.length > 0) {
        const uniqueRemoved = [...new Set(totalFilesRemoved)];
        bugContext += `\n[Filtered out: ${uniqueRemoved.slice(0, 3).join(", ")}${uniqueRemoved.length > 3 ? `, +${uniqueRemoved.length - 3} more` : ""}]`;
      }

      perBug.push(bugContext);
    }
    if (perBug.length > 0) {
      user += `\n\nPatch Context:\n${perBug.join("\n\n")}`;
    }
  }

  if (githubContributors && githubContributors.size > 0) {
    const githubSummary: string[] = [];

    for (const [username, contributor] of githubContributors) {
      const parts: string[] = [`GitHub User: @${username}`];

      if (contributor.bugzillaEmail) {
        parts.push(`Bugzilla Email: ${contributor.bugzillaEmail}`);
      }

      if (contributor.commits.length > 0) {
        parts.push(`Commits (${contributor.commits.length}):`);
        const commitLimit = 10;
        for (const commit of contributor.commits.slice(0, commitLimit)) {
          const firstLine = commit.message.split("\n")[0];
          parts.push(`  - ${firstLine} (${commit.url})`);
        }
        if (contributor.commits.length > commitLimit) {
          parts.push(
            `  - ...and ${contributor.commits.length - commitLimit} more commits`,
          );
        }
      }

      if (contributor.pullRequests.length > 0) {
        parts.push(`Pull Requests (${contributor.pullRequests.length}):`);
        for (const pr of contributor.pullRequests) {
          parts.push(`  - #${pr.number}: ${pr.title} (${pr.state}, ${pr.url})`);
        }
      }

      githubSummary.push(parts.join("\n"));
    }

    if (githubSummary.length > 0) {
      user += `\n\nGitHub Activity:\n${githubSummary.join("\n\n")}`;
      user += `\n\nIntegrate GitHub activity into the summary. When a GitHub user has a mapped Bugzilla email, merge their GitHub contributions with their Bugzilla work in the summary. For GitHub-only contributors (no mapped Bugzilla email), include their contributions in a separate section or mention them separately.`;
    }
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  }
  const json = await response.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as SummarizerResult;
  } catch {
    return { assessments: [], summary_md: content };
  }
}
