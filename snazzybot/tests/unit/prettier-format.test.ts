import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, "..", "..", "..");
const BIN_NAME = process.platform === "win32" ? "prettier.cmd" : "prettier";

const candidateBins = [
  path.resolve(REPO_ROOT, "snazzybot", "node_modules", ".bin", BIN_NAME),
  path.resolve(REPO_ROOT, "node_modules", ".bin", BIN_NAME),
];

describe("tooling", () => {
  it("keeps the project formatted with Prettier", () => {
    const prettierBin = candidateBins.find((path) => existsSync(path));
    if (!prettierBin) {
      throw new Error(
        "Prettier binary not found. Run `npm install` at the repo root or inside snazzybot/.",
      );
    }

    const { error, status, stdout, stderr } = spawnSync(
      prettierBin,
      [
        "--check",
        "./**/*.{css,html,js,jsx,json,mjs,cjs,ts,tsx,md}",
        "--ignore-path",
        ".gitignore",
      ],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: "pipe",
      },
    );

    if (error) {
      throw error;
    }

    const output = `${stdout}${stderr}`.trim();
    expect(status, output).toBe(0);
  });
});
