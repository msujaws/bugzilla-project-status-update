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
  .option("assignee", {
    type: "string",
    array: true,
    desc: "Bugzilla assignee email(s)",
  })
  .option("days", { type: "number", default: 8 })
  .option("model", { type: "string", default: "gpt-5" })
  .option("format", { choices: ["md", "html"] as const, default: "md" })
  .option("no-cache", {
    type: "boolean",
    default: false,
    desc: "Bypass Bugzilla cache",
  })
  .option("voice", {
    choices: ["normal", "pirate", "snazzy-robot"] as const,
    default: "normal",
  })
  .option("audience", {
    choices: ["technical", "product", "leadership"] as const,
    default: "technical",
    desc: "Tailor summary depth and framing",
  })
  .option("patch-context", {
    type: "boolean",
    default: false,
    desc: "Include GitHub commit patch context (use --no-patch-context to skip)",
  })
  .option("jira-url", {
    type: "string",
    desc: "Jira instance URL (or use JIRA_URL env var)",
  })
  .option("jira-jql", {
    type: "string",
    array: true,
    desc: "JQL query string(s) for Jira issues",
  })
  .option("jira-project", {
    type: "string",
    array: true,
    desc: "Jira project key(s) for filtering issues",
  })
  .help()
  .strict()
  .parseSync();

const BUGZILLA_API_KEY = process.env.BUGZILLA_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const BUGZILLA_HOST = process.env.BUGZILLA_HOST;
const JIRA_URL = argv["jira-url"] || process.env.JIRA_URL;
const JIRA_API_KEY = process.env.JIRA_API_KEY;

if (!BUGZILLA_API_KEY || !OPENAI_API_KEY) {
  console.error("ERROR: missing BUGZILLA_API_KEY or OPENAI_API_KEY");
  process.exit(1);
}

// Validate Jira configuration if Jira options are provided
if (
  (argv["jira-jql"] || argv["jira-project"]) &&
  (!JIRA_URL || !JIRA_API_KEY)
) {
  console.error("ERROR: Jira options require both JIRA_URL and JIRA_API_KEY");
  process.exit(1);
}

const env = {
  BUGZILLA_API_KEY,
  OPENAI_API_KEY,
  ...(BUGZILLA_HOST && { BUGZILLA_HOST }),
  ...(JIRA_URL && { JIRA_URL }),
  ...(JIRA_API_KEY && { JIRA_API_KEY }),
  SNAZZY_SKIP_CACHE: Boolean(argv["no-cache"]),
};

const hooks = {
  info: (m: string) => console.error("[INFO]", m),
  warn: (m: string) => console.error("[WARN]", m),
  phase: (n: string, meta?: Record<string, unknown>) =>
    console.error(`[INFO] Phase: ${n}`, meta ? JSON.stringify(meta) : ""),
  progress: (n: string, cur: number, tot?: number) =>
    console.error(
      `[INFO] ${n}: ${tot ? Math.round((cur / tot) * 100) : 0}% (${cur}/${
        tot ?? "?"
      })`,
    ),
};

async function main() {
  try {
    const components: ProductComponent[] = (argv.component || []).map(
      (s: string) => {
        const trimmed = s.trim();
        if (!trimmed) {
          throw new Error(`Bad --component "${s}"`);
        }
        const colon = trimmed.indexOf(":");
        if (colon === -1) {
          return { product: trimmed };
        }
        const product = trimmed.slice(0, colon).trim();
        const component = trimmed.slice(colon + 1).trim();
        if (!product) {
          throw new Error(`Bad --component "${s}"`);
        }
        if (!component) {
          return { product };
        }
        return { product, component };
      },
    );

    const metabugs = (argv.metabug || [])
      .map((n) => Math.trunc(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0);
    const assignees = (argv.assignee || [])
      .map((email: string) => email.trim())
      .filter((email: string) => email.length > 0);

    const clampedDays = Number.isFinite(argv.days)
      ? Math.max(1, Math.floor(argv.days))
      : 8;
    const { output } = await generateStatus(
      {
        components,
        metabugs,
        whiteboards: argv.whiteboard || [],
        assignees,
        days: clampedDays,
        model: argv.model,
        format: argv.format,
        voice: argv.voice,
        audience: argv.audience,
        includePatchContext: argv["patch-context"],
        jiraJql: argv["jira-jql"] || [],
        jiraProjects: argv["jira-project"] || [],
      },
      env,
      hooks,
    );

    console.log(output);
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";
    console.error("ERROR:", msg || error);
    process.exitCode = 1;
  }
}

await main();
