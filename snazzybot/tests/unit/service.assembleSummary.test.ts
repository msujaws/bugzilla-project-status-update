import { describe, expect, it } from "vitest";
import { assembleSummary } from "../../src/core.ts";

const env = {
  OPENAI_API_KEY: "test-openai",
  BUGZILLA_API_KEY: "test-bz",
};

describe("assembleSummary", () => {
  it("joins fragments with blank lines and appends the buglist link (md + html)", () => {
    const { output, html } = assembleSummary(
      { days: 8, format: "md", assignees: ["dev@example.com"] },
      env,
      [101, 102],
      ["First fragment.", "Second fragment."],
      [],
      0,
    );
    expect(output).toContain("First fragment.");
    expect(output).toContain("Second fragment.");
    // joined with a blank line between fragments
    expect(output).toContain("First fragment.\n\nSecond fragment.");
    expect(output).toMatch(/\[View bugs in Bugzilla\]\(/);
    expect(html).toMatch(/View bugs in Bugzilla/);
    expect(html).toContain("<a href=");
  });

  it("drops empty fragments before joining", () => {
    const { output } = assembleSummary(
      { days: 8, format: "md" },
      env,
      [1],
      ["", "Only real fragment.", ""],
      [],
      0,
    );
    expect(output).toContain("Only real fragment.");
    expect(output).not.toMatch(/\n\n\n/);
  });

  it("includes demo suggestions only for assessments scoring >= 8 with a suggestion", () => {
    const { output } = assembleSummary(
      { days: 8, format: "md" },
      env,
      [1, 2, 3],
      ["Body."],
      [
        { bug_id: 1, impact_score: 9, demo_suggestion: "Demo the new toggle." },
        { bug_id: 2, impact_score: 7, demo_suggestion: "Too low to show." },
        { bug_id: 3, impact_score: 10, demo_suggestion: undefined },
      ],
      0,
    );
    expect(output).toContain("Demo suggestions");
    expect(output).toContain("Demo the new toggle.");
    expect(output).not.toContain("Too low to show.");
  });

  it("renders the trimmed-count note when trimmedCount > 0", () => {
    const { output } = assembleSummary(
      { days: 8, format: "md" },
      env,
      [1],
      ["Body."],
      [],
      3,
    );
    expect(output).toMatch(
      /3 additional bugs were omitted from the AI summary/,
    );
  });

  it("returns html as output when format is html", () => {
    const { output, html } = assembleSummary(
      { days: 8, format: "html" },
      env,
      [1],
      ["Body."],
      [],
      0,
    );
    expect(output).toBe(html);
  });

  it("renders the no-changes message when there are no fragments", () => {
    const { output, html } = assembleSummary(
      { days: 8, format: "md" },
      env,
      [],
      [],
      [],
      0,
    );
    expect(output).toMatch(/No user-impacting changes in the last 8 days/);
    expect(output).toMatch(/View bugs in Bugzilla/);
    expect(html).toContain("<em>No user-impacting changes");
  });

  it("reports candidatesTotal and qualified counts in stats", () => {
    const { stats } = assembleSummary(
      { days: 8, format: "md" },
      env,
      [1, 2, 3],
      ["Body."],
      [],
      0,
      96,
    );
    expect(stats.bugzilla?.candidates).toBe(96);
    expect(stats.bugzilla?.qualified).toBe(3);
  });
});
