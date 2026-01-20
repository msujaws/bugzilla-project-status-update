import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../utils/msw/node";

// Import the function to test
import { onRequestPost } from "../../functions/api/suggest-name";

describe("Suggest Name API Function", () => {
  const mockEnv = {
    OPENAI_API_KEY: "test-api-key-12345",
  };

  beforeEach(() => {
    // Setup default OpenAI mock
    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json({
          choices: [
            {
              message: {
                content: JSON.stringify({ name: "DevTools Weekly Updates" }),
              },
            },
          ],
        });
      }),
    );
  });

  afterEach(() => {
    server.resetHandlers();
  });

  it("generates search name from parameters", async () => {
    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { components: "DevTools:Debugger", days: 7 },
      }),
    });

    const response = await onRequestPost({ request, env: mockEnv });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.name).toBe("DevTools Weekly Updates");
  });

  it("uses gpt-4o-mini model for cost efficiency", async () => {
    let capturedModel;

    server.use(
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request }) => {
          const body = await request.json();
          capturedModel = body.model;
          return HttpResponse.json({
            choices: [
              { message: { content: JSON.stringify({ name: "Test" }) } },
            ],
          });
        },
      ),
    );

    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { components: "Firefox", days: 7 },
      }),
    });

    await onRequestPost({ request, env: mockEnv });
    expect(capturedModel).toBe("gpt-4o-mini");
  });

  it("generates concise names under 40 characters", async () => {
    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  name: "Firefox VPN & Sidebar Updates",
                }),
              },
            },
          ],
        });
      }),
    );

    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { components: "Firefox:General", days: 14 },
      }),
    });

    const response = await onRequestPost({ request, env: mockEnv });
    const data = await response.json();

    expect(data.name.length).toBeLessThanOrEqual(40);
  });

  it("handles multiple filters in name generation", async () => {
    let capturedPrompt;

    server.use(
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request }) => {
          const body = await request.json();
          capturedPrompt = body.messages[1].content;
          return HttpResponse.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    name: "Firefox & DevTools VPN - 14d",
                  }),
                },
              },
            ],
          });
        },
      ),
    );

    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: {
          components: "Firefox:General\nDevTools",
          whiteboards: "[fx-vpn]",
          days: 14,
        },
      }),
    });

    const response = await onRequestPost({ request, env: mockEnv });
    const data = await response.json();

    expect(capturedPrompt).toContain("Firefox:General");
    expect(capturedPrompt).toContain("[fx-vpn]");
    expect(data.name).toContain("Firefox");
  });

  it("returns error when OpenAI API key is missing", async () => {
    const envWithoutKey = {};
    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { components: "Firefox", days: 7 },
      }),
    });

    const response = await onRequestPost({ request, env: envWithoutKey });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain("Server configuration error");
  });

  it("returns error when OpenAI API fails", async () => {
    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json(
          { error: { message: "Rate limit exceeded" } },
          { status: 429 },
        );
      }),
    );

    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { components: "Firefox", days: 7 },
      }),
    });

    const response = await onRequestPost({ request, env: mockEnv });
    expect(response.status).toBe(500);
  });

  it("handles malformed JSON response from OpenAI", async () => {
    server.use(
      http.post("https://api.openai.com/v1/chat/completions", () => {
        return HttpResponse.json({
          choices: [{ message: { content: "not valid json" } }],
        });
      }),
    );

    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { components: "Firefox", days: 7 },
      }),
    });

    const response = await onRequestPost({ request, env: mockEnv });
    expect(response.status).toBe(500);
  });

  it("uses JSON response format for structured output", async () => {
    let capturedFormat;

    server.use(
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request }) => {
          const body = await request.json();
          capturedFormat = body.response_format;
          return HttpResponse.json({
            choices: [
              { message: { content: JSON.stringify({ name: "Test" }) } },
            ],
          });
        },
      ),
    );

    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { components: "Firefox", days: 7 },
      }),
    });

    await onRequestPost({ request, env: mockEnv });
    expect(capturedFormat).toEqual({ type: "json_object" });
  });

  it("sends correct Authorization header", async () => {
    let capturedAuth;

    server.use(
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request }) => {
          capturedAuth = request.headers.get("Authorization");
          return HttpResponse.json({
            choices: [
              { message: { content: JSON.stringify({ name: "Test" }) } },
            ],
          });
        },
      ),
    );

    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { components: "Firefox", days: 7 },
      }),
    });

    await onRequestPost({ request, env: mockEnv });
    expect(capturedAuth).toBe("Bearer test-api-key-12345");
  });

  it("handles missing request body gracefully", async () => {
    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await onRequestPost({ request, env: mockEnv });
    const data = await response.json();

    // Should still work with empty params
    expect(response.status).toBe(200);
    expect(data.name).toBeTruthy();
  });

  it("includes all param types in prompt", async () => {
    let capturedPrompt;

    server.use(
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request }) => {
          const body = await request.json();
          capturedPrompt = body.messages[1].content;
          return HttpResponse.json({
            choices: [
              { message: { content: JSON.stringify({ name: "Test" }) } },
            ],
          });
        },
      ),
    );

    const request = new Request("https://test.local/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: {
          components: "Firefox",
          whiteboards: "[tag]",
          metabugs: "123456",
          assignees: "dev@example.com",
          githubRepos: "mozilla/firefox",
          days: 30,
        },
      }),
    });

    await onRequestPost({ request, env: mockEnv });

    expect(capturedPrompt).toContain("Components: Firefox");
    expect(capturedPrompt).toContain("Whiteboards: [tag]");
    expect(capturedPrompt).toContain("Metabugs: 123456");
    expect(capturedPrompt).toContain("Assignees: dev@example.com");
    expect(capturedPrompt).toContain("GitHub Repos: mozilla/firefox");
    expect(capturedPrompt).toContain("Days: 30");
  });
});
