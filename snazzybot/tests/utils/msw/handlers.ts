import { http, HttpResponse } from "msw";

// Minimal, offline-only handlers. We DO NOT call real services.
export const handlers = [
  // OpenAI mock (JSON mode)
  http.post("https://api.openai.com/v1/chat/completions", async () => {
    return HttpResponse.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              assessments: [
                {
                  bug_id: 1_987_802,
                  impact_score: 7,
                  short_reason: "Visible UI fix",
                  demo_suggestion: "Show toggle without tooltip.",
                },
              ],
              summary_md:
                "### Weekly status\n- User-facing improvement shipped.",
            }),
          },
        },
      ],
    });
  }),

  // Bugzilla mock endpoints used by core:
  http.get("https://bugzilla.mozilla.org/rest/bug", ({ request }) => {
    const url = new URL(request.url);
    // return a tiny fixture depending on query presence
    const ids = url.searchParams.get("id");
    const whiteboard = url.searchParams.get("whiteboard");
    const product = url.searchParams.getAll("product");
    const component = url.searchParams.getAll("component");

    // Minimal DONE/FIXED bug
    const bug = {
      id: 1_987_802,
      summary: "[a11y] Remove VPN toggle hover tooltip",
      product: product[0] || "Firefox",
      component: component[0] || "IP Protection",
      status: "RESOLVED",
      resolution: "FIXED",
      last_change_time: "2025-10-21T09:36:11Z",
      groups: [],
      depends_on: [],
      blocks: [],
    };

    if (ids) {
      return HttpResponse.json({ bugs: [bug] });
    }
    if (whiteboard) {
      return HttpResponse.json({ bugs: [bug] });
    }
    return HttpResponse.json({ bugs: [bug] });
  }),

  // Bug history
  http.get(
    "https://bugzilla.mozilla.org/rest/bug/:id/history",
    ({ params }) => {
      const { id } = params as { id: string };
      return HttpResponse.json({
        bugs: [
          {
            id: Number(id),
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
];
