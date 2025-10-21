// src/core.ts
// Shared, runtime-agnostic core for "snazzybot".
// Works in Node 18+ (global fetch) and Cloudflare Workers.

import { escapeHtml, markdownToHtml } from "../public/lib/markdown.js";

export type ProductComponent = { product: string; component: string };
export type GenerateParams = {
  components?: ProductComponent[];
  metabugs?: number[];
  whiteboards?: string[];
  days?: number; // default 8
  model?: string; // default "gpt-5"
  format?: "md" | "html"; // output format (only affects final link wrapper, not body)
  debug?: boolean;
  voice?: "normal" | "pirate" | "snazzy-robot";
  audience?: "technical" | "product" | "leadership";
  // Optional: directly summarize a known set of bug IDs
  ids?: number[];
};

export type EnvLike = {
  BUGZILLA_API_KEY: string;
  OPENAI_API_KEY: string;
  BUGZILLA_HOST?: string; // default https://bugzilla.mozilla.org
  /** When true, do not read/write the Bugzilla response cache */
  SNAZZY_SKIP_CACHE?: boolean;
};

export type ProgressHooks = {
  phase?: (name: string, meta?: Record<string, unknown>) => void;
  progress?: (name: string, current: number, total?: number) => void;
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
};

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
      changes: Array<{ field_name: string; removed: string; added: string }>;
    }>;
  }>;
};

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

const MAX_BUGS_FOR_OPENAI = 60;

const defaultHooks: ProgressHooks = {};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function isSecurityRestricted(groups?: string[]): boolean {
  return !!groups?.some((g) => /security/i.test(g));
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// ---------- Bugzilla helpers (REST) ----------
// --- Simple 24h memory cache for Node / local dev (per-process) ---
const ONE_DAY_S = 24 * 60 * 60;
const ONE_DAY_MS = ONE_DAY_S * 1000;
const memCache = new Map<string, { exp: number; json: unknown }>();
type GlobalWithCaches = typeof globalThis & { caches?: CacheStorage };
const getDefaultCache = (): Cache | undefined =>
  (globalThis as GlobalWithCaches).caches?.default;

async function bzGet(
  env: EnvLike,
  path: string,
  params: Record<string, string | number | string[] | undefined> = {}
) {
  const host = env.BUGZILLA_HOST || "https://bugzilla.mozilla.org";
  const url = new URL(`${host}/rest${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v))
      for (const x of v) url.searchParams.append(k, String(x));
    else url.searchParams.set(k, String(v));
  }
  url.searchParams.set("api_key", env.BUGZILLA_API_KEY);

  const key = url.toString();
  const bypass = !!env.SNAZZY_SKIP_CACHE;

  // Cloudflare Cache first (if available)
  const cfCache = getDefaultCache();
  if (!bypass && cfCache) {
    const cached = await cfCache.match(key);
    if (cached) {
      return cached.json();
    }
  } else {
    // Node memory cache (read) only when not bypassing
    if (!bypass) {
      const hit = memCache.get(key);
      if (hit && hit.exp > Date.now()) return hit.json;
    }
  }

  const r = await fetch(key);
  if (!r.ok) throw new Error(`Bugzilla ${r.status}: ${await r.text()}`);
  const json = await r.json();

  // Store into Cloudflare cache (immutable for 1 day), else mem cache
  if (!bypass && cfCache) {
    // Clone JSON into a Response with Cache-Control so Cloudflare honors TTL
    const resp = new Response(JSON.stringify(json), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        // s-maxage controls edge cache; also add immutable for safety
        "cache-control": `public, s-maxage=${ONE_DAY_S}, max-age=0, immutable`,
      },
    });
    // Ignore failures; caching is opportunistic
    try {
      await cfCache.put(key, resp);
    } catch (error) {
      console.warn("Failed to cache Bugzilla response", error);
    }
  } else if (!bypass) {
    memCache.set(key, { exp: Date.now() + ONE_DAY_MS, json });
  }
  return json;
}

async function fetchMetabugChildren(
  env: EnvLike,
  metabugIds: number[],
  hooks: ProgressHooks
) {
  if (metabugIds.length === 0) return [] as number[];
  hooks.info?.(`Fetching metabugs: ${metabugIds.join(", ")}`);
  const { bugs } = (await bzGet(env, `/bug`, {
    id: metabugIds.join(","),
    include_fields: "id,depends_on,blocks",
  })) as { bugs: Bug[] };
  const ids = new Set<number>();
  for (const b of bugs) {
    for (const id of (b.depends_on || [])) ids.add(id);
    for (const id of (b.blocks || [])) ids.add(id);
  }
  return [...ids];
}

async function fetchByComponents(
  env: EnvLike,
  pairs: ProductComponent[],
  sinceISO: string
) {
  const all: Bug[] = [];
  for (const pc of pairs) {
    const { bugs } = (await bzGet(env, `/bug`, {
      product: pc.product,
      component: pc.component,
      status: ["RESOLVED", "VERIFIED", "CLOSED"], // broader "done"
      resolution: "FIXED",
      last_change_time: sinceISO,
      include_fields: BUG_FIELDS.join(","),
    })) as { bugs: Bug[] };
    all.push(...bugs);
  }
  return all;
}

async function fetchByWhiteboards(
  env: EnvLike,
  tags: string[],
  sinceISO: string,
  hooks: ProgressHooks
) {
  if (tags.length === 0) return [] as Bug[];
  const all: Bug[] = [];
  let i = 0;
  hooks.phase?.("collect-whiteboards", { total: tags.length });
  for (const tag of tags) {
    hooks.progress?.("collect-whiteboards", ++i, tags.length);
    const { bugs } = (await bzGet(env, `/bug`, {
      status: ["RESOLVED", "VERIFIED", "CLOSED"],
      resolution: "FIXED",
      whiteboard: tag,
      whiteboard_type: "substring",
      last_change_time: sinceISO,
      include_fields: BUG_FIELDS.join(","),
    })) as { bugs: Bug[] };
    all.push(...bugs);
  }
  return all;
}

async function fetchByIds(env: EnvLike, ids: number[], sinceISO: string) {
  if (ids.length === 0) return [] as Bug[];
  // Pull metadata (then we'll check history/time)
  const CHUNK = 300;
  const out: Bug[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { bugs } = (await bzGet(env, `/bug`, {
      id: chunk.join(","),
      include_fields: BUG_FIELDS.join(","),
    })) as { bugs: Bug[] };
    out.push(...bugs);
  }
  // Keep only done/fixed and recently changed to be polite
  return out.filter(
    (b) =>
      ["RESOLVED", "VERIFIED", "CLOSED"].includes(b.status) &&
      b.resolution === "FIXED" &&
      new Date(b.last_change_time) >= new Date(sinceISO)
  );
}

async function bzGetHistorySingle(env: EnvLike, id: number): Promise<BugHistory> {
  const host = env.BUGZILLA_HOST || "https://bugzilla.mozilla.org";
  const bypass = !!env.SNAZZY_SKIP_CACHE;
  const cfCache = getDefaultCache();

  const url = new URL(`${host}/rest/bug/${id}/history`);
  url.searchParams.set("api_key", env.BUGZILLA_API_KEY);
  const key = url.toString();

  if (!bypass && cfCache) {
    const cached = await cfCache.match(key);
    if (cached) return cached.json();
  } else if (!bypass) {
    const hit = memCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.json;
  }

  const r = await fetch(key);
  if (!r.ok) throw new Error(`Bugzilla ${r.status}: ${await r.text()}`);
  const json = (await r.json()) as BugHistory;

  if (!bypass && cfCache) {
    try {
      await cfCache.put(
        key,
        new Response(JSON.stringify(json), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, s-maxage=86400, max-age=0, immutable",
          },
        })
      );
    } catch (error) {
      console.warn(`Failed to cache history for bug ${id}`, error);
    }
  } else if (!bypass) {
    memCache.set(key, { exp: Date.now() + ONE_DAY_MS, json });
  }
  return json;
}

async function fetchHistoriesRobust(
  env: EnvLike,
  ids: number[],
  hooks: ProgressHooks
) {
  if (ids.length === 0) return [] as BugHistory["bugs"];

  hooks.phase?.("histories", { total: ids.length });
  hooks.info?.(`History mode: per-ID /rest/bug/<id>/history (concurrency=8)`);

  const CONCURRENCY = 8; // polite on Workers & Bugzilla
  let handled = 0;
  const out: BugHistory["bugs"] = [];

  // Simple worker pool
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const idx = cursor++;
      const id = ids[idx];
      try {
        const payload = await bzGetHistorySingle(env, id);
        if (payload?.bugs?.length) out.push(payload.bugs[0]);
      } catch (error: unknown) {
        hooks.warn?.(`Skipping history for #${id} (${describeError(error)})`);
      } finally {
        handled++;
        hooks.progress?.("histories", handled, ids.length);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

function qualifiesByHistory(hb: BugHistory["bugs"][number], sinceISO: string) {
  const since = Date.parse(sinceISO);
  for (const h of hb.history || []) {
    const when = Date.parse(h.when);
    if (when < since) continue;
    // Accept common Bugzilla field names:
    // - status can be "status" or "bug_status"
    // - resolution is "resolution"
    // Any change to {RESOLVED|VERIFIED|CLOSED} or resolution->FIXED in-window qualifies.
    let statusProgress = false;
    let fixed = false;
    for (const c of h.changes) {
      const fn = c.field_name?.toLowerCase();
      if (
        (fn === "status" || fn === "bug_status") &&
        (c.added === "RESOLVED" ||
          c.added === "VERIFIED" ||
          c.added === "CLOSED")
      ) {
        statusProgress = true;
      }
      if (fn === "resolution" && c.added === "FIXED") {
        fixed = true;
      }
    }
    if (fixed || statusProgress) return true;
  }
  return false;
}

// Debug-friendly variant that explains *why not qualified*
function qualifiesByHistoryWhy(
  hb: BugHistory["bugs"][number],
  sinceISO: string
): { ok: boolean; why?: string } {
  const since = Date.parse(sinceISO);
  if (!hb?.history || hb.history.length === 0) {
    return { ok: false, why: "no history entries" };
  }
  let sawRecent = false;
  for (const h of hb.history) {
    const when = Date.parse(h.when);
    if (when < since) continue;
    sawRecent = true;
    let statusProgress = false;
    let fixed = false;
    for (const c of h.changes) {
      const fn = c.field_name?.toLowerCase();
      if (
        (fn === "status" || fn === "bug_status") &&
        (c.added === "RESOLVED" ||
          c.added === "VERIFIED" ||
          c.added === "CLOSED")
      ) {
        statusProgress = true;
      }
      if (fn === "resolution" && c.added === "FIXED") {
        fixed = true;
      }
    }
    if (fixed || statusProgress) {
      return { ok: true };
    }
  }
  if (!sawRecent) return { ok: false, why: "no recent history in window" };
  return {
    ok: false,
    why: "no qualifying transitions (bug_status/resolution)",
  };
}

// ---------- Buglist (UI) link ----------
export function buildBuglistURL(args: {
  sinceISO: string;
  whiteboards?: string[];
  ids?: number[];
  components?: ProductComponent[];
  host?: string;
}) {
  const host = args.host || "https://bugzilla.mozilla.org";
  const url = new URL(`${host}/buglist.cgi`);
  url.searchParams.set("bug_status", "RESOLVED,VERIFIED,CLOSED");
  url.searchParams.set("resolution", "FIXED");
  url.searchParams.set("chfieldfrom", args.sinceISO);
  url.searchParams.set("chfieldto", "Now");
  if (args.ids?.length) url.searchParams.set("bug_id", args.ids.join(","));
  if (args.components?.length) {
    for (const pc of args.components) {
      url.searchParams.append("product", pc.product);
      url.searchParams.append("component", pc.component);
    }
  }
  if (args.whiteboards?.length) {
    let idx = 1;
    url.searchParams.set(`f${idx}`, "OP");
    url.searchParams.set(`j${idx}`, "OR");
    idx++;
    for (const tag of args.whiteboards) {
      url.searchParams.set(`f${idx}`, "status_whiteboard");
      url.searchParams.set(`o${idx}`, "substring");
      url.searchParams.set(`v${idx}`, tag);
      idx++;
    }
    url.searchParams.set(`f${idx}`, "CP");
  }
  return url.toString();
}

// ---------- OpenAI (JSON) ----------
async function openaiAssessAndSummarize(
  env: EnvLike,
  model: string,
  bugs: Bug[],
  days: number,
  voice: "normal" | "pirate" | "snazzy-robot" = "normal",
  audience: "technical" | "product" | "leadership" = "technical"
) {
  const voiceHint =
    voice === "pirate"
      ? "Write in light, readable pirate-speak (sprinkle nautical words like ‘Ahoy’, ‘ship’, ‘crew’). Keep it professional, clear, and not overdone."
      : (voice === "snazzy-robot"
      ? "Write as a friendly, upbeat robot narrator (light ‘beep boop’, ‘systems nominal’). Keep it human-readable and charming, not spammy."
      : "Write in a clear, friendly, professional tone.");

  const audienceHint =
    audience === "technical"
      ? "Audience: engineers. Include specific technical details where valuable (file/feature areas, prefs/flags, APIs, perf metrics, platform scopes). Assume context; keep acronyms if common. Avoid business framing."
      : (audience === "leadership"
      ? "Audience: leadership. Be high-level and concise. Focus on user/business impact, risks, timelines, and cross-team blockers. Avoid low-level tech details and code paths."
      : "Audience: product managers. Emphasize user impact, product implications, rollout/experimentation notes, and notable tradeoffs. Include light technical context only when it clarifies impact.");

  const lengthHint =
    audience === "technical"
      ? "~220 words total."
      : (audience === "leadership"
      ? "~120 words total."
      : "~170 words total.");
  // System prompt: NO demo section request here (script appends its own later).
  const system =
    "You are an expert release PM creating a short, spoken weekly update.\n" +
    "Focus ONLY on user impact. Skip items with no obvious user impact.\n" +
    `Keep the overall summary ${lengthHint} Output valid JSON only.\n` +
    `${voiceHint}\n` +
    `${audienceHint}`;

  const user = `Data window: last ${days} days.
Bugs (done/fixed):
${JSON.stringify(
  bugs.map((b) => ({
    id: b.id,
    summary: b.summary,
    product: b.product,
    component: b.component,
  }))
)}

Tasks:
1) For each bug, provide an impact score 1-10 and a one-line reason.
2) For bugs with score >= 6, suggest a one-sentence demo idea.
3) Write a concise Markdown summary emphasizing user impact only.

Return JSON:
{
  "assessments": [
    { "bug_id": number, "impact_score": number, "short_reason": string, "demo_suggestion": string | null }
  ],
  "summary_md": string
}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as {
      assessments: Array<{
        bug_id: number;
        impact_score: number;
        short_reason?: string;
        demo_suggestion?: string | null;
      }>;
      summary_md: string;
    };
  } catch {
    return { assessments: [], summary_md: content };
  }
}

// ---------- Public API ----------
export async function generateStatus(
  params: GenerateParams,
  env: EnvLike,
  hooks: ProgressHooks = defaultHooks
): Promise<{ output: string; ids: number[] }> {
  // If caller passes explicit IDs, skip discovery & history and just summarize.
  if (params.ids && params.ids.length > 0) {
    const days = params.days ?? 8;
    const model = params.model ?? "gpt-5";
    const sinceISO = isoDaysAgo(days);
    const pcs = params.components ?? [];
    const wbs = params.whiteboards ?? [];

    const ids = [...params.ids];
    hooks.info?.(`Summarizing ${ids.length} pre-qualified bugs…`);

    // Build link and run OpenAI on *metadata* (fetch fields again to render titles/products)
    const { bugs } = (await bzGet(env, `/bug`, {
      id: ids.join(","),
      include_fields: BUG_FIELDS.join(","),
    })) as { bugs: Bug[] };

    const link = buildBuglistURL({
      sinceISO,
      whiteboards: wbs,
      ids,
      components: pcs,
      host: env.BUGZILLA_HOST,
    });

    const limited = bugs.slice(0, Math.min(bugs.length, MAX_BUGS_FOR_OPENAI));
    if (bugs.length > MAX_BUGS_FOR_OPENAI) {
      hooks.warn?.(
        `Trimming ${
          bugs.length - MAX_BUGS_FOR_OPENAI
        } bug(s) before OpenAI call to stay within token limits`
      );
    }

    hooks.phase?.("openai");
    const ai = await openaiAssessAndSummarize(
      env,
      model,
      limited,
      days,
      params.voice ?? "normal",
      params.audience ?? "product"
    );

    const demo = (ai.assessments || [])
      .filter((a) => Number(a.impact_score) >= 6 && a.demo_suggestion)
      .map(
        (a) =>
          `- [Bug ${a.bug_id}](https://bugzilla.mozilla.org/show_bug.cgi?id=${a.bug_id}): ${a.demo_suggestion}`
      );

    let summary = (ai.summary_md || "").trim();
    summary = summary
      .replace(/(^|\n)+#{0,2}\s*Demo suggestions[\s\S]*$/i, "")
      .trim();
    if (demo.length > 0) summary += `\n\n## Demo suggestions\n` + demo.join("\n");

    const output =
      params.format === "html"
        ? markdownToHtml(summary) +
          `\n<p><a href="${escapeHtml(link)}">View bugs in Bugzilla</a></p>`
        : `${summary}\n\n[View bugs in Bugzilla](${link})`;

    return { output, ids };
  }

  const days = params.days ?? 8;
  const model = params.model ?? "gpt-5";
  const sinceISO = isoDaysAgo(days);
  const isDebug = !!params.debug;
  const dlog = (m: string) => {
    if (isDebug) hooks.info?.(`[debug] ${m}`);
  };

  const pcs = params.components ?? [];
  const wbs = params.whiteboards ?? [];
  const meta = params.metabugs ?? [];

  hooks.info?.(`Window: last ${days} days (since ${sinceISO})`);
  if (wbs.length > 0) hooks.info?.(`Whiteboard filters: ${wbs.join(", ")}`);
  if (pcs.length > 0)
    hooks.info?.(
      `Components: ${pcs.map((p) => `${p.product}:${p.component}`).join(", ")}`
    );
  if (meta.length > 0) hooks.info?.(`Metabugs: ${meta.join(", ")}`);

  // Collect candidates from all sources
  const [idsFromMetabugs, byComponents, byWhiteboards] = await Promise.all([
    fetchMetabugChildren(env, meta, hooks),
    fetchByComponents(env, pcs, sinceISO),
    fetchByWhiteboards(env, wbs, sinceISO, hooks),
  ]);

  if (isDebug) {
    dlog(
      `source counts → metabug children: ${idsFromMetabugs.length}, byComponents: ${byComponents.length}, byWhiteboards: ${byWhiteboards.length}`
    );
    const sample = (arr: Bug[], n = 8) =>
      arr
        .slice(0, n)
        .map((bug) => bug.id)
        .join(", ");
    if (byComponents.length > 0)
      dlog(`byComponents sample IDs: ${sample(byComponents)}`);
    if (byWhiteboards.length > 0)
      dlog(`byWhiteboards sample IDs: ${sample(byWhiteboards)}`);
  }

  const byIds = await fetchByIds(env, idsFromMetabugs, sinceISO);
  if (isDebug)
    dlog(`byIds (filtered) count: ${byIds.length} (from metabug children)`);

  // Union + security filter
  const seen = new Set<number>();
  const union = [...byComponents, ...byWhiteboards, ...byIds].filter(
    (b) => !seen.has(b.id) && seen.add(b.id)
  );
  const securityFiltered = union.filter((b) => isSecurityRestricted(b.groups));
  let candidates = union.filter((b) => !isSecurityRestricted(b.groups));

  if (isDebug) {
    dlog(`union candidates: ${union.length}`);
    dlog(
      `security-restricted removed: ${securityFiltered.length}${
        securityFiltered.length > 0
          ? ` (sample: ${securityFiltered
              .slice(0, 6)
              .map((b) => b.id)
              .join(", ")})`
          : ""
      }`
    );
    dlog(`candidates after security filter: ${candidates.length}`);
  }

  hooks.info?.(`Candidates after initial query: ${candidates.length}`);

  // Histories + verify transitions
  const histories = await fetchHistoriesRobust(
    env,
    candidates.map((b) => b.id),
    hooks
  );
  const byIdHistory = new Map<number, BugHistory["bugs"][number]>();
  for (const h of histories) byIdHistory.set(h.id, h);

  // Explain *why* each candidate is excluded (debug)
  const reasonCounts = new Map<string, number>();
  const reasonExamples = new Map<string, number[]>(); // store a few IDs per reason
  const bump = (why: string, id: number) => {
    reasonCounts.set(why, (reasonCounts.get(why) ?? 0) + 1);
    const arr = reasonExamples.get(why) ?? [];
    if (arr.length < 6) arr.push(id);
    reasonExamples.set(why, arr);
  };

  const allowed = new Set<number>();
  // Optional debug peek: show a couple of raw changes so we can see field names
  if (isDebug) {
    let shown = 0;
    for (const b of candidates) {
      if (shown >= 3) break;
      const h = byIdHistory.get(b.id);
      const changes = h?.history?.[0]?.changes || [];
      if (changes.length > 0) {
        hooks.info?.(
          `[debug] sample history #${b.id} first changes: ${JSON.stringify(
            changes.slice(0, 2)
          )}`
        );
        shown++;
      }
    }
  }
  for (const b of candidates) {
    const h = byIdHistory.get(b.id);
    if (!h) {
      if (isDebug) bump("no history returned for id", b.id);
      continue;
    }
    const q = isDebug
      ? qualifiesByHistoryWhy(h, sinceISO)
      : { ok: qualifiesByHistory(h, sinceISO) };
    if (q.ok) {
      allowed.add(b.id);
    } else if (isDebug) {
      bump(q.why || "failed history qualification", b.id);
    }
  }

  if (isDebug) {
    // Summarize reasons
    const entries = [...reasonCounts.entries()].toSorted(
      (a, b) => b[1] - a[1]
    );
    if (entries.length > 0) {
      dlog(`non-qualified reasons (top):`);
      for (const [why, count] of entries) {
        const ids = reasonExamples.get(why) || [];
        dlog(
          `  • ${why}: ${count}${ids.length > 0 ? ` (eg: ${ids.join(", ")})` : ""}`
        );
      }
    }
    // Coverage gap
    if (histories.length === candidates.length) {
      dlog(
        `history coverage: ${histories.length}/${candidates.length} (complete)`
      );
    } else {
      const missing = candidates
        .map((b) => b.id)
        .filter((id) => !byIdHistory.has(id))
        .slice(0, 12);
      dlog(
        `history coverage: ${histories.length}/${candidates.length}${
          missing.length > 0 ? ` (no history for: ${missing.join(", ")})` : ""
        }`
      );
    }
  }
  const final = candidates.filter((b) => allowed.has(b.id));

  hooks.info?.(`Qualified bugs: ${final.length}`);

  if (isDebug) {
    if (final.length > 0) {
      dlog(
        `qualified IDs: ${final
          .slice(0, 20)
          .map((b) => b.id)
          .join(", ")}${final.length > 20 ? " …" : ""}`
      );
    } else {
      dlog(
        `no qualified bugs → check reasons above; also verify statuses/resolution and history window.`
      );
    }
  }

  if (final.length === 0) {
    const link = buildBuglistURL({
      sinceISO,
      whiteboards: wbs,
      ids: [],
      components: pcs,
      host: env.BUGZILLA_HOST,
    });
    const body =
      params.format === "html"
        ? `<p><em>No user-impacting changes in the last ${days} days.</em></p><p><a href="${link}">View bugs in Bugzilla</a></p>`
        : `_No user-impacting changes in the last ${days} days._\n\n[View bugs in Bugzilla](${link})`;
    if (isDebug) dlog(`buglist link for manual inspection: ${link}`);
    return { output: body, ids: [] };
  }

  let aiCandidates = final;
  let trimmedCount = 0;
  if (final.length > MAX_BUGS_FOR_OPENAI) {
    trimmedCount = final.length - MAX_BUGS_FOR_OPENAI;
    hooks.warn?.(
      `Trimming ${trimmedCount} bug(s) before OpenAI call to stay within token limits`
    );
    aiCandidates = final.slice(0, MAX_BUGS_FOR_OPENAI);
    if (isDebug)
      dlog(
        `OpenAI candidate IDs (trimmed to ${MAX_BUGS_FOR_OPENAI}): ${aiCandidates
          .slice(0, 30)
          .map((b) => b.id)
          .join(", ")}${final.length > 30 ? " …" : ""}`
      );
  } else if (isDebug) {
    dlog(
      `OpenAI candidate IDs (${aiCandidates.length}): ${aiCandidates
        .slice(0, 30)
        .map((b) => b.id)
        .join(", ")}${aiCandidates.length > 30 ? " …" : ""}`
    );
  }

  // OpenAI (indeterminate step; caller shows spinner)
  hooks.phase?.("openai");
  const ai = await openaiAssessAndSummarize(
    env,
    model,
    aiCandidates,
    days,
    params.voice ?? "normal",
    params.audience ?? "technical"
  );

  // Build ONE canonical Demo suggestions section (no duplication)
  const demo = (ai.assessments || [])
    .filter((a) => Number(a.impact_score) >= 6 && a.demo_suggestion)
    .map(
      (a) =>
        `- [Bug ${a.bug_id}](https://bugzilla.mozilla.org/show_bug.cgi?id=${a.bug_id}): ${a.demo_suggestion}`
    );

  let summary = (ai.summary_md || "").trim();
  // Strip any model-added demo section, keep our canonical one
  summary = summary
    .replace(/(^|\n)+#{0,2}\s*Demo suggestions[\s\S]*$/i, "")
    .trim();

  if (demo.length > 0) {
    summary += `\n\n## Demo suggestions\n` + demo.join("\n");
  }

  if (trimmedCount > 0) {
    const noun = trimmedCount === 1 ? "bug" : "bugs";
    const verb = trimmedCount === 1 ? "was" : "were";
    summary += `\n\n_Note: ${trimmedCount} additional ${noun} ${verb} omitted from the AI summary due to size limits._`;
  }

  const link = buildBuglistURL({
    sinceISO,
    whiteboards: wbs,
    ids: final.map((b) => b.id),
    components: pcs,
    host: env.BUGZILLA_HOST,
  });

  const output =
    params.format === "html"
      ? markdownToHtml(summary) +
        `\n<p><a href="${escapeHtml(link)}">View bugs in Bugzilla</a></p>`
      : `${summary}\n\n[View bugs in Bugzilla](${link})`;

  return { output, ids: final.map((b) => b.id) };
}

export async function discoverCandidates(
  params: Omit<GenerateParams, "ids">,
  env: EnvLike,
  hooks: ProgressHooks = defaultHooks
): Promise<{ sinceISO: string; candidates: Bug[] }> {
  const days = params.days ?? 8;
  const sinceISO = isoDaysAgo(days);
  const pcs = params.components ?? [];
  const wbs = params.whiteboards ?? [];
  const meta = params.metabugs ?? [];

  hooks.info?.(`Window: last ${days} days (since ${sinceISO})`);
  if (wbs.length > 0) hooks.info?.(`Whiteboard filters: ${wbs.join(", ")}`);
  if (pcs.length > 0)
    hooks.info?.(
      `Components: ${pcs.map((p) => `${p.product}:${p.component}`).join(", ")}`
    );
  if (meta.length > 0) hooks.info?.(`Metabugs: ${meta.join(", ")}`);

  const [idsFromMetabugs, byComponents, byWhiteboards] = await Promise.all([
    fetchMetabugChildren(env, meta, hooks),
    fetchByComponents(env, pcs, sinceISO),
    fetchByWhiteboards(env, wbs, sinceISO, hooks),
  ]);

  const byIds = await fetchByIds(env, idsFromMetabugs, sinceISO);
  const seen = new Set<number>();
  const union = [...byComponents, ...byWhiteboards, ...byIds].filter(
    (b) => !seen.has(b.id) && seen.add(b.id)
  );
  const candidates = union.filter((b) => !isSecurityRestricted(b.groups));

  hooks.info?.(`Candidates after initial query: ${candidates.length}`);
  return { sinceISO, candidates };
}

export async function qualifyHistoryPage(
  env: EnvLike,
  sinceISO: string,
  candidates: Bug[],
  cursor: number,
  pageSize: number,
  hooks: ProgressHooks = defaultHooks,
  debug = false
): Promise<{
  qualifiedIds: number[];
  nextCursor: number | undefined;
  total: number;
}> {
  const normalizedCursor = Number.isFinite(cursor) ? Math.trunc(cursor) : 0;
  const normalizedPageSize = Math.max(
    1,
    Number.isFinite(pageSize) ? Math.trunc(pageSize) : 0
  );
  const start = Math.max(0, normalizedCursor);
  const end = Math.min(candidates.length, start + normalizedPageSize);
  const slice = candidates.slice(start, end);
  hooks.phase?.("histories", { total: slice.length });

  // Fetch histories for this slice only
  const histories = await fetchHistoriesRobust(
    env,
    slice.map((b) => b.id),
    hooks
  );
  const byIdHistory = new Map<number, BugHistory["bugs"][number]>();
  for (const h of histories) byIdHistory.set(h.id, h);

  const qualified: number[] = [];
  for (const b of slice) {
    const h = byIdHistory.get(b.id);
    if (!h) continue;
    const ok = qualifiesByHistory(h, sinceISO);
    if (ok) qualified.push(b.id);
  }

  const nextCursor = end < candidates.length ? end : undefined;
  if (debug)
    hooks.info?.(
      `[debug] page qualified=${qualified.length} (cursor ${start}→${end}/${candidates.length})`
    );
  return { qualifiedIds: qualified, nextCursor, total: candidates.length };
}
