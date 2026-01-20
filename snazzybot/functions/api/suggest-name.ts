// functions/api/suggest-name.ts
import {
  checkRateLimit,
  getClientIP,
  rateLimitedResponse,
} from "../../src/utils/rateLimiter";

interface Env {
  OPENAI_API_KEY: string;
}

// Rate limit: 20 requests per minute per IP (more restrictive for AI calls)
const SUGGEST_RATE_LIMIT = { maxRequests: 20, windowMs: 60_000 };

interface SearchParams {
  components?: string;
  whiteboards?: string;
  metabugs?: string;
  assignees?: string;
  githubRepos?: string;
  emailMapping?: string;
  days?: number;
}

interface RequestBody {
  params?: SearchParams;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Apply rate limiting
  const clientIP = getClientIP(request);
  const rateLimit = checkRateLimit(clientIP, SUGGEST_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.resetAt);
  }

  if (!env.OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "Server configuration error. Please contact the administrator.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }

  try {
    const body: RequestBody = await request.json().catch(() => ({}));
    const params = body.params || {};

    // Build description of search parameters
    const parts: string[] = [];
    if (params.components) parts.push(`Components: ${params.components}`);
    if (params.whiteboards) parts.push(`Whiteboards: ${params.whiteboards}`);
    if (params.metabugs) parts.push(`Metabugs: ${params.metabugs}`);
    if (params.assignees) parts.push(`Assignees: ${params.assignees}`);
    if (params.githubRepos) parts.push(`GitHub Repos: ${params.githubRepos}`);
    if (params.days) parts.push(`Days: ${params.days}`);

    const description = parts.length > 0 ? parts.join("\n") : "General search";

    const system = `You are a helpful assistant that generates concise, descriptive names for saved searches.
The name should be under 40 characters and capture the essence of what the search is filtering for.
Use technical terminology appropriate for developers.
Return only valid JSON with a "name" field.`;

    const user = `Generate a short, descriptive name for this Bugzilla search:

${description}

Return format: {"name": "Your Name Here"}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to generate name suggestion");
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content in OpenAI response");
    }

    const result = JSON.parse(content);

    return new Response(JSON.stringify({ name: result.name }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    // Log detailed error for debugging, but return generic message to client
    console.error("Name suggestion error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to generate name suggestion. Please try again.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }
};
