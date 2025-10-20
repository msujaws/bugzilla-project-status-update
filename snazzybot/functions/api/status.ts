// functions/api/status.ts
import { generateStatus } from "../../src/core";

type Env = {
  OPENAI_API_KEY: string;
  BUGZILLA_API_KEY: string;
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
      }
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
    voice = "normal",
    skipCache = false,
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
    voice,
  };

  if (!wantsStream) {
    try {
      const { output } = await generateStatus(params, envConfig);
      return new Response(JSON.stringify({ output }), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e?.message || String(e) }), {
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

  const write = (obj: any) =>
    writer.write(enc.encode(JSON.stringify(obj) + "\n"));

  (async () => {
    try {
      const hooks = {
        info: (msg: string) => write({ kind: "info", msg }),
        warn: (msg: string) => write({ kind: "warn", msg }),
        phase: (name: string, meta?: Record<string, unknown>) =>
          write({ kind: "phase", name, ...(meta || {}) }),
        progress: (name: string, current: number, total?: number) =>
          write({ kind: "progress", phase: name, current, total }),
      };

      write({ kind: "start", msg: "Starting snazzybot…" });

      const { output } = await generateStatus(params, envConfig, hooks);
      write({ kind: "done", output });
    } catch (e: any) {
      write({ kind: "error", msg: e?.message || String(e) });
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
