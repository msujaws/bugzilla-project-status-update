import { describe, expect, it } from "vitest";
import { cleanBugzillaUsername } from "../../src/status/summarizer.ts";

describe("cleanBugzillaUsername", () => {
  it("removes parenthetical phrases like (please needinfo? me)", () => {
    expect(cleanBugzillaUsername("John Doe (please needinfo? me)")).toBe(
      "John Doe",
    );
    expect(
      cleanBugzillaUsername("Jane Smith (needinfo me if you need anything)"),
    ).toBe("Jane Smith");
  });

  it("removes IRC-style nicknames like [:username]", () => {
    expect(cleanBugzillaUsername("John Doe [:jaws]")).toBe("John Doe");
    expect(cleanBugzillaUsername("Jane Smith [:jsmith]")).toBe("Jane Smith");
  });

  it("removes IRC-style nicknames without colon like [username]", () => {
    expect(cleanBugzillaUsername("John Doe [jaws]")).toBe("John Doe");
    expect(cleanBugzillaUsername("Jane Smith [jsmith]")).toBe("Jane Smith");
  });

  it("converts Nobody to Unassigned", () => {
    expect(cleanBugzillaUsername("Nobody; OK to take it and work on it")).toBe(
      "Unassigned",
    );
    expect(cleanBugzillaUsername("nobody")).toBe("Unassigned");
    expect(cleanBugzillaUsername("Nobody")).toBe("Unassigned");
  });

  it("handles combinations of patterns", () => {
    expect(
      cleanBugzillaUsername("John Doe [:jdoe] (please needinfo? me)"),
    ).toBe("John Doe");
  });

  it("returns undefined for undefined input", () => {
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(cleanBugzillaUsername(undefined)).toBeUndefined();
  });

  it("handles empty strings", () => {
    expect(cleanBugzillaUsername("")).toBeUndefined();
    expect(cleanBugzillaUsername("   ")).toBeUndefined();
  });

  it("leaves clean names unchanged", () => {
    expect(cleanBugzillaUsername("John Doe")).toBe("John Doe");
    expect(cleanBugzillaUsername("Jane Smith")).toBe("Jane Smith");
  });

  it("handles names with legitimate parentheses in the middle", () => {
    expect(cleanBugzillaUsername("John (Johnny) Doe")).toBe(
      "John (Johnny) Doe",
    );
  });

  it("removes trailing whitespace after cleanup", () => {
    expect(cleanBugzillaUsername("John Doe   [:jdoe]  ")).toBe("John Doe");
  });
});
