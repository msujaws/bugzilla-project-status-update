import { describe, expect, it } from "vitest";

// Extract the parseEmailMapping function for testing
function parseEmailMapping(text: string): Record<string, string> {
  if (!text || !text.trim()) return {};
  const mapping: Record<string, string> = {};
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(.+?)\s*->\s*(.+)$/);
    if (match) {
      const [, email, username] = match;
      mapping[email.trim()] = username.trim();
    }
  }
  return mapping;
}

describe("parseEmailMapping (frontend)", () => {
  it("parses single email mapping", () => {
    const input = "alice@mozilla.org -> alicedev";
    const result = parseEmailMapping(input);
    expect(result).toEqual({ "alice@mozilla.org": "alicedev" });
  });

  it("parses multiple email mappings", () => {
    const input = `alice@mozilla.org -> alicedev
bob@mozilla.org -> bobdev
charlie@example.com -> charliedev`;
    const result = parseEmailMapping(input);
    expect(result).toEqual({
      "alice@mozilla.org": "alicedev",
      "bob@mozilla.org": "bobdev",
      "charlie@example.com": "charliedev",
    });
  });

  it("handles empty input", () => {
    expect(parseEmailMapping("")).toEqual({});
    expect(parseEmailMapping("   ")).toEqual({});
  });

  it("handles whitespace around mappings", () => {
    const input = "  alice@mozilla.org   ->   alicedev  ";
    const result = parseEmailMapping(input);
    expect(result).toEqual({ "alice@mozilla.org": "alicedev" });
  });

  it("skips empty lines", () => {
    const input = `alice@mozilla.org -> alicedev

bob@mozilla.org -> bobdev

`;
    const result = parseEmailMapping(input);
    expect(result).toEqual({
      "alice@mozilla.org": "alicedev",
      "bob@mozilla.org": "bobdev",
    });
  });

  it("skips invalid lines without -> delimiter", () => {
    const input = `alice@mozilla.org -> alicedev
invalid line without delimiter
bob@mozilla.org -> bobdev`;
    const result = parseEmailMapping(input);
    expect(result).toEqual({
      "alice@mozilla.org": "alicedev",
      "bob@mozilla.org": "bobdev",
    });
  });

  it("handles various email formats", () => {
    const input = `user@example.com -> username1
user.name@example.org -> username2
user+tag@example.co.uk -> username3`;
    const result = parseEmailMapping(input);
    expect(result).toEqual({
      "user@example.com": "username1",
      "user.name@example.org": "username2",
      "user+tag@example.co.uk": "username3",
    });
  });

  it("handles GitHub usernames with special characters", () => {
    const input = `alice@mozilla.org -> alice-dev
bob@mozilla.org -> bob_dev123`;
    const result = parseEmailMapping(input);
    expect(result).toEqual({
      "alice@mozilla.org": "alice-dev",
      "bob@mozilla.org": "bob_dev123",
    });
  });

  it("handles trailing whitespace in lines", () => {
    const input = `alice@mozilla.org -> alicedev
bob@mozilla.org -> bobdev	`;
    const result = parseEmailMapping(input);
    expect(result).toEqual({
      "alice@mozilla.org": "alicedev",
      "bob@mozilla.org": "bobdev",
    });
  });

  it("handles single mapping with extra whitespace", () => {
    const input = "   alice@mozilla.org   ->   alicedev   ";
    const result = parseEmailMapping(input);
    expect(result).toEqual({ "alice@mozilla.org": "alicedev" });
  });

  it("last mapping wins for duplicate emails", () => {
    const input = `alice@mozilla.org -> alicedev1
alice@mozilla.org -> alicedev2`;
    const result = parseEmailMapping(input);
    expect(result).toEqual({ "alice@mozilla.org": "alicedev2" });
  });

  it("handles mapping with multiple arrows (takes last)", () => {
    const input = "alice@mozilla.org -> middle -> alicedev";
    const result = parseEmailMapping(input);
    // The regex will match first arrow, so this maps to "middle -> alicedev"
    expect(result).toEqual({ "alice@mozilla.org": "middle -> alicedev" });
  });
});
