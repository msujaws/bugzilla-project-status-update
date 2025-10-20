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

// ---------- Bugzilla helpers (REST) ----------
// --- Simple 24h memory cache for Node / local dev (per-process) ---
const ONE_DAY_S = 24 * 60 * 60;
const ONE_DAY_MS = ONE_DAY_S * 1000;
const memCache = new Map<string, { exp: number; json: any }>();

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
      v.forEach((x) => url.searchParams.append(k, String(x)));
    else url.searchParams.set(k, String(v));
  }
  url.searchParams.set("api_key", env.BUGZILLA_API_KEY);

  const key = url.toString();
  const bypass = !!env.SNAZZY_SKIP_CACHE;

  // Cloudflare Cache first (if available)
  const cfCache = (globalThis as any).caches?.default;
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
    } catch {}
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
  if (!metabugIds.length) return [] as number[];
  hooks.info?.(`Fetching metabugs: ${metabugIds.join(", ")}`);
  const { bugs } = (await bzGet(env, `/bug`, {
    id: metabugIds.join(","),
    include_fields: "id,depends_on,blocks",
  })) as { bugs: Bug[] };
  const ids = new Set<number>();
  for (const b of bugs) {
    (b.depends_on || []).forEach((id) => ids.add(id));
    (b.blocks || []).forEach((id) => ids.add(id));
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
  if (!tags.length) return [] as Bug[];
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
  if (!ids.length) return [] as Bug[];
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

async function fetchHistoriesRobust(
  env: EnvLike,
  ids: number[],
  hooks: ProgressHooks
) {
  if (!ids.length) return [] as BugHistory["bugs"];
  hooks.phase?.("histories", { total: ids.length });

  const results: BugHistory["bugs"] = [];
  const CONCURRENCY = 5; // up to 5 in-flight requests
  let handled = 0;
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= ids.length) break;
      const id = ids[idx];
      try {
        const payload = (await bzGet(env, `/bug/${id}/history`)) as BugHistory;
        if (payload?.bugs?.length) results.push(...payload.bugs);
      } catch {
        hooks.warn?.(`Skipping history for #${id}`);
      } finally {
        handled += 1;
        hooks.progress?.("histories", handled, ids.length);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

function qualifiesByHistory(hb: BugHistory["bugs"][number], sinceISO: string) {
  const since = Date.parse(sinceISO);
  for (const h of hb.history || []) {
    const when = Date.parse(h.when);
    if (when < since) continue;
    let newToResolved = false,
      fixed = false,
      resolvedToVerified = false,
      verifiedToClosed = false;
    for (const c of h.changes) {
      if (
        c.field_name === "status" &&
        c.added === "RESOLVED" &&
        /^(NEW|ASSIGNED)$/.test(c.removed)
      )
        newToResolved = true;
      if (c.field_name === "resolution" && c.added === "FIXED") fixed = true;
      if (
        c.field_name === "status" &&
        c.removed === "RESOLVED" &&
        c.added === "VERIFIED"
      )
        resolvedToVerified = true;
      if (
        c.field_name === "status" &&
        c.removed === "VERIFIED" &&
        c.added === "CLOSED"
      )
        verifiedToClosed = true;
    }
    if ((newToResolved && fixed) || resolvedToVerified || verifiedToClosed)
      return true;
  }
  return false;
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
  voice: "normal" | "pirate" | "snazzy-robot" = "normal"
) {
  const voiceHint =
    voice === "pirate"
      ? "Write in light, readable pirate-speak (sprinkle nautical words like ‘Ahoy’, ‘ship’, ‘crew’). Keep it professional, clear, and not overdone."
      : voice === "snazzy-robot"
      ? "Write as a friendly, upbeat robot narrator (light ‘beep boop’, ‘systems nominal’). Keep it human-readable and charming, not spammy."
      : "Write in a clear, friendly, professional tone.";
  // System prompt: NO demo section request here (script appends its own later).
  const system =
    "You are an expert release PM creating a short, spoken weekly update.\n" +
    "Focus ONLY on user impact. Skip items with no obvious user impact.\n" +
    "Keep the overall summary ~170 words. Output valid JSON only.\n" +
    voiceHint;

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
  const days = params.days ?? 8;
  const model = params.model ?? "gpt-5";
  const sinceISO = isoDaysAgo(days);

  const pcs = params.components ?? [];
  const wbs = params.whiteboards ?? [];
  const meta = params.metabugs ?? [];

  hooks.info?.(`Window: last ${days} days (since ${sinceISO})`);
  if (wbs.length) hooks.info?.(`Whiteboard filters: ${wbs.join(", ")}`);
  if (pcs.length)
    hooks.info?.(
      `Components: ${pcs.map((p) => `${p.product}:${p.component}`).join(", ")}`
    );
  if (meta.length) hooks.info?.(`Metabugs: ${meta.join(", ")}`);

  // Collect candidates from all sources
  const [idsFromMetabugs, byComponents, byWhiteboards] = await Promise.all([
    fetchMetabugChildren(env, meta, hooks),
    fetchByComponents(env, pcs, sinceISO),
    fetchByWhiteboards(env, wbs, sinceISO, hooks),
  ]);

  const byIds = await fetchByIds(env, idsFromMetabugs, sinceISO);

  // Union + security filter
  const seen = new Set<number>();
  let candidates = [...byComponents, ...byWhiteboards, ...byIds]
    .filter((b) => !seen.has(b.id) && seen.add(b.id))
    .filter((b) => !isSecurityRestricted(b.groups));

  hooks.info?.(`Candidates after initial query: ${candidates.length}`);

  // Histories + verify transitions
  const histories = await fetchHistoriesRobust(
    env,
    candidates.map((b) => b.id),
    hooks
  );
  const allowed = new Set<number>(
    histories.filter((h) => qualifiesByHistory(h, sinceISO)).map((h) => h.id)
  );
  const final = candidates.filter((b) => allowed.has(b.id));

  hooks.info?.(`Qualified bugs: ${final.length}`);

  if (!final.length) {
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
  }

  // OpenAI (indeterminate step; caller shows spinner)
  hooks.phase?.("openai");
  const ai = await openaiAssessAndSummarize(
    env,
    model,
    aiCandidates,
    days,
    params.voice ?? "normal"
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

  if (demo.length) {
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
