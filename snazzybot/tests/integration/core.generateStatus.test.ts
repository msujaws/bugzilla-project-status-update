import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../utils/msw/node";
import { generateStatus, buildBuglistURL } from "../../src/core.ts";

const env = {
  OPENAI_API_KEY: "test-openai",
  BUGZILLA_API_KEY: "test-bz",
};

describe("core integration (with MSW mocks)", () => {
  it("qualifies bugs by history in-window and summarizes", async () => {
    const hooks = {
      info: vi.fn(),
      warn: vi.fn(),
      phase: vi.fn(),
      progress: vi.fn(),
    };
    const { output, ids } = await generateStatus(
      {
        days: 8,
        model: "gpt-5",
        format: "md",
        debug: true,
        components: [{ product: "Firefox", component: "IP Protection" }],
        whiteboards: ["[fx-vpn]"],
      },
      env,
      hooks
    );
    expect(ids).toEqual([1_987_802]);
    expect(output).toMatch(/View bugs in Bugzilla/);
    expect(hooks.phase).toHaveBeenCalledWith(
      "collect-whiteboards",
      expect.objectContaining({ total: expect.any(Number) })
    );
    expect(hooks.phase).toHaveBeenCalledWith(
      "patch-context",
      expect.objectContaining({ total: expect.any(Number) })
    );
    expect(
      hooks.info.mock.calls.some(
        (call) =>
          typeof call[0] === "string" && call[0].includes("[debug] [patch]")
      )
    ).toBe(true);
  });

  it("builds buglist URL for components + whiteboards", () => {
    const url = buildBuglistURL({
      sinceISO: new Date().toISOString(),
      components: [{ product: "Firefox", component: "General" }],
      whiteboards: ["[tag]"],
      ids: [123, 456],
    });
    expect(url).toContain("/buglist.cgi");
    expect(url).toContain("bug_id=123%2C456");
    expect(url).toContain("status_whiteboard");
  });

  it("filters out bugs without qualifying history transitions", async () => {
    server.use(
      http.get("https://bugzilla.mozilla.org/rest/bug", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.has("product")) {
          return HttpResponse.json({
            bugs: [
              {
                id: 1_987_802,
                summary: "Qualifies",
                product: "Firefox",
                component: "General",
                status: "RESOLVED",
                resolution: "FIXED",
                last_change_time: "2025-10-21T09:36:11Z",
                groups: [],
                depends_on: [],
                blocks: [],
              },
              {
                id: 1_987_803,
                summary: "No qualifying history",
                product: "Firefox",
                component: "General",
                status: "RESOLVED",
                resolution: "FIXED",
                last_change_time: "2025-10-21T09:36:11Z",
                groups: [],
                depends_on: [],
                blocks: [],
              },
            ],
          });
        }
        return HttpResponse.json({
          bugs: [
            {
              id: 1_987_802,
              summary: "[a11y] Remove VPN toggle hover tooltip",
              product: "Firefox",
              component: "IP Protection",
              status: "RESOLVED",
              resolution: "FIXED",
              last_change_time: "2025-10-21T09:36:11Z",
              groups: [],
              depends_on: [],
              blocks: [],
            },
          ],
        });
      }),
      http.get(
        "https://bugzilla.mozilla.org/rest/bug/:id/history",
        ({ params }) => {
          const id = Number((params as { id: string }).id);
          if (id === 1_987_803) {
            return HttpResponse.json({
              bugs: [
                {
                  id,
                  history: [
                    {
                      when: "2025-10-21T09:36:11Z",
                      changes: [
                        {
                          field_name: "status",
                          removed: "RESOLVED",
                          added: "ASSIGNED",
                        },
                      ],
                    },
                  ],
                },
              ],
            });
          }
          return HttpResponse.json({
            bugs: [
              {
                id,
                history: [
                  {
                    when: "2025-10-21T09:36:11Z",
                    changes: [
                      {
                        field_name: "status",
                        removed: "ASSIGNED",
                        added: "RESOLVED",
                      },
                      { field_name: "resolution", removed: "", added: "FIXED" },
                    ],
                  },
                ],
              },
            ],
          });
        }
      )
    );

    const res = await generateStatus(
      {
        days: 8,
        components: [{ product: "Firefox", component: "General" }],
      },
      env
    );
    expect(res.ids).toEqual([1_987_802]);
  });

  it("adds trimming note when exceeding MAX_BUGS_FOR_OPENAI", async () => {
    server.use(
      http.get("https://bugzilla.mozilla.org/rest/bug", ({ request }) => {
        const url = new URL(request.url);
        const idsParam = url.searchParams.get("id");
        if (url.searchParams.has("product")) {
          const bugs = Array.from({ length: 65 }, (_, i) => 1000 + i).map(
            (id) => ({
              id,
              summary: `bug-${id}`,
              product: url.searchParams.getAll("product")[0] || "Firefox",
              component: url.searchParams.getAll("component")[0] || "General",
              status: "RESOLVED",
              resolution: "FIXED",
              last_change_time: "2025-10-21T09:36:11Z",
              groups: [],
              depends_on: [],
              blocks: [],
            })
          );
          return HttpResponse.json({ bugs });
        }
        if (idsParam) {
          const ids = idsParam.split(",").map(Number);
          return HttpResponse.json({
            bugs: ids.map((id) => ({
              id,
              summary: `bug-${id}`,
              product: "Firefox",
              component: "General",
              status: "RESOLVED",
              resolution: "FIXED",
              last_change_time: "2025-10-21T09:36:11Z",
              groups: [],
              depends_on: [],
              blocks: [],
            })),
          });
        }
        return HttpResponse.json({
          bugs: [
            {
              id: 1_987_802,
              summary: "[a11y] Remove VPN toggle hover tooltip",
              product: "Firefox",
              component: "IP Protection",
              status: "RESOLVED",
              resolution: "FIXED",
              last_change_time: "2025-10-21T09:36:11Z",
              groups: [],
              depends_on: [],
              blocks: [],
            },
          ],
        });
      }),
      http.get(
        "https://bugzilla.mozilla.org/rest/bug/:id/history",
        ({ params }) => {
          const id = Number((params as { id: string }).id);
          return HttpResponse.json({
            bugs: [
              {
                id,
                history: [
                  {
                    when: "2025-10-21T09:36:11Z",
                    changes: [
                      {
                        field_name: "status",
                        removed: "ASSIGNED",
                        added: "RESOLVED",
                      },
                      { field_name: "resolution", removed: "", added: "FIXED" },
                    ],
                  },
                ],
              },
            ],
          });
        }
      )
    );

    const res = await generateStatus(
      {
        components: [{ product: "Firefox", component: "General" }],
        days: 8,
        format: "md",
      },
      env
    );
    expect(res.output).toMatch(/omitted from the AI summary/);
    expect(res.ids.length).toBe(65);
  });

  it("includes patch context in OpenAI payload when available", async () => {
    const commitUrl =
      "https://github.com/mozilla/example/commit/abcdef1234567890";
    const patchBody = `From 6e83430b3c4c4f7bc3a456df530eb93d9163d6b4 Mon Sep 17 00:00:00 2001
From: Example Author <dev@example.com>
Date: Wed, 1 Jan 2025 12:34:56 +0000
Subject: [PATCH] Example fix

---
 file.txt | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)

diff --git a/file.txt b/file.txt
index e69de29..4b825dc 100644
--- a/file.txt
+++ b/file.txt
@@
-old line
+new line
`;

    const pulsebotXml = (id: number) => `<?xml version="1.0" encoding="UTF-8"?>
<bugzilla>
  <bug>
    <bug_id>${id}</bug_id>
    <long_desc>
      <who name="Pulsebot">pulsebot</who>
      <bug_when>2025-01-02 00:00:00</bug_when>
      <thetext>Landed via automation: ${commitUrl}</thetext>
    </long_desc>
  </bug>
</bugzilla>`;

    let capturedOpenAi: unknown;
    server.use(
      http.get("https://bugzilla.mozilla.org/show_bug.cgi", ({ request }) => {
        const url = new URL(request.url);
        const id = Number(url.searchParams.get("id") ?? "0");
        return HttpResponse.text(pulsebotXml(id), {
          headers: { "content-type": "text/xml; charset=utf-8" },
        });
      }),
      http.get(`${commitUrl}.patch`, () =>
        HttpResponse.text(patchBody, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        })
      ),
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request }) => {
          const body = await request.json();
          capturedOpenAi = body;
          return HttpResponse.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assessments: [],
                    summary_md: "Summary placeholder",
                  }),
                },
              },
            ],
          });
        }
      )
    );

    const envWithSkip = { ...env, SNAZZY_SKIP_CACHE: true };
    await generateStatus(
      {
        ids: [1_987_802],
        days: 8,
        model: "gpt-5",
      },
      envWithSkip
    );

    const payload = capturedOpenAi as
      | { messages?: Array<{ role: string; content: string }> }
      | undefined;
    expect(payload?.messages?.[1]?.content).toContain("Patch Context");
    expect(payload?.messages?.[1]?.content).toContain("Bug 1987802");
    expect(payload?.messages?.[1]?.content).toContain(commitUrl);
    expect(payload?.messages?.[1]?.content).toContain("Example fix");
  });

  it("skips patch context when disabled", async () => {
    const commitUrl =
      "https://github.com/mozilla/example/commit/abcdef1234567890";
    const pulsebotXml = (id: number) => `<?xml version="1.0" encoding="UTF-8"?>
<bugzilla>
  <bug>
    <bug_id>${id}</bug_id>
    <long_desc>
      <who name="Pulsebot">pulsebot@bmo.tld</who>
      <bug_when>2025-10-20 09:22:20 -0400</bug_when>
      <thetext>Pushed by bot: ${commitUrl}</thetext>
    </long_desc>
  </bug>
</bugzilla>`;

    let captured: unknown;
    server.use(
      http.get("https://bugzilla.mozilla.org/show_bug.cgi", ({ request }) => {
        const url = new URL(request.url);
        const id = Number(url.searchParams.get("id") ?? "0");
        return HttpResponse.text(pulsebotXml(id), {
          headers: { "content-type": "text/xml; charset=utf-8" },
        });
      }),
      http.get(`${commitUrl}.patch`, () =>
        HttpResponse.text("Subject: [PATCH]\n"),
      ),
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request }) => {
          captured = await request.json();
          return HttpResponse.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    assessments: [],
                    summary_md: "OK",
                  }),
                },
              },
            ],
          });
        },
      ),
    );

    await generateStatus(
      {
        ids: [1_234_567],
        includePatchContext: false,
      },
      env,
    );

    const payload = captured as
      | { messages?: Array<{ content: string }> }
      | undefined;
    expect(payload?.messages?.[1]?.content).not.toContain("Patch Context");
    expect(payload?.messages?.[1]?.content).not.toContain(commitUrl);
  });
});
