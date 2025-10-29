import { afterEach, describe, expect, it, vi } from "vitest";

const ORIG_ENV = { ...process.env };
const ORIG_ARGV = [...process.argv];
const ORIG_EXIT_CODE = process.exitCode;

vi.mock("../../src/core.js", () => ({
  generateStatus: vi.fn(async () => ({ output: "OK", ids: [1_987_802] })),
}));

afterEach(async () => {
  process.env = { ...ORIG_ENV };
  process.argv = [...ORIG_ARGV];
  process.exitCode = ORIG_EXIT_CODE;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("CLI weekly-bugzilla-status", () => {
  it("fails when required env is missing", async () => {
    process.env = { ...ORIG_ENV };
    delete process.env.BUGZILLA_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      // no-op: prevent real exit during tests
    }) as unknown as typeof process.exit);

    vi.resetModules();
    await import("../../cli/weekly-bugzilla-status.ts");

    expect(
      spyError.mock.calls.map((call) => call.join(" ")).join("\n"),
    ).toMatch(/missing BUGZILLA_API_KEY or OPENAI_API_KEY/i);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("parses component names that include colons", async () => {
    process.env = { BUGZILLA_API_KEY: "x", OPENAI_API_KEY: "y" };
    const coreModule = (await import(
      "../../src/core.js"
    )) as typeof import("../../src/core.js");
    const { generateStatus } = coreModule;
    const argvBak = process.argv;
    process.argv = ["node", "cli", "--component", "Core:Audio/Video: cubeb"];
    const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../../cli/weekly-bugzilla-status.ts");
    expect(generateStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [{ product: "Core", component: "Audio/Video: cubeb" }],
        includePatchContext: false,
      }),
      expect.any(Object),
      expect.any(Object),
    );
    spyLog.mockRestore();
    process.argv = argvBak;
  });

  it("parses --component product:component and calls generateStatus", async () => {
    process.env = {
      ...ORIG_ENV,
      BUGZILLA_API_KEY: "bz",
      OPENAI_API_KEY: "openai",
    };
    process.argv = [
      "node",
      "cli",
      "--component",
      "Firefox:General",
      "--days",
      "3",
      "--format",
      "md",
    ];

    const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {}); // silence info logs

    const mod = (await import("../../src/core.js")) as {
      generateStatus: ReturnType<typeof vi.fn>;
    };
    const { generateStatus } = mod;

    vi.resetModules();
    await import("../../cli/weekly-bugzilla-status.ts");

    expect(generateStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [{ product: "Firefox", component: "General" }],
        days: 3,
        format: "md",
        includePatchContext: false,
      }),
      expect.objectContaining({
        BUGZILLA_API_KEY: "bz",
        OPENAI_API_KEY: "openai",
      }),
      expect.any(Object),
    );
    expect(spyLog).toHaveBeenCalledWith("OK");
  });

  it("accepts product-only --component strings", async () => {
    process.env = {
      ...ORIG_ENV,
      BUGZILLA_API_KEY: "bz",
      OPENAI_API_KEY: "openai",
    };
    process.argv = ["node", "cli", "--component", "DevTools"];

    const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = (await import("../../src/core.js")) as {
      generateStatus: ReturnType<typeof vi.fn>;
    };
    const { generateStatus } = mod;

    vi.resetModules();
    await import("../../cli/weekly-bugzilla-status.ts");

    expect(generateStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        components: [{ product: "DevTools" }],
        includePatchContext: false,
      }),
      expect.any(Object),
      expect.any(Object),
    );
    expect(spyLog).toHaveBeenCalledWith("OK");
  });

  it("disables patch context when --no-patch-context supplied", async () => {
    process.env = {
      ...ORIG_ENV,
      BUGZILLA_API_KEY: "bz",
      OPENAI_API_KEY: "openai",
    };
    process.argv = ["node", "cli", "--no-patch-context"];

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = (await import("../../src/core.js")) as {
      generateStatus: ReturnType<typeof vi.fn>;
    };
    const { generateStatus } = mod;

    vi.resetModules();
    await import("../../cli/weekly-bugzilla-status.ts");

    expect(generateStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        includePatchContext: false,
      }),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("rejects bad --component strings", async () => {
    process.env = {
      ...ORIG_ENV,
      BUGZILLA_API_KEY: "bz",
      OPENAI_API_KEY: "openai",
    };
    process.argv = ["node", "cli", "--component", ":MissingProduct"];

    const spyErr = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.resetModules();
    await import("../../cli/weekly-bugzilla-status.ts");

    expect(spyErr.mock.calls.map((call) => call.join(" ")).join("\n")).toMatch(
      /Bad --component/i,
    );
    expect(process.exitCode).toBe(1);
  });
});
