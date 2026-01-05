// functions/api/status.ts
import {
  generateStatus,
  discoverCandidates,
  qualifyHistoryPage,
} from "../../src/core";

type Env = {
  OPENAI_API_KEY: string;
  BUGZILLA_API_KEY: string;
  GITHUB_API_KEY?: string;
};

const CONTENT_SECURITY_POLICY =
  "default-src 'self' blob:; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com; img-src 'self' https: data:; font-src 'self' data:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const withSecurityHeaders = (headers: globalThis.HeadersInit = {}) => {
  const merged = new Headers(headers);
  merged.set("content-security-policy", CONTENT_SECURITY_POLICY);
  return merged;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const createLogCapture = () => {
  const logs: Array<{ kind: "info" | "warn"; msg: string }> = [];
  const hooks = {
    info: (msg: string) => {
      logs.push({ kind: "info", msg });
      console.log("[INFO]", msg);
    },
    warn: (msg: string) => {
      logs.push({ kind: "warn", msg });
      console.warn("[WARN]", msg);
    },
    phase: () => {},
    progress: () => {},
  };
  return { hooks, logs };
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.OPENAI_API_KEY || !env.BUGZILLA_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "Server missing OPENAI_API_KEY or BUGZILLA_API_KEY",
      }),
      {
        status: 500,
        headers: withSecurityHeaders({
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        }),
      },
    );
  }

  const body = await request.json().catch(() => ({}));
  const {
    components = [],
    metabugs = [],
    whiteboards = [],
    days = 8,
    format = "md",
    model = "gpt-5",
    assignees = [],
    voice = "normal",
    skipCache = false,
    audience = "technical",
    includePatchContext = true,
    githubRepos = [],
    emailMapping = {},
    includeGithubActivity = false,
    mode = "oneshot", // "discover" | "page" | "finalize" | "oneshot" (legacy)
    cursor = 0,
    pageSize = 35,
    // only for finalize
    ids = [],
  } = body || {};

  const envConfig = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    BUGZILLA_API_KEY: env.BUGZILLA_API_KEY,
    GITHUB_API_KEY: env.GITHUB_API_KEY,
    BUGZILLA_HOST: env.BUGZILLA_HOST,
    SNAZZY_SKIP_CACHE: Boolean(skipCache),
  };

  const params = {
    components,
    metabugs,
    whiteboards,
    days,
    format,
    model,
    assignees,
    voice,
    audience,
    includePatchContext,
    githubRepos,
    emailMapping,
    includeGithubActivity,
  } as const;

  // ---- Paging protocol ----
  if (mode === "discover") {
    try {
      const { hooks, logs } = createLogCapture();
      const { sinceISO, candidates } = await discoverCandidates(
        params,
        envConfig,
        hooks,
      );
      return new Response(
        JSON.stringify({
          sinceISO,
          total: candidates.length,
          logs,
          // return a compact array to hold in the client between calls
          candidates: candidates.map((b) => ({
            id: b.id,
            last_change_time: b.last_change_time,
            product: b.product,
            component: b.component,
          })),
        }),
        {
          status: 200,
          headers: withSecurityHeaders({
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          }),
        },
      );
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: toErrorMessage(error) }), {
        status: 500,
        headers: withSecurityHeaders({
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        }),
      });
    }
  }
  if (mode === "page") {
    try {
      const { sinceISO, candidates } = await discoverCandidates(
        params,
        envConfig,
      );
      const { hooks, logs } = createLogCapture();
      const { qualifiedIds, nextCursor, total, results } =
        await qualifyHistoryPage(
          envConfig,
          sinceISO,
          candidates,
          Number(cursor) || 0,
          Number(pageSize) || 35,
          hooks,
        );
      return new Response(
        JSON.stringify({ qualifiedIds, nextCursor, total, results, logs }),
        {
          status: 200,
          headers: withSecurityHeaders({
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          }),
        },
      );
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: toErrorMessage(error) }), {
        status: 500,
        headers: withSecurityHeaders({
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        }),
      });
    }
  }
  if (mode === "finalize") {
    try {
      const { hooks, logs } = createLogCapture();
      const { output, html, stats } = await generateStatus(
        { ...params, ids },
        envConfig,
        hooks,
      );
      return new Response(JSON.stringify({ output, html, stats, logs }), {
        status: 200,
        headers: withSecurityHeaders({
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        }),
      });
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: toErrorMessage(error) }), {
        status: 500,
        headers: withSecurityHeaders({
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        }),
      });
    }
  }

  // ---- Legacy one-shot ----
  try {
    const { hooks, logs } = createLogCapture();
    const { output, html, stats } = await generateStatus(
      params,
      envConfig,
      hooks,
    );
    return new Response(JSON.stringify({ output, html, stats, logs }), {
      status: 200,
      headers: withSecurityHeaders({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      }),
    });
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: toErrorMessage(error) }), {
      status: 500,
      headers: withSecurityHeaders({
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      }),
    });
  }
};
