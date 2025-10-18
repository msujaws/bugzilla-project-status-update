// src/core.ts
// Shared, runtime-agnostic core for "snazzybot".
// Works in Node 18+ (global fetch) and Cloudflare Workers.

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

const defaultHooks: ProgressHooks = {};

const enc = new TextEncoder();

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function isSecurityRestricted(groups?: string[]): boolean {
  return !!groups?.some((g) => /security/i.test(g));
}

// ---------- Bugzilla helpers (REST) ----------
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
  const r = await fetch(url.toString());
  if (!r.ok) throw new Error(`Bugzilla ${r.status}: ${await r.text()}`);
  return r.json();
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
  const CHUNK = 200;
  const hist: BugHistory["bugs"] = [];
  let handled = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    try {
      const payload = (await bzGet(
        env,
        `/bug/${chunk.join(",")}/history`
      )) as BugHistory;
      hist.push(...payload.bugs);
      handled += chunk.length;
      hooks.progress?.("histories", handled, ids.length);
    } catch (e: any) {
      hooks.warn?.(
        `Batch history failed; retrying individually (${chunk.length})`
      );
      for (const id of chunk) {
        try {
          const payload = (await bzGet(
            env,
            `/bug/${id}/history`
          )) as BugHistory;
          hist.push(...payload.bugs);
        } catch {
          hooks.warn?.(`Skipping history for #${id}`);
        } finally {
          handled += 1;
          hooks.progress?.("histories", handled, ids.length);
        }
      }
    }
  }
  return hist;
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

// ---------- Markdown helpers ----------
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

function sanitizeHref(href: string): string {
  const trimmed = href.trim();
  if (
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    /^mailto:/i.test(trimmed)
  ) {
    return trimmed;
  }
  return "#";
}

function applyInlineMarkdown(text: string): string {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label, href) =>
      `<a href="${sanitizeHref(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, (_match, inner) => `<strong>${inner}</strong>`);
  escaped = escaped.replace(/\*(.+?)\*/g, (_match, inner) => `<em>${inner}</em>`);
  return escaped;
}

function markdownToHtml(md: string): string {
  const lines = (md || "").split(/\r?\n/);
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("### ")) {
      closeList();
      out.push(`<h3>${applyInlineMarkdown(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      out.push(`<h2>${applyInlineMarkdown(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      out.push(`<h1>${applyInlineMarkdown(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${applyInlineMarkdown(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${applyInlineMarkdown(line)}</p>`);
  }

  closeList();
  return out.join("\n");
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

  // OpenAI (indeterminate step; caller shows spinner)
  hooks.phase?.("openai");
  const ai = await openaiAssessAndSummarize(
    env,
    model,
    final,
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
