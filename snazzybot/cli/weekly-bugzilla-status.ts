#!/usr/bin/env ts-node
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
  .help()
  .strict()
  .parseSync();

const BUGZILLA_API_KEY = process.env.BUGZILLA_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
if (!BUGZILLA_API_KEY || !OPENAI_API_KEY) {
  console.error("ERROR: missing BUGZILLA_API_KEY or OPENAI_API_KEY");
  process.exit(1);
}

const components: ProductComponent[] = (argv.component || []).map(
  (s: string) => {
    const [product, component] = s.split(":").map((x) => x.trim());
    if (!product || !component) throw new Error(`Bad --component "${s}"`);
    return { product, component };
  }
);

const env = { BUGZILLA_API_KEY, OPENAI_API_KEY };

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
  const { output } = await generateStatus(
    {
      components,
      metabugs: argv.metabug || [],
      whiteboards: argv.whiteboard || [],
      days: argv.days,
      model: argv.model,
      format: argv.format,
      debug: argv.debug,
    },
    env,
    hooks
  );

  console.log(output);
})();
