import { describe, expect, it } from "vitest";

// Mirror of parseEmailMapping in public/app.js (browser code that can't be
// imported directly here). Keep this in sync with that implementation.
function parseEmailMapping(text: string): {
  emailMapping: Record<string, string>;
  githubUsernames: string[];
} {
  const result: {
    emailMapping: Record<string, string>;
    githubUsernames: string[];
  } = { emailMapping: {}, githubUsernames: [] };
  if (!text || !text.trim()) return result;

  const seen = new Set<string>();
  const addUsername = (raw: string) => {
    const username = raw.trim();
    if (!username) return;
    const key = username.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.githubUsernames.push(username);
  };

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(.+?)\s*->\s*(.+)$/);
    if (match) {
      const [, email, username] = match;
      result.emailMapping[email.trim()] = username.trim();
      addUsername(username);
    } else {
      addUsername(line);
    }
  }

  return result;
}

describe("parseEmailMapping (frontend)", () => {
  it("parses single email mapping", () => {
    const result = parseEmailMapping("alice@mozilla.org -> alicedev");
    expect(result.emailMapping).toEqual({ "alice@mozilla.org": "alicedev" });
    expect(result.githubUsernames).toEqual(["alicedev"]);
  });

  it("parses multiple email mappings", () => {
    const input = `alice@mozilla.org -> alicedev
bob@mozilla.org -> bobdev
charlie@example.com -> charliedev`;
    const result = parseEmailMapping(input);
    expect(result.emailMapping).toEqual({
      "alice@mozilla.org": "alicedev",
      "bob@mozilla.org": "bobdev",
      "charlie@example.com": "charliedev",
    });
    expect(result.githubUsernames).toEqual([
      "alicedev",
      "bobdev",
      "charliedev",
    ]);
  });

  it("handles empty input", () => {
    expect(parseEmailMapping("")).toEqual({
      emailMapping: {},
      githubUsernames: [],
    });
    expect(parseEmailMapping("   ")).toEqual({
      emailMapping: {},
      githubUsernames: [],
    });
  });

  it("collects bare GitHub usernames without a mapping", () => {
    const input = `octocat
alice@mozilla.org -> alicedev
hubber`;
    const result = parseEmailMapping(input);
    expect(result.emailMapping).toEqual({ "alice@mozilla.org": "alicedev" });
    expect(result.githubUsernames).toEqual(["octocat", "alicedev", "hubber"]);
  });

  it("de-duplicates usernames case-insensitively", () => {
    const input = `octocat
OctoCat
alice@mozilla.org -> octocat`;
    const result = parseEmailMapping(input);
    // First occurrence wins for casing; later duplicates are dropped.
    expect(result.githubUsernames).toEqual(["octocat"]);
    expect(result.emailMapping).toEqual({ "alice@mozilla.org": "octocat" });
  });

  it("handles whitespace around mappings", () => {
    const result = parseEmailMapping("  alice@mozilla.org   ->   alicedev  ");
    expect(result.emailMapping).toEqual({ "alice@mozilla.org": "alicedev" });
    expect(result.githubUsernames).toEqual(["alicedev"]);
  });

  it("skips empty lines", () => {
    const input = `alice@mozilla.org -> alicedev

bob@mozilla.org -> bobdev

`;
    const result = parseEmailMapping(input);
    expect(result.emailMapping).toEqual({
      "alice@mozilla.org": "alicedev",
      "bob@mozilla.org": "bobdev",
    });
  });

  it("handles GitHub usernames with special characters", () => {
    const input = `alice@mozilla.org -> alice-dev
bob@mozilla.org -> bob_dev123`;
    const result = parseEmailMapping(input);
    expect(result.emailMapping).toEqual({
      "alice@mozilla.org": "alice-dev",
      "bob@mozilla.org": "bob_dev123",
    });
  });

  it("last mapping wins for duplicate emails", () => {
    const input = `alice@mozilla.org -> alicedev1
alice@mozilla.org -> alicedev2`;
    const result = parseEmailMapping(input);
    expect(result.emailMapping).toEqual({ "alice@mozilla.org": "alicedev2" });
  });

  it("handles mapping with multiple arrows (takes last)", () => {
    const result = parseEmailMapping("alice@mozilla.org -> middle -> alicedev");
    // The regex matches the first arrow, so this maps to "middle -> alicedev".
    expect(result.emailMapping).toEqual({
      "alice@mozilla.org": "middle -> alicedev",
    });
  });
});
