// functions/api/status.ts
import {
  generateStatus,
  discoverCandidates,
  qualifyHistoryPage,
} from "../../src/core";

type Env = {
  OPENAI_API_KEY: string;
  BUGZILLA_API_KEY: string;
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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.OPENAI_API_KEY || !env.BUGZILLA_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "Server missing OPENAI_API_KEY or BUGZILLA_API_KEY",
      }),
      {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
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
    debug = false,
    assignees = [],
    voice = "normal",
    skipCache = false,
    audience = "technical",
    includePatchContext = true,
    mode = "oneshot", // "discover" | "page" | "finalize" | "oneshot" (legacy)
    cursor = 0,
    pageSize = 35,
    // only for finalize
    ids = [],
  } = body || {};

  const url = new URL(request.url);
  const accept = request.headers.get("accept") || "";
  const streamHeader = (
    request.headers.get("x-snazzy-stream") || ""
  ).toLowerCase();
  const streamParam = (url.searchParams.get("stream") || "").toLowerCase();
  const wantsStream =
    accept.includes("application/x-ndjson") ||
    streamHeader === "1" ||
    streamHeader === "true" ||
    streamParam === "1" ||
    streamParam === "true";

  const envConfig = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    BUGZILLA_API_KEY: env.BUGZILLA_API_KEY,
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
    debug,
    assignees,
    voice,
    audience,
    includePatchContext,
  } as const;

  if (!wantsStream) {
    // ---- Paging protocol ----
    if (mode === "discover") {
      try {
        const { sinceISO, candidates } = await discoverCandidates(
          params,
          envConfig,
        );
        return new Response(
          JSON.stringify({
            sinceISO,
            total: candidates.length,
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
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        );
      } catch (error: unknown) {
        return new Response(JSON.stringify({ error: toErrorMessage(error) }), {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }
    }
    if (mode === "page") {
      try {
        const { sinceISO, candidates } = await discoverCandidates(
          params,
          envConfig,
        );
        const { qualifiedIds, nextCursor, total } = await qualifyHistoryPage(
          envConfig,
          sinceISO,
          candidates,
          Number(cursor) || 0,
          Number(pageSize) || 35,
          {
            info: (msg: string) => debug && console.log("[INFO]", msg),
            warn: (msg: string) => console.warn("[WARN]", msg),
            phase: () => {},
            progress: () => {},
          },
          !!debug,
        );
        return new Response(
          JSON.stringify({ qualifiedIds, nextCursor, total }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        );
      } catch (error: unknown) {
        return new Response(JSON.stringify({ error: toErrorMessage(error) }), {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }
    }
    if (mode === "finalize") {
      try {
        const { output, html } = await generateStatus(
          { ...params, ids },
          envConfig,
        );
        return new Response(JSON.stringify({ output, html }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      } catch (error: unknown) {
        return new Response(JSON.stringify({ error: toErrorMessage(error) }), {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }
    }

    // ---- Legacy one-shot (unchanged) ----
    try {
      const { output, html } = await generateStatus(params, envConfig);
      return new Response(JSON.stringify({ output, html }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    } catch (error: unknown) {
      return new Response(JSON.stringify({ error: toErrorMessage(error) }), {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  }

  // Streaming (NDJSON) response
  const enc = new TextEncoder();
  const ts = new TransformStream();
  const writer = ts.writable.getWriter();

  const write = (obj: Record<string, unknown>) => {
    void writer.write(enc.encode(JSON.stringify(obj) + "\n"));
  };

  (async () => {
    try {
      const hooks = {
        info: (msg: string) => write({ kind: "info", msg }),
        warn: (msg: string) => write({ kind: "warn", msg }),
        phase: (name: string, meta?: Record<string, unknown>) => {
          const payload = meta
            ? { kind: "phase", name, ...meta }
            : { kind: "phase", name };
          write(payload);
        },
        progress: (name: string, current: number, total?: number) =>
          write({ kind: "progress", phase: name, current, total }),
      };

      write({ kind: "start", msg: "Starting snazzybot…" });

      const { output, html } = await generateStatus(params, envConfig, hooks);
      write({ kind: "done", output, html });
    } catch (error: unknown) {
      write({ kind: "error", msg: toErrorMessage(error) });
    } finally {
      await writer.close();
    }
  })();

  return new Response(ts.readable, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
