import { describe, expect, it } from "vitest";
import {
  buildFooterLinks,
  formatSummaryOutput,
} from "../../src/status/recipeHelpers.ts";
import type { StatusContext } from "../../src/status/context.ts";

const baseCtx = (overrides: Partial<StatusContext>): StatusContext =>
  ({
    env: {},
    sinceISO: "2026-01-01",
    components: [],
    whiteboards: [],
    metabugs: [],
    assignees: [],
    githubRepos: [],
    githubUsernames: [],
    githubOrgs: [],
    ...overrides,
  }) as unknown as StatusContext;

describe("formatSummaryOutput footer", () => {
  it("renders a single GitHub link", () => {
    const { markdown, html } = formatSummaryOutput({
      summaryMd: "## @alicedev\n- did things",
      demo: [],
      trimmedCount: 0,
      links: [
        { label: "View work on GitHub", url: "https://github.com/search?q=x" },
      ],
    });

    expect(markdown).toContain(
      "[View work on GitHub](https://github.com/search?q=x)",
    );
    expect(markdown).not.toContain("View bugs in Bugzilla");
    expect(html).toContain('href="https://github.com/search?q=x"');
    expect(html).toContain("View work on GitHub");
  });

  it("renders both links for mixed runs", () => {
    const { markdown } = formatSummaryOutput({
      summaryMd: "summary",
      demo: [],
      trimmedCount: 0,
      links: [
        { label: "View bugs in Bugzilla", url: "https://bugzilla/x" },
        { label: "View work on GitHub", url: "https://github.com/search?q=x" },
      ],
    });

    expect(markdown).toContain("View bugs in Bugzilla");
    expect(markdown).toContain("View work on GitHub");
  });
});

describe("buildFooterLinks", () => {
  it("returns only a GitHub link for a username-only run", () => {
    const links = buildFooterLinks(
      baseCtx({ githubUsernames: ["alicedev"], githubOrgs: ["mozilla"] }),
      [],
    );
    expect(links).toHaveLength(1);
    expect(links[0].label).toBe("View work on GitHub");
    expect(links[0].url).toContain("github.com/search");
  });

  it("returns only a Bugzilla link for a Bugzilla-only run", () => {
    const links = buildFooterLinks(baseCtx({ whiteboards: ["[tag]"] }), []);
    expect(links).toHaveLength(1);
    expect(links[0].label).toBe("View bugs in Bugzilla");
  });

  it("returns both links for a mixed run", () => {
    const links = buildFooterLinks(
      baseCtx({ whiteboards: ["[tag]"], githubUsernames: ["alicedev"] }),
      [],
    );
    expect(links.map((l) => l.label)).toEqual([
      "View bugs in Bugzilla",
      "View work on GitHub",
    ]);
  });
});
