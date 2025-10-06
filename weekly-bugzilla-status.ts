#!/usr/bin/env ts-node

/**
 * Weekly Bugzilla Status (Mozilla)
 * Node 18+ (for global fetch). TypeScript.
 *
 * Features:
 * - Inputs:
 *    --component "Product:Component" (repeatable)
 *    --metabug 12345 (repeatable)
 *    --days 8  (default 8)
 *    --model gpt-5 (default)
 *    --debug
 *
 * - Env vars:
 *    BUGZILLA_API_KEY   (required)
 *    OPENAI_API_KEY     (required)
 *
 * - Output: Markdown to stdout, ending with a bare URL line in parentheses.
 *
 * Install:
 *   npm i -D ts-node typescript
 *   npm i openai yargs
 *   # Node 18+ provides fetch; if on older Node, also: npm i undici
 *
 * Run:
 *   npm run status -- \
 *     --component "Firefox:General" \
 *     --component "Fenix:Toolbar" \
 *     --metabug 1880000 \
 *     --days 8 \
 *     --debug
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import OpenAI from "openai";

type Bug = {
  id: number;
  summary: string;
  product: string;
  component: string;
  status: string;
  resolution?: string;
  last_change_time: string;
  groups?: string[];
  depends_on?: number[];
  blocks?: number[];
};

type BugHistory = {
  bugs: Array<{
    id: number;
    history: Array<{
      when: string;
      changes: Array<{
        field_name: string;
        removed: string;
        added: string;
      }>;
    }>;
  }>;
};

type ImpactAssessment = {
  bug_id: number;
  impact_score: number; // 1-10
  include: boolean; // only include if impact is obvious
  demo_suggestion?: string;
  short_reason?: string;
};

type ModelConfig = {
  model: string;
  maxOutputWords: number;
};

const BUGZILLA_HOST = "https://bugzilla.mozilla.org";
const BUG_FIELDS = [
  "id",
  "summary",
  "product",
  "component",
  "status",
  "resolution",
  "last_change_time",
  "groups",
  "depends_on",
  "blocks",
];

const argv = yargs(hideBin(process.argv))
  .option("component", {
    describe: "Product:Component (repeatable)",
    type: "string",
    array: true,
  })
  .option("metabug", {
    describe: "Metabug ID (repeatable)",
    type: "number",
    array: true,
  })
  .option("days", {
    describe: "Lookback window in days",
    type: "number",
    default: 8,
  })
  .option("model", {
    describe: "OpenAI model ID",
    type: "string",
    default: "gpt-5",
  })
  .option("debug", {
    describe: "Enable verbose debug logging",
    type: "boolean",
    default: false,
  })
  .option("whiteboard", {
    describe: 'Status Whiteboard tag to match (repeatable), e.g. "[fx-vpn]"',
    type: "string",
    array: true,
  })
  .strict()
  .help()
  .parseSync();

const BUGZILLA_API_KEY = process.env.BUGZILLA_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!BUGZILLA_API_KEY) {
  console.error("[ERROR] BUGZILLA_API_KEY is required in env.");
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error("[ERROR] OPENAI_API_KEY is required in env.");
  process.exit(1);
}

const debug = (...args: any[]) => {
  if (argv.debug) console.error("[DEBUG]", ...args);
};
const log = (...args: any[]) => console.error("[INFO]", ...args);

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function isSecurityRestricted(groups?: string[]): boolean {
  if (!groups) return false;
  return groups.some((g) => /security/i.test(g));
}

function buildBugzillaSearchURL(
  bugIds: number[],
  pairs: Array<{ product: string; component: string }>,
  sinceISO: string,
  whiteboards: string[] = []
): string {
  const url = new URL(`${BUGZILLA_HOST}/buglist.cgi`);

  // Status & resolution
  url.searchParams.set("bug_status", "RESOLVED,VERIFIED,CLOSED");
  url.searchParams.set("resolution", "FIXED");

  // Time window (Bugzilla UI params)
  url.searchParams.set("chfieldfrom", sinceISO);
  url.searchParams.set("chfieldto", "Now");

  // IDs (optional)
  if (bugIds.length) {
    url.searchParams.set("bug_id", bugIds.join(","));
  }

  // Product/components (optional; repeatable)
  for (const pc of pairs) {
    url.searchParams.append("product", pc.product);
    url.searchParams.append("component", pc.component);
  }

  // Status Whiteboard tags (optional; repeatable)
  for (const tag of whiteboards) {
    url.searchParams.append("status_whiteboard", tag);
    // classic UI uses *_type selectors; allwordssubstr = AND across words, substring works well too.
    url.searchParams.append("status_whiteboard_type", "substring");
  }

  return url.toString();
}

async function bugzillaGet(
  path: string,
  params: Record<string, string | number | boolean | string[] | undefined> = {}
) {
  const url = new URL(`${BUGZILLA_HOST}/rest${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }
  url.searchParams.set("api_key", BUGZILLA_API_KEY!);

  debug(`Fetching ${url.toString()}`);
  const res = await fetch(url.toString());
  const text = await res.text();

  if (!res.ok) {
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    const err: any = new Error(
      `Bugzilla ${res.status}${json?.code ? ` code=${json.code}` : ""}: ${
        json?.message || text
      }`
    );
    err.status = res.status;
    err.code = json?.code;
    err.body = json || text;
    err.url = url.toString();
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    const err: any = new Error(`Failed to parse JSON from Bugzilla`);
    err.body = text.slice(0, 500);
    err.url = url.toString();
    throw err;
  }
}

async function fetchMetabugChildren(metabugIds: number[]): Promise<number[]> {
  if (!metabugIds.length) return [];
  log(`Fetching metabug details for: ${metabugIds.join(", ")}`);
  const { bugs } = (await bugzillaGet(`/bug`, {
    id: metabugIds.join(","),
    include_fields: ["id", "depends_on", "blocks"].join(","),
  })) as { bugs: Bug[] };
  const childIds = new Set<number>();
  for (const b of bugs) {
    (b.depends_on || []).forEach((id) => childIds.add(id));
    (b.blocks || []).forEach((id) => childIds.add(id));
  }
  debug("Metabug children collected:", Array.from(childIds));
  return Array.from(childIds);
}

async function fetchComponentBugs(
  pairs: Array<{ product: string; component: string }>,
  sinceISO: string
): Promise<Bug[]> {
  if (!pairs.length) return [];
  log(
    `Querying components (${pairs.length}) for RESOLVED/VERIFIED FIXED since ${sinceISO}`
  );
  const results: Bug[] = [];
  for (const pc of pairs) {
    const payload = (await bugzillaGet(`/bug`, {
      product: pc.product,
      component: pc.component,
      status: ["RESOLVED", "VERIFIED", "CLOSED"],
      status_type: "anyexact", // allow multiple status params
      resolution: "FIXED",
      last_change_time: sinceISO,
      include_fields: BUG_FIELDS.join(","),
    })) as { bugs: Bug[] };
    results.push(...payload.bugs);
  }
  return results;
}

async function fetchWhiteboardBugs(tags: string[]): Promise<Bug[]> {
  if (!tags?.length) return [];
  log(
    `Querying whiteboard tags (${tags.length}) for RESOLVED/VERIFIED/CLOSED FIXED`
  );
  const results: Bug[] = [];

  for (const tag of tags) {
    const payload = (await bugzillaGet(`/bug`, {
      // Status set: done states
      status: ["RESOLVED", "VERIFIED", "CLOSED"],
      status_type: "anyexact",
      resolution: "FIXED",

      // Status Whiteboard contains the tag
      whiteboard: tag,
      whiteboard_type: "substring",

      include_fields: BUG_FIELDS.join(","),
    })) as { bugs: Bug[] };

    results.push(...payload.bugs);
    debug(`Whiteboard "${tag}" matched ${payload.bugs.length} bugs`);
  }
  return results;
}

async function fetchSpecificBugs(
  ids: number[],
  sinceISO: string
): Promise<Bug[]> {
  if (!ids.length) return [];
  log(
    `Querying ${ids.length} child bugs for RESOLVED/VERIFIED FIXED since ${sinceISO}`
  );
  // Pull only those that have changed recently; filter later by history.
  const chunkSize = 300;
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize)
    chunks.push(ids.slice(i, i + chunkSize));
  const results: Bug[] = [];
  for (const chunk of chunks) {
    const payload = (await bugzillaGet(`/bug`, {
      id: chunk.join(","),
      include_fields: BUG_FIELDS.join(","),
    })) as { bugs: Bug[] };
    results.push(...payload.bugs);
  }
  // We only care about those currently RESOLVED/VERIFIED, FIXED and recently changed
  return results.filter(
    (b) =>
      (b.status === "RESOLVED" || b.status === "VERIFIED") &&
      b.resolution === "FIXED" &&
      new Date(b.last_change_time) >= new Date(sinceISO)
  );
}

async function fetchHistories(ids: number[]): Promise<BugHistory["bugs"]> {
  if (!ids.length) return [];
  log(`Fetching histories for ${ids.length} bugs`);

  const histories: BugHistory["bugs"] = [];
  let chunkSize = 200;

  const fetchChunk = async (chunk: number[]) => {
    try {
      const payload = (await bugzillaGet(
        `/bug/${chunk.join(",")}/history`
      )) as BugHistory;
      histories.push(...payload.bugs);
      return;
    } catch (e: any) {
      // 400 usually means one or more IDs in the chunk are invalid/restricted.
      const head = chunk.slice(0, 10).join(",");
      const tail = chunk.length > 10 ? `… (total ${chunk.length})` : "";
      console.error(
        `[WARN] Batch history fetch failed ${e.status || ""}${
          e.code ? ` code=${e.code}` : ""
        }. Retrying individually. IDs: [${head}] ${tail}`
      );

      // Retry individually; skip the offenders.
      for (const id of chunk) {
        try {
          const payload = (await bugzillaGet(
            `/bug/${id}/history`
          )) as BugHistory;
          histories.push(...payload.bugs);
        } catch (e2: any) {
          // Most common: 400 code=100 "can't find" or 102 "access denied"
          console.error(
            `[WARN] Skipping history for #${id}: ${e2.status || ""}${
              e2.code ? ` code=${e2.code}` : ""
            } ${e2.message}`
          );
        }
      }
    }
  };

  for (let i = 0; i < ids.length; i += chunkSize) {
    await fetchChunk(ids.slice(i, i + chunkSize));
  }

  return histories;
}

function transitionedToResolvedOrVerifiedFixed(
  history: BugHistory["bugs"][number],
  sinceISO: string
): boolean {
  const since = new Date(sinceISO).getTime();

  // Case A: NEW|ASSIGNED -> RESOLVED with resolution FIXED (within window)
  const caseA = history.history.some((h) => {
    const when = new Date(h.when).getTime();
    if (when < since) return false;
    let toResolved = false,
      fromNewOrAssigned = false,
      fixed = false;
    for (const c of h.changes) {
      if (
        c.field_name === "status" &&
        c.added === "RESOLVED" &&
        /^(NEW|ASSIGNED)$/.test(c.removed)
      ) {
        toResolved = true;
        fromNewOrAssigned = true;
      }
      if (c.field_name === "resolution" && c.added === "FIXED") fixed = true;
    }
    return toResolved && fromNewOrAssigned && fixed;
  });

  if (caseA) return true;

  // Case B: RESOLVED -> VERIFIED (resolution already FIXED), within window
  // We accept either an explicit status change to VERIFIED or a resolution FIXED reaffirmation in same change set.
  const caseB = history.history.some((h) => {
    const when = new Date(h.when).getTime();
    if (when < since) return false;
    let toVerified = false;
    let fromResolved = false;
    let fixed = false;
    for (const c of h.changes) {
      if (
        c.field_name === "status" &&
        c.added === "VERIFIED" &&
        c.removed === "RESOLVED"
      ) {
        toVerified = true;
        fromResolved = true;
      }
      if (c.field_name === "resolution" && c.added === "FIXED") fixed = true;
    }
    // Some Bugzilla flows don't re-add FIXED on verify; allow verification if it came from RESOLVED and the bug is FIXED overall.
    return toVerified && fromResolved;
  });

  return caseB;
}

function dedupeById<T extends { id: number }>(arr: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const x of arr)
    if (!seen.has(x.id)) {
      seen.add(x.id);
      out.push(x);
    }
  return out;
}

async function assessImpactAndSummarize(
  bugs: Bug[],
  modelCfg: ModelConfig,
  windowDays: number
): Promise<{ summaryMd: string; assessments: ImpactAssessment[] }> {
  const system = [
    "You are an expert release PM creating a spoken, 60-second update for a team meeting.",
    "Audience: cross-functional engineers and managers.",
    "Goal: Emphasize *user impact* only. If a change has no obvious user impact, omit it.",
    "Keep it concise, conversational, and human. Prefer plain language over Bugzilla jargon.",
    `Hard limit: about ${modelCfg.maxOutputWords} words total.`,
    "Output must be valid Markdown only.",
  ].join("\n");

  const bugPayload = bugs.map((b) => ({
    id: b.id,
    summary: b.summary,
    product: b.product,
    component: b.component,
  }));

  const user = `
Time window: last ${windowDays} days.
Bugs (RESOLVED/VERIFIED FIXED, verified transition from NEW/ASSIGNED → RESOLVED/VERIFIED FIXED):
${JSON.stringify(bugPayload, null, 2)}

Tasks:
1) For each bug, assign a *user impact score* 1–10 (1 = none, 10 = major, obvious user impact) and a one-line reason.
2) For bugs with score ≥ 6, propose a brief "demo suggestion" (one sentence).
3) Write a short, meeting-ready summary in clear, natural language that can be read aloud in under 60 seconds. Combine related points into a smooth narrative instead of listing them. Focus only on changes with clear user impact. Keep it concise, engaging, and free of technical or internal jargon.

Return a strict JSON object with:
{
  "assessments": [
    { "bug_id": number, "impact_score": number, "short_reason": string, "demo_suggestion": string | null }
  ],
  "summary_md": string
}
  `.trim();

  const completion = await openai.chat.completions.create({
    model: modelCfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  } as any); // 'as any' to allow response_format in older typings

  const content = completion.choices?.[0]?.message?.content ?? "{}";
  let parsed: { assessments: any[]; summary_md: string };
  try {
    parsed = JSON.parse(content);
  } catch {
    // Fallback: if the model didn't respect json, wrap minimal output
    parsed = { assessments: [], summary_md: content };
  }

  const assessments: ImpactAssessment[] = (parsed.assessments || []).map(
    (a: any) => ({
      bug_id: a.bug_id,
      impact_score: Number(a.impact_score) || 1,
      include: (Number(a.impact_score) || 1) >= 3, // soft filter; final inclusion is based on summary text
      demo_suggestion: a.demo_suggestion || undefined,
      short_reason: a.short_reason || "",
    })
  );

  return { summaryMd: parsed.summary_md || content, assessments };
}

async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  process.stderr.write(`[INFO] ${label} `);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const timer = setInterval(() => {
    process.stderr.write(
      `\r[INFO] ${label} ${frames[(i = ++i % frames.length)]}`
    );
  }, 120);

  try {
    const result = await fn();
    clearInterval(timer);
    process.stderr.write(`\r[INFO] ${label} ✅\n`);
    return result;
  } catch (err) {
    clearInterval(timer);
    process.stderr.write(`\r[INFO] ${label} ❌\n`);
    throw err;
  }
}

(async () => {
  try {
    const sinceISO = isoDaysAgo(argv.days);
    log(`Window: last ${argv.days} days (since ${sinceISO})`);

    // Parse components
    const pairs: Array<{ product: string; component: string }> = [];
    for (const c of argv.component || []) {
      const [product, component] = String(c).split(":");
      if (!product || !component) {
        console.error(
          `[WARN] Skipping invalid --component "${c}" (expected "Product:Component")`
        );
        continue;
      }
      pairs.push({ product: product.trim(), component: component.trim() });
    }

    // Parse whiteboard tags
    const wbTags = (argv.whiteboard || [])
      .map(String)
      .filter((s) => s.trim().length);
    if (wbTags.length) {
      log(`Whiteboard filters: ${wbTags.join(", ")}`);
    }

    // Expand metabugs to children (existing)
    const metabugChildren = await fetchMetabugChildren(
      (argv.metabug || []).map(Number)
    );

    // Gather from components / metabug children / whiteboard tags
    const [componentBugs, specificBugs, wbBugs] = await Promise.all([
      fetchComponentBugs(pairs, sinceISO),
      fetchSpecificBugs(metabugChildren, sinceISO),
      fetchWhiteboardBugs(wbTags),
    ]);

    let candidates = dedupeById([...componentBugs, ...specificBugs, ...wbBugs]);

    // Exclude security-restricted
    candidates = candidates.filter((b) => !isSecurityRestricted(b.groups));
    log(`Candidates after initial query: ${candidates.length}`);
    debug(
      "Candidate IDs:",
      candidates.map((b) => b.id)
    );

    candidates = candidates.filter((b) => Number.isFinite(Number(b.id)));
    if (argv.debug) {
      const nonNumeric = candidates.filter(
        (b) => !Number.isFinite(Number(b.id))
      );
      if (nonNumeric.length)
        console.error(
          "[WARN] Dropping non-numeric IDs:",
          nonNumeric.map((b) => b.id)
        );
    }

    // Verify transition via history
    const histories = await fetchHistories(candidates.map((b) => b.id));
    const transitionOk = new Set<number>();
    for (const hb of histories) {
      const ok = transitionedToResolvedOrVerifiedFixed(hb, sinceISO);
      if (ok) transitionOk.add(hb.id);
      debug(`History check bug ${hb.id}: ${ok ? "passes" : "fails"}`);
    }

    const finalBugs = candidates.filter((b) => transitionOk.has(b.id));
    log(
      `Qualified bugs (NEW/ASSIGNED → RESOLVED/VERIFIED FIXED within window): ${finalBugs.length}`
    );

    if (!finalBugs.length) {
      console.log(
        `# Project Update\n\n_No user-impacting changes in the last ${
          argv.days
        } days._\n\n(${buildBugzillaSearchURL(
          metabugChildren,
          pairs,
          sinceISO
        )})`
      );
      return;
    }

    // Ask OpenAI to score & summarize
    const modelCfg: ModelConfig = { model: argv.model, maxOutputWords: 170 }; // ~60s cap
    const { summaryMd, assessments } = await withSpinner(
      `Assessing user impact and generating summary via OpenAI (${modelCfg.model})`,
      () => assessImpactAndSummarize(finalBugs, modelCfg, argv.days)
    );

    // Debug log the impact rankings
    if (argv.debug) {
      console.error("[DEBUG] Impact ranking (1–10):");
      for (const a of assessments) {
        const bug = finalBugs.find((b) => b.id === a.bug_id);
        console.error(
          `  #${a.bug_id} [${a.impact_score}] ${bug ? bug.summary : ""} — ${
            a.short_reason || ""
          }`
        );
      }
    }

    // If any score >= 6, ensure there is a "Demo suggestions" section in the output.
    const demoItems = assessments
      .filter((a) => a.impact_score >= 6 && a.demo_suggestion)
      .map((a) => {
        const bug = finalBugs.find((b) => b.id === a.bug_id)!;
        return { id: a.bug_id, text: a.demo_suggestion as string, bug };
      });

    let output = summaryMd.trim();
    if (demoItems.length) {
      // Append (or create) a Demo suggestions section
      const header = output.match(/(^|\n)##?\s+Demo suggestions/i)
        ? ""
        : `\n\n## Demo suggestions\n`;
      const lines = demoItems.map((d) => {
        return `- [Bug ${d.id}](https://bugzilla.mozilla.org/show_bug.cgi?id=${d.id}): ${d.text}`;
      });
      output = output + header + (header ? lines.join("\n") : "");
    }

    // Append inaudible link on its own line in parentheses
    const link = buildBugzillaSearchURL(
      finalBugs.map((b) => b.id),
      pairs,
      sinceISO,
      wbTags
    );
    log("Done. Status update below:");

    // Print final markdown
    console.log();
    console.log(output);
    console.log();
    console.log(`(${link})`);
    console.log();
  } catch (err: any) {
    console.error("[ERROR]", err?.message || err);
    process.exit(1);
  }
})();
