import type { CommitPatch } from "../patch.ts";
import type { Bug, EnvLike } from "./types.ts";

type VoiceOption = "normal" | "pirate" | "snazzy-robot";
type AudienceOption = "technical" | "product" | "leadership";

const technicalAudienceHint = `
Audience: engineers. Include specific technical details where valuable (file/feature areas, prefs/flags, APIs, perf metrics, platform scopes). Assume context; keep acronyms if common. Avoid business framing.
Refer to each bug's assignee using the provided \`assignee.name\` (fall back to the email handle if the name is missing). Start every sentence with that assignee so the update credits the correct person.
Structure: one concise sentence per bug, optionally grouped as a tight paragraph. Use the inline Markdown link style from the samples so the spoken summary can call out the bug ID.
Keep the tone crisp and technical; highlight concrete fixes, affected surfaces, and any measurable impact.

Below is a sample Markdown output showing the intended style. Replace the names, bug descriptions, and IDs with real data from the payload—never emit placeholders like "[Name]". All Bugzilla links should use shorthand style of 'https://bugzil.la/<ID>', where ID is replaced with the bug's specific ID.

Sample:
Rosa Kim [added a dedicated switch_to_parent_frame method to the WebDriver Classic Python client and renamed switch_frame to switch_to_frame](https://bugzil.la/1900453) for spec alignment.\n
Mateo Singh updated the network.getData command to [return response bodies for data: scheme requests](https://bugzil.la/1900453).\n
Priya Iqbal fixed a bug where [different requests could reuse the same id](https://bugzil.la/1900453), which broke targeted commands like network.provideResponse and network.getData.\n
`;
const leadershipAudienceHint = `
Audience: leadership. Be high-level and concise. Focus on user/business impact, risks, timelines, and cross-team blockers. Avoid low-level tech details and code paths.
`;
const productAudienceHint = `
Audience: product managers. Emphasize user impact, product implications, rollout/experimentation notes, and notable tradeoffs. Include light technical context only when it clarifies impact.
`;

export type SummarizerResult = {
  assessments: Array<{
    bug_id: number;
    impact_score: number;
    short_reason?: string;
    demo_suggestion?: string | null;
  }>;
  summary_md: string;
};

export async function summarizeWithOpenAI(
  env: EnvLike,
  model: string,
  bugs: Bug[],
  days: number,
  voice: VoiceOption,
  audience: AudienceOption,
  patchContextByBug?: Map<number, CommitPatch[]>
): Promise<SummarizerResult> {
  const voiceHint =
    voice === "pirate"
      ? "Write in light, readable pirate-speak (sprinkle nautical words like ‘Ahoy’, ‘ship’, ‘crew’). Keep it professional, clear, and not overdone."
      : voice === "snazzy-robot"
        ? "Write as a friendly, upbeat robot narrator (light ‘beep boop’, ‘systems nominal’). Keep it human-readable and charming, not spammy."
        : "Write in a clear, friendly, professional tone.";

  const audienceHint =
    audience === "technical"
      ? technicalAudienceHint
      : audience === "leadership"
        ? leadershipAudienceHint
        : productAudienceHint;

  const lengthHint =
    audience === "technical"
      ? "~220 words total."
      : audience === "leadership"
        ? "~120 words total."
        : "~170 words total.";

  const system =
    "You are an expert release PM creating a short, spoken weekly update.\n" +
    "Focus ONLY on user impact. Skip items with no obvious user impact.\n" +
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
    return {
      id: bug.id,
      summary: bug.summary,
      product: bug.product,
      component: bug.component,
      assignee: {
        name: primaryName || fallbackName,
        email: bug.assigned_to ?? "dev-null+email-unknown@example.com",
      },
    };
  });

  let user = `Data window: last ${days} days.
Bugs (done/fixed):
${JSON.stringify(bugPayload)}

Tasks:
1) For each bug, provide an impact score 1-10 and a one-line reason.
2) For bugs with score >= 6, suggest a one-sentence demo idea.
3) Write a concise Markdown summary emphasizing user impact only.
4) In both the assessments and the summary, credit the bug's assignee by name (use assignee.name; if missing, fall back to the assignee email handle).

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
      for (const entry of patches) {
        const parts = [`Commit: ${entry.commitUrl}`];
        if (entry.error) {
          parts.push(`Note: ${entry.error}`, `Message: ${entry.message}`);
        } else {
          parts.push(`Message: ${entry.message}`, `Patch:\n${entry.patch}`);
        }
        snippetLines.push(parts.join("\n"));
      }
      if (snippetLines.length === 0) continue;
      const combined = snippetLines.join("\n\n");
      const limit = 8000;
      const truncated =
        combined.length > limit
          ? `${combined.slice(0, limit)}\n…[truncated]`
          : combined;
      perBug.push(`Bug ${bug.id}:\n${truncated}`);
    }
    if (perBug.length > 0) {
      user += `\n\nPatch Context:\n${perBug.join("\n\n")}`;
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
