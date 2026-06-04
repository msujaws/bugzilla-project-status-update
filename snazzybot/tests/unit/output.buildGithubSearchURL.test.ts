import { describe, expect, it } from "vitest";
import { buildGithubSearchURL } from "../../src/status/output.ts";

describe("buildGithubSearchURL", () => {
  it("builds a PR-by-author search scoped to orgs and the window", () => {
    const url = buildGithubSearchURL({
      githubUsernames: ["alicedev", "bobdev"],
      githubOrgs: ["mozilla"],
      sinceISO: "2026-01-01",
    });

    const parsed = new URL(url);
    expect(parsed.host).toBe("github.com");
    expect(parsed.pathname).toBe("/search");
    expect(parsed.searchParams.get("type")).toBe("pullrequests");

    const q = parsed.searchParams.get("q") ?? "";
    expect(q).toContain("is:pr");
    expect(q).toContain("author:alicedev");
    expect(q).toContain("author:bobdev");
    expect(q).toContain("org:mozilla");
    expect(q).toContain("created:>=2026-01-01");
  });

  it("works without orgs", () => {
    const url = buildGithubSearchURL({
      githubUsernames: ["alicedev"],
      sinceISO: "2026-03-15",
    });

    const q = new URL(url).searchParams.get("q") ?? "";
    expect(q).toContain("author:alicedev");
    expect(q).not.toContain("org:");
    expect(q).toContain("created:>=2026-03-15");
  });
});
