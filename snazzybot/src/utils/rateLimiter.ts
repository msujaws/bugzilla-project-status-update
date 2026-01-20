/**
 * Simple in-memory rate limiter for Cloudflare Workers.
 *
 * Note: This rate limiter is per-isolate and will reset on cold starts.
 * For persistent rate limiting, use Cloudflare Rate Limiting or KV storage.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically to prevent memory growth
const CLEANUP_INTERVAL_MS = 60_000; // 1 minute
let lastCleanup = Date.now();

function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  lastCleanup = now;
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check if a request should be allowed based on rate limit.
 *
 * @param identifier - Unique identifier for the client (e.g., IP address)
 * @param config - Rate limit configuration
 * @returns Whether the request is allowed and rate limit info
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
): RateLimitResult {
  cleanupExpired();

  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || now > entry.resetAt) {
    // New window
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(identifier, newEntry);
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: newEntry.resetAt,
    };
  }

  if (entry.count >= config.maxRequests) {
    // Rate limit exceeded
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  // Increment counter
  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Get client IP from Cloudflare request headers.
 * Falls back to a default identifier if IP is not available.
 */
export function getClientIP(request: Request): string {
  // Cloudflare provides the client IP in the CF-Connecting-IP header
  const cfIP = request.headers.get("CF-Connecting-IP");
  if (cfIP) return cfIP;

  // Fallback to X-Forwarded-For (first IP in the chain)
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) {
    const firstIP = xff.split(",")[0].trim();
    if (firstIP) return firstIP;
  }

  // Last resort fallback
  return "unknown";
}

/**
 * Create a rate-limited response.
 */
export function rateLimitedResponse(
  resetAt: number,
  headers: Headers = new Headers(),
): Response {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
  headers.set("Retry-After", String(Math.max(1, retryAfter)));
  headers.set("X-RateLimit-Remaining", "0");
  headers.set("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

  return new Response(
    JSON.stringify({
      error: "Too many requests. Please try again later.",
    }),
    {
      status: 429,
      headers,
    },
  );
}
