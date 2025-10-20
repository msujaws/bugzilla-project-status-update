#!/usr/bin/env ts-node
/**
 * Weekly Bugzilla status CLI entry point.
 *
 * Reads configuration from CLI flags, enforces required env vars, and prints
 * the generated report to stdout. Example usage from the `snazzybot` directory:
 *
 *   npm run cli -- --whiteboard "[fx-vpn]" --days 3 --format md
 *
 * Required environment:
 *   BUGZILLA_API_KEY - REST API key for Bugzilla.
 *   OPENAI_API_KEY   - API key for generating summaries.
 *
 * See README for additional options.
 */
// cli/weekly-bugzilla-status.ts
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { generateStatus, ProductComponent } from "../src/core.js";

const argv = yargs(hideBin(process.argv))
  .option("component", { type: "string", array: true })
  .option("metabug", { type: "number", array: true })
  .option("whiteboard", { type: "string", array: true })
  .option("days", { type: "number", default: 8 })
  .option("model", { type: "string", default: "gpt-5" })
  .option("format", { choices: ["md", "html"] as const, default: "md" })
  .option("debug", { type: "boolean", default: false })
  .option("no-cache", {
    type: "boolean",
    default: false,
    desc: "Bypass Bugzilla cache",
  })
  .option("voice", {
    choices: ["normal", "pirate", "snazzy-robot"] as const,
    default: "normal",
  })
  .help()
  .strict()
  .parseSync();

const BUGZILLA_API_KEY = process.env.BUGZILLA_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const BUGZILLA_HOST = process.env.BUGZILLA_HOST;
if (!BUGZILLA_API_KEY || !OPENAI_API_KEY) {
  console.error("ERROR: missing BUGZILLA_API_KEY or OPENAI_API_KEY");
  process.exit(1);
}

const env = BUGZILLA_HOST
  ? {
      BUGZILLA_API_KEY,
      OPENAI_API_KEY,
      BUGZILLA_HOST,
      SNAZZY_SKIP_CACHE: Boolean(argv["no-cache"]),
    }
  : {
      BUGZILLA_API_KEY,
      OPENAI_API_KEY,
      SNAZZY_SKIP_CACHE: Boolean(argv["no-cache"]),
    };

const hooks = {
  info: (m: string) => console.error("[INFO]", m),
  warn: (m: string) => console.error("[WARN]", m),
  phase: (n: string, meta?: any) =>
    console.error(`[INFO] Phase: ${n}`, meta ? JSON.stringify(meta) : ""),
  progress: (n: string, cur: number, tot?: number) =>
    console.error(
      `[INFO] ${n}: ${tot ? Math.round((cur / tot) * 100) : 0}% (${cur}/${
        tot ?? "?"
      })`
    ),
};

(async () => {
  try {
    const components: ProductComponent[] = (argv.component || []).map(
      (s: string) => {
        const [product, component] = s.split(":").map((x) => x.trim());
        if (!product || !component) {
          throw new Error(`Bad --component "${s}"`);
        }
        return { product, component };
      }
    );

    const metabugs = (argv.metabug || [])
      .map((n) => Math.trunc(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0);

    const clampedDays = Number.isFinite(argv.days)
      ? Math.max(1, Math.floor(argv.days))
      : 8;
    const { output } = await generateStatus(
      {
        components,
        metabugs,
        whiteboards: argv.whiteboard || [],
        days: clampedDays,
        model: argv.model,
        format: argv.format,
        debug: argv.debug,
        voice: argv.voice,
      },
      env,
      hooks
    );

    console.log(output);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : typeof err === "string" ? err : "";
    console.error("ERROR:", msg || err);
    process.exitCode = 1;
  }
})();
