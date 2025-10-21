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
      hooks,
    );
    expect(ids).toEqual([1_987_802]);
    expect(output).toMatch(/View bugs in Bugzilla/);
    expect(hooks.phase).toHaveBeenCalledWith(
      "collect-whiteboards",
      expect.objectContaining({ total: expect.any(Number) }),
    );
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
        },
      ),
    );

    const res = await generateStatus(
      {
        days: 8,
        components: [{ product: "Firefox", component: "General" }],
      },
      env,
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
            }),
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
        },
      ),
    );

    const res = await generateStatus(
      {
        components: [{ product: "Firefox", component: "General" }],
        days: 8,
        format: "md",
      },
      env,
    );
    expect(res.output).toMatch(/omitted from the AI summary/);
    expect(res.ids.length).toBe(65);
  });
});
