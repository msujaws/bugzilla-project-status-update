// functions/api/status.ts
import {
  generateStatus,
  discoverCandidates,
  qualifyHistoryPage,
} from "../../src/core";
import {
  checkRateLimit,
  getClientIP,
  rateLimitedResponse,
} from "../../src/utils/rateLimiter";

type Env = {
  OPENAI_API_KEY: string;
  BUGZILLA_API_KEY: string;
  GITHUB_API_KEY?: string;
};

// Rate limit: 30 requests per minute per IP
const STATUS_RATE_LIMIT = { maxRequests: 30, windowMs: 60_000 };

// Input validation limits
const MAX_ARRAY_LENGTH = 100;
const MAX_STRING_LENGTH = 500;
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const VALID_MODES = ["discover", "page", "finalize", "oneshot"] as const;
const VALID_FORMATS = ["md", "html"] as const;
const VALID_VOICES = ["normal", "casual", "formal"] as const;
const VALID_AUDIENCES = ["technical", "executive", "general"] as const;

const CONTENT_SECURITY_POLICY =
  "default-src 'self' blob:; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com; img-src 'self' https: data:; font-src 'self' data:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const withSecurityHeaders = (headers: globalThis.HeadersInit = {}) => {
  const merged = new Headers(headers);
  merged.set("content-security-policy", CONTENT_SECURITY_POLICY);
  return merged;
};

/**
 * Generate a short unique error ID for tracking purposes.
 * Uses timestamp + random suffix to create a unique identifier.
 */
const generateErrorId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${timestamp}-${random}`;
};

/**
 * Create a safe, generic error response that doesn't leak internal details.
 * Logs the full error server-side for debugging while returning a sanitized message to clients.
 */
const createSafeErrorResponse = (
  error: unknown,
  context: string,
): { message: string; errorId: string } => {
  const errorId = generateErrorId();

  // Log full error details server-side for debugging
  console.error(`[${context}] Error ${errorId}:`, error);

  // Return generic message to client - don't expose internal error details
  return {
    message: `An error occurred while processing your request. Error ID: ${errorId}`,
    errorId,
  };
};

/**
 * Create a 400 Bad Request response for validation errors.
 */
const validationErrorResponse = (message: string) => {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: withSecurityHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    }),
  });
};

/**
 * Validate array fields - check length and item string lengths.
 */
const validateArrayField = (
  arr: unknown,
  fieldName: string,
): string | undefined => {
  if (!Array.isArray(arr)) return undefined;

  if (arr.length > MAX_ARRAY_LENGTH) {
    return `${fieldName} array exceeds maximum length of ${MAX_ARRAY_LENGTH}`;
  }

  for (const item of arr) {
    if (typeof item === "string" && item.length > MAX_STRING_LENGTH) {
      return `${fieldName} string exceeds maximum length of ${MAX_STRING_LENGTH} characters`;
    }
  }

  return undefined;
};

/**
 * Validate all input parameters.
 * Returns an error message string if validation fails, undefined if valid.
 */
const validateInput = (body: Record<string, unknown>): string | undefined => {
  // Validate array fields
  const arrayFields = [
    "components",
    "metabugs",
    "whiteboards",
    "assignees",
    "githubRepos",
    "ids",
  ] as const;

  for (const field of arrayFields) {
    const error = validateArrayField(body[field], field);
    if (error) return error;
  }

  // Validate days
  const days = body.days;
  if (days !== undefined) {
    const daysNum = Number(days);
    if (Number.isNaN(daysNum) || daysNum < MIN_DAYS || daysNum > MAX_DAYS) {
      return `days must be between ${MIN_DAYS} and ${MAX_DAYS}`;
    }
  }

  // Validate pageSize
  const pageSize = body.pageSize;
  if (pageSize !== undefined) {
    const pageSizeNum = Number(pageSize);
    if (
      Number.isNaN(pageSizeNum) ||
      pageSizeNum < MIN_PAGE_SIZE ||
      pageSizeNum > MAX_PAGE_SIZE
    ) {
      return `pageSize must be between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}`;
    }
  }

  // Validate mode
  const mode = body.mode;
  if (
    mode !== undefined &&
    !VALID_MODES.includes(mode as (typeof VALID_MODES)[number])
  ) {
    return `Invalid mode. Must be one of: ${VALID_MODES.join(", ")}`;
  }

  // Validate format
  const format = body.format;
  if (
    format !== undefined &&
    !VALID_FORMATS.includes(format as (typeof VALID_FORMATS)[number])
  ) {
    return `Invalid format. Must be one of: ${VALID_FORMATS.join(", ")}`;
  }

  // Validate voice
  const voice = body.voice;
  if (
    voice !== undefined &&
    !VALID_VOICES.includes(voice as (typeof VALID_VOICES)[number])
  ) {
    return `Invalid voice. Must be one of: ${VALID_VOICES.join(", ")}`;
  }

  // Validate audience
  const audience = body.audience;
  if (
    audience !== undefined &&
    !VALID_AUDIENCES.includes(audience as (typeof VALID_AUDIENCES)[number])
  ) {
    return `Invalid audience. Must be one of: ${VALID_AUDIENCES.join(", ")}`;
  }

  return undefined;
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Apply rate limiting
  const clientIP = getClientIP(request);
  const rateLimit = checkRateLimit(clientIP, STATUS_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(
      rateLimit.resetAt,
      withSecurityHeaders({
        "content-type": "application/json; charset=utf-8",
      }),
    );
  }

  if (!env.OPENAI_API_KEY || !env.BUGZILLA_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "Server configuration error. Please contact the administrator.",
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

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  // Validate input before processing
  const validationError = validateInput(body);
  if (validationError) {
    return validationErrorResponse(validationError);
  }

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
    githubRepos = [],
    emailMapping = {},
    includeGithubActivity = false,
    mode = "oneshot", // "discover" | "page" | "finalize" | "oneshot" (legacy)
    cursor = 0,
    pageSize = 35,
    // only for finalize
    ids = [],
  } = body;

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
    debug,
    assignees,
    voice,
    audience,
    includePatchContext,
    githubRepos,
    emailMapping,
    includeGithubActivity,
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
            headers: withSecurityHeaders({
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            }),
          },
        );
      } catch (error: unknown) {
        const safeError = createSafeErrorResponse(error, "status-api");
        return new Response(
          JSON.stringify({
            error: safeError.message,
            errorId: safeError.errorId,
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
    }
    if (mode === "page") {
      try {
        const { sinceISO, candidates } = await discoverCandidates(
          params,
          envConfig,
        );
        const { qualifiedIds, nextCursor, total, results } =
          await qualifyHistoryPage(
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
          JSON.stringify({ qualifiedIds, nextCursor, total, results }),
          {
            status: 200,
            headers: withSecurityHeaders({
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            }),
          },
        );
      } catch (error: unknown) {
        const safeError = createSafeErrorResponse(error, "status-api");
        return new Response(
          JSON.stringify({
            error: safeError.message,
            errorId: safeError.errorId,
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
    }
    if (mode === "finalize") {
      try {
        const { output, html, stats } = await generateStatus(
          { ...params, ids },
          envConfig,
        );
        return new Response(JSON.stringify({ output, html, stats }), {
          status: 200,
          headers: withSecurityHeaders({
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          }),
        });
      } catch (error: unknown) {
        const safeError = createSafeErrorResponse(error, "status-api");
        return new Response(
          JSON.stringify({
            error: safeError.message,
            errorId: safeError.errorId,
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
    }

    // ---- Legacy one-shot (unchanged) ----
    try {
      const { output, html, stats } = await generateStatus(params, envConfig);
      return new Response(JSON.stringify({ output, html, stats }), {
        status: 200,
        headers: withSecurityHeaders({
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        }),
      });
    } catch (error: unknown) {
      const safeError = createSafeErrorResponse(error, "status-api");
      return new Response(
        JSON.stringify({
          error: safeError.message,
          errorId: safeError.errorId,
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

      const { output, html, stats } = await generateStatus(
        params,
        envConfig,
        hooks,
      );
      write({ kind: "done", output, html, stats });
    } catch (error: unknown) {
      const safeError = createSafeErrorResponse(error, "status-api-stream");
      write({
        kind: "error",
        msg: safeError.message,
        errorId: safeError.errorId,
      });
    } finally {
      await writer.close();
    }
  })();

  return new Response(ts.readable, {
    status: 200,
    headers: withSecurityHeaders({
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    }),
  });
};
