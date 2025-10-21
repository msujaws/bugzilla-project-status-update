import { describe, it, expect } from "vitest";
import { isRestricted } from "../../src/core.js";

describe("isRestricted", () => {
  it("returns true for security or confidential groups", () => {
    expect(isRestricted(["core-security"])).toBe(true);
    expect(isRestricted(["mozilla-employee-confidential"])).toBe(true);
  });

  it("returns false for public or unrelated groups", () => {
    expect(isRestricted([])).toBe(false);
    expect(isRestricted(["firefox-backlog"])).toBe(false);
  });
});
