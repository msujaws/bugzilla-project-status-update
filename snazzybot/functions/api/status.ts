// functions/api/status.ts
import { generateStatus } from "../../src/core";

type Env = {
  OPENAI_API_KEY: string;
  BUGZILLA_API_KEY: string;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Use TransformStream so we don't need the streams_enable_constructors flag
  const enc = new TextEncoder();
  const ts = new TransformStream();
  const writer = ts.writable.getWriter();

  const write = (obj: any) =>
    writer.write(enc.encode(JSON.stringify(obj) + "\n"));

  (async () => {
    try {
      if (!env.OPENAI_API_KEY || !env.BUGZILLA_API_KEY) {
        write({
          kind: "error",
          msg: "Server missing OPENAI_API_KEY or BUGZILLA_API_KEY",
        });
        return;
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
      } = body || {};

      // Wire core progress to NDJSON events for the client
      const hooks = {
        info: (msg: string) => write({ kind: "info", msg }),
        warn: (msg: string) => write({ kind: "warn", msg }),
        phase: (name: string, meta?: Record<string, unknown>) =>
          write({ kind: "phase", name, ...(meta || {}) }),
        progress: (name: string, current: number, total?: number) =>
          write({ kind: "progress", phase: name, current, total }),
      };

      // Kick off
      write({ kind: "start", msg: "Starting snazzybot…" });

      const { output } = await generateStatus(
        { components, metabugs, whiteboards, days, format, model, debug },
        {
          OPENAI_API_KEY: env.OPENAI_API_KEY,
          BUGZILLA_API_KEY: env.BUGZILLA_API_KEY,
          BUGZILLA_HOST: env.BUGZILLA_HOST,
        },
        hooks
      );

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
