import { Miniflare } from "miniflare";

type RequestInfoLike = Parameters<typeof fetch>[0];
type RequestInitLike = Parameters<typeof fetch>[1];

async function createFallback(bindings: Record<string, string>) {
  const { onRequestPost } = await import("../../functions/api/status.ts");
  return {
    async dispatchFetch(input: RequestInfoLike, init?: RequestInitLike) {
      const request = new Request(input, init);
      return onRequestPost({
        request,
        env: bindings,
        waitUntil: async () => {},
        next: async () => new Response("Not implemented", { status: 501 }),
        data: {},
      } as unknown as Parameters<typeof onRequestPost>[0]);
    },
    async dispose() {
      // no-op fallback
    },
  };
}

// Helper to start the Pages Function locally for tests that hit /api/status
export async function makeMiniflare(
  env: Record<string, string> = {},
  options: { forceFallback?: boolean } = {},
) {
  const bindings = {
    OPENAI_API_KEY: "test-openai",
    BUGZILLA_API_KEY: "test-bz",
    ...env,
  };

  if (options.forceFallback) {
    return createFallback(bindings);
  }

  try {
    const mf = new Miniflare({
      modules: true,
      compatibilityDate: "2025-10-08",
      bindings,
      scriptPath: "functions/api/status.ts",
    });
    // Ensure server spun up before returning
    await mf.ready;
    return mf;
  } catch {
    // Fallback path for test environments where Miniflare can't bundle TS
    // Workers: invoke the Pages Function directly while preserving the same interface
    return createFallback(bindings);
  }
}
