import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../utils/msw/node";
import { summarizeBugPage } from "../../src/core.ts";

const env = {
  OPENAI_API_KEY: "test-openai",
  BUGZILLA_API_KEY: "test-bz",
  SNAZZY_SKIP_CACHE: true,
};

// Echo the requested ids back as bugs so slicing is observable.
const echoBugsHandler = () =>
  http.get("https://bugzilla.mozilla.org/rest/bug", ({ request }) => {
    const url = new URL(request.url);
    const idsParam = url.searchParams.get("id");
    if (!idsParam) return HttpResponse.json({ bugs: [] });
    const requested = idsParam.split(",").map(Number);
    return HttpResponse.json({
      bugs: requested.map((id) => ({
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
        assigned_to: "dev@example.com",
      })),
    });
  });

describe("summarizeBugPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2025-10-29T09:36:11Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("only summarizes the requested slice and reports the next cursor", async () => {
    const requestedIdParams: string[] = [];
    server.use(
      http.get("https://bugzilla.mozilla.org/rest/bug", ({ request }) => {
        const url = new URL(request.url);
        const idsParam = url.searchParams.get("id");
        if (idsParam) requestedIdParams.push(idsParam);
        if (!idsParam) return HttpResponse.json({ bugs: [] });
        const requested = idsParam.split(",").map(Number);
        return HttpResponse.json({
          bugs: requested.map((id) => ({
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
            assigned_to: "dev@example.com",
          })),
        });
      }),
    );

    const ids = [1, 2, 3, 4, 5];
    const page = await summarizeBugPage(
      { days: 8, includePatchContext: false },
      env,
      ids,
      0,
      2,
    );

    expect(page.total).toBe(5);
    expect(page.nextCursor).toBe(2);
    expect(typeof page.summaryFragment).toBe("string");
    expect(Array.isArray(page.assessments)).toBe(true);
    // Only the first two ids were fetched/summarized.
    expect(requestedIdParams.join("|")).toContain("1,2");
    expect(requestedIdParams.join("|")).not.toContain("3");
  });

  it("returns undefined nextCursor for the final slice", async () => {
    server.use(echoBugsHandler());
    const ids = [10, 11, 12];
    const page = await summarizeBugPage(
      { days: 8, includePatchContext: false },
      env,
      ids,
      2,
      2,
    );
    expect(page.nextCursor).toBeUndefined();
    expect(page.total).toBe(3);
  });

  it("fetches GitHub activity only on the first chunk (cursor === 0)", async () => {
    let githubCommitCalls = 0;
    server.use(
      echoBugsHandler(),
      http.get("https://api.github.com/repos/:owner/:repo/commits", () => {
        githubCommitCalls += 1;
        return HttpResponse.json([]);
      }),
      http.get("https://api.github.com/repos/:owner/:repo/pulls", () =>
        HttpResponse.json([]),
      ),
    );

    const params = {
      days: 8,
      includePatchContext: false,
      includeGithubActivity: true,
      githubRepos: ["mozilla/example"],
    };
    const envWithGithub = { ...env, GITHUB_API_KEY: "gh-token" };
    const ids = [1, 2, 3, 4];

    await summarizeBugPage(params, envWithGithub, ids, 0, 2);
    expect(githubCommitCalls).toBe(1);

    // A later chunk must not re-fetch GitHub activity.
    await summarizeBugPage(params, envWithGithub, ids, 2, 2);
    expect(githubCommitCalls).toBe(1);
  });
});
