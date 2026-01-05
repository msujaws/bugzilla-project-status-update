import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BugzillaClient } from "../src/status/bugzillaClient.ts";
import { collectCandidates } from "../src/status/candidateCollector.ts";
import { isoDaysAgo } from "../src/utils/time.ts";
import { formatSummaryOutput } from "../src/status/recipeHelpers.ts";
import { buildBuglistURL } from "../src/status/output.ts";
import type { Bug, ProductComponent } from "../src/status/types.ts";

type ScenarioFixture = {
  name: string;
  kind: "paged";
  recordedAt: string;
  requestBody: Record<string, unknown>;
  responses: {
    discover: Record<string, unknown>;
    pages: Array<{
      request: { cursor: number; pageSize: number };
      response: Record<string, unknown>;
    }>;
    finalize: Record<string, unknown>;
  };
  meta: Record<string, unknown>;
};

type CandidatePick = {
  valid: Bug[];
  extras: Bug[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../tests/e2e/fixtures/status");

const DEFAULT_REQUEST = {
  format: "md",
  voice: "normal",
  audience: "technical",
  skipCache: false,
  includePatchContext: false,
};

const nameOf = (bug: Bug) =>
  bug.assigned_to_detail?.real_name ||
  bug.assigned_to_detail?.nick ||
  bug.assigned_to_detail?.name ||
  bug.assigned_to ||
  "unassigned";

const minifyCandidate = (bug: Bug) => ({
  id: bug.id,
  last_change_time: bug.last_change_time,
  product: bug.product,
  component: bug.component,
});

const summarizeBug = (bug: Bug) => ({
  id: bug.id,
  summary: bug.summary,
  assignee: nameOf(bug),
  product: bug.product,
  component: bug.component,
  last_change_time: bug.last_change_time,
});

const normalizeAssignee = (bug: Bug) =>
  nameOf(bug).replaceAll(/["']/g, "").replaceAll(/\s+/g, " ").trim();

function pickValidPair(candidates: Bug[]): CandidatePick {
  const byAssignee = new Map<string, Bug[]>();
  for (const bug of candidates) {
    const key = normalizeAssignee(bug);
    if (!key || /^nobody/i.test(key)) continue;
    const bucket = byAssignee.get(key) ?? [];
    bucket.push(bug);
    byAssignee.set(key, bucket);
  }
  const pair = [...byAssignee.values()].find((bucket) => bucket.length >= 2);
  if (!pair) {
    throw new Error(
      "Unable to find at least two DevTools bugs by the same author",
    );
  }
  const valid = pair.slice(0, 2);
  const remaining = candidates.filter(
    (bug) => !valid.some((v) => v.id === bug.id),
  );
  if (remaining.length < 2) {
    throw new Error("Need at least two extra DevTools bugs for invalid cases");
  }
  return { valid, extras: remaining.slice(0, 2) };
}

function pickFxVpnTrio(candidates: Bug[]): Bug[] {
  const seen = new Set<number>();
  const result: Bug[] = [];
  const byAssignee = new Map<string, Bug[]>();
  for (const bug of candidates) {
    const key = normalizeAssignee(bug) || `unknown-${bug.id}`;
    const bucket = byAssignee.get(key) ?? [];
    bucket.push(bug);
    byAssignee.set(key, bucket);
  }
  const pair = [...byAssignee.values()].find((bucket) => bucket.length >= 2);
  if (!pair) {
    throw new Error("Expected at least two [fx-vpn] bugs by the same author");
  }
  for (const bug of pair.slice(0, 2)) {
    if (!seen.has(bug.id)) {
      seen.add(bug.id);
      result.push(bug);
    }
  }
  const differentAuthor = candidates.find((bug) => {
    const key = normalizeAssignee(bug);
    return !result.some((b) => normalizeAssignee(b) === key);
  });
  if (!differentAuthor) {
    throw new Error("Unable to find third [fx-vpn] bug by a different author");
  }
  result.push(differentAuthor);
  return result;
}

async function ensureDir() {
  await fs.mkdir(fixturesDir, { recursive: true });
}

function buildLink(options: {
  sinceISO: string;
  components?: ProductComponent[];
  whiteboards?: string[];
  ids?: number[];
}) {
  return buildBuglistURL({
    sinceISO: options.sinceISO,
    components: options.components,
    whiteboards: options.whiteboards,
    ids: options.ids,
  });
}

type DevToolsSample = {
  days: number;
  sinceISO: string;
  valid: Bug[];
  security: Bug;
  confidential: Bug;
  recordedAt: string;
};

async function collectDevToolsSample(
  client: BugzillaClient,
): Promise<DevToolsSample> {
  const days = 21;
  const sinceISO = isoDaysAgo(days);
  const collection = await collectCandidates(client, {}, sinceISO, {
    components: [{ product: "DevTools" }],
  });
  if (collection.candidates.length < 4) {
    throw new Error("DevTools fixture requires at least four candidates");
  }
  const { valid, extras } = pickValidPair(collection.candidates);
  const recordedAt = new Date().toISOString();
  return {
    days,
    sinceISO,
    valid,
    security: extras[0],
    confidential: extras[1],
    recordedAt,
  };
}

function buildDevToolsPagedFixture(sample: DevToolsSample) {
  const { days, sinceISO, valid, security, confidential, recordedAt } = sample;
  const summaryLines = [
    "## DevTools — Highlighted fixes",
    "",
    `- Bug ${valid[0].id}: ${valid[0].summary} (Owner: ${nameOf(valid[0])})`,
    `- Bug ${valid[1].id}: ${valid[1].summary} (Owner: ${nameOf(valid[1])})`,
    "",
    `_Fixture note:_ Both fixes landed within the ${days}-day window and were authored by ${nameOf(valid[0])}.`,
    "",
    `Security-restricted candidate omitted: Bug ${security.id} (${security.summary}).`,
    `Confidential candidate omitted: Bug ${confidential.id} (${confidential.summary}).`,
    "",
    `_OpenAI fixture response generated for automated testing on ${recordedAt.slice(
      0,
      10,
    )}._`,
  ].join("\n");
  const link = buildLink({
    sinceISO,
    components: [{ product: "DevTools" }],
    ids: valid.map((bug) => bug.id),
  });
  const { markdown, html } = formatSummaryOutput({
    summaryMd: summaryLines,
    demo: [],
    trimmedCount: 0,
    link,
  });

  const requestBody = {
    ...DEFAULT_REQUEST,
    components: [{ product: "DevTools" }],
    metabugs: [],
    whiteboards: [],
    assignees: [],
    days,
    model: "gpt-5",
  };

  const meta = {
    sinceISO,
    days,
    valid: valid.map((bug) => summarizeBug(bug)),
    invalid: [
      { reason: "security", ...summarizeBug(security) },
      { reason: "confidential", ...summarizeBug(confidential) },
    ],
    recordedAt,
  };

  return {
    name: "devtools-two-valid",
    kind: "paged" as const,
    recordedAt,
    requestBody,
    responses: {
      discover: {
        sinceISO,
        total: valid.length,
        logs: [
          {
            kind: "info",
            msg: `Window: last ${days} days (since ${sinceISO})`,
          },
          {
            kind: "info",
            msg: "Components: DevTools",
          },
          {
            kind: "info",
            msg: `Bugzilla Candidates: ${valid.length}`,
          },
          {
            kind: "info",
            msg: `[debug] security-restricted removed: 1 (sample: ${security.id})`,
          },
          {
            kind: "info",
            msg: `[debug] candidates after security filter: ${valid.length}`,
          },
        ],
        candidates: valid.map((bug) => minifyCandidate(bug)),
      },
      pages: [
        {
          request: { cursor: 0, pageSize: 35 },
          response: {
            qualifiedIds: valid.map((bug) => bug.id),
            total: valid.length,
            logs: [
              {
                kind: "info",
                msg: `[debug] page qualified=${valid.length} (cursor 0→${valid.length}/${valid.length})`,
              },
            ],
          },
        },
      ],
      finalize: {
        output: markdown,
        html,
      },
    },
    meta,
  };
}

function buildDevToolsPatchFixture(sample: DevToolsSample) {
  const { days, sinceISO, valid, recordedAt } = sample;
  const summaryMd = [
    "## DevTools — Patch-context candidates",
    "",
    `- Bug ${valid[0].id}: ${valid[0].summary} (Owner: ${nameOf(valid[0])})`,
    `- Bug ${valid[1].id}: ${valid[1].summary} (Owner: ${nameOf(valid[1])})`,
    "",
    `_Fixture note:_ This run forces patch-context collection before summarizing the same two DevTools fixes.`,
    "",
    `_OpenAI fixture response generated for automated UI tests on ${recordedAt.slice(
      0,
      10,
    )}._`,
  ].join("\n");
  const link = buildLink({
    sinceISO,
    components: [{ product: "DevTools" }],
    ids: valid.map((bug) => bug.id),
  });
  const { markdown, html } = formatSummaryOutput({
    summaryMd,
    demo: [],
    trimmedCount: 0,
    link,
  });

  return {
    name: "devtools-patch-context",
    kind: "paged" as const,
    recordedAt,
    requestBody: {
      ...DEFAULT_REQUEST,
      components: [{ product: "DevTools" }],
      metabugs: [],
      whiteboards: [],
      assignees: [],
      days,
      includePatchContext: true,
      model: "gpt-5",
    },
    responses: {
      discover: {
        sinceISO,
        total: valid.length,
        candidates: valid.map((bug) => minifyCandidate(bug)),
      },
      pages: [
        {
          request: { cursor: 0, pageSize: 35 },
          response: {
            qualifiedIds: valid.map((bug) => bug.id),
            total: valid.length,
          },
        },
      ],
      finalize: {
        output: markdown,
        html,
      },
    },
    meta: {
      sinceISO,
      days,
      recordedAt,
      qualifiedIds: valid.map((bug) => bug.id),
    },
  };
}

async function gatherDevToolsEmptyFixture(client: BugzillaClient) {
  const days = 7;
  const sinceISO = isoDaysAgo(days);
  const requestBody = {
    ...DEFAULT_REQUEST,
    components: [{ product: "DevTools", component: "Imaginary Component" }],
    metabugs: [],
    whiteboards: [],
    assignees: [],
    days,
    model: "gpt-5",
  };
  const collection = await collectCandidates(client, {}, sinceISO, {
    components: [{ product: "DevTools", component: "Imaginary Component" }],
  });
  const recordedAt = new Date().toISOString();
  const summaryMd = `_No user-impacting DevTools changes detected in the last ${days} days._`;
  const link = buildLink({
    sinceISO,
    components: [{ product: "DevTools" }],
    ids: [],
  });
  const { markdown, html } = formatSummaryOutput({
    summaryMd,
    demo: [],
    trimmedCount: 0,
    link,
  });

  return {
    name: "devtools-empty",
    kind: "paged" as const,
    recordedAt,
    requestBody,
    responses: {
      discover: {
        sinceISO,
        total: collection.candidates.length,
        logs: [
          {
            kind: "info",
            msg: `Window: last ${days} days (since ${sinceISO})`,
          },
          {
            kind: "info",
            msg: "Components: DevTools:Imaginary Component",
          },
          {
            kind: "info",
            msg: `Bugzilla Candidates: ${collection.candidates.length}`,
          },
        ],
        candidates: collection.candidates.map((bug) => minifyCandidate(bug)),
      },
      pages: [],
      finalize: {
        output: markdown,
        html,
      },
    },
    meta: {
      sinceISO,
      days,
      recordedAt,
    },
  };
}

async function gatherFxVpnFixture(client: BugzillaClient) {
  const days = 30;
  const whiteboards = ["[fx-vpn]"];
  const sinceISO = isoDaysAgo(days);
  const requestBody = {
    ...DEFAULT_REQUEST,
    components: [],
    whiteboards,
    metabugs: [],
    assignees: [],
    days,
    model: "gpt-5",
  };
  const collection = await collectCandidates(client, {}, sinceISO, {
    whiteboards,
  });
  if (collection.candidates.length < 3) {
    throw new Error("Expected at least three [fx-vpn] candidates");
  }
  const bugs = pickFxVpnTrio(collection.candidates);
  const recordedAt = new Date().toISOString();

  const summaryMd = [
    "## [fx-vpn] deployment-ready fixes",
    "",
    `- Bug ${bugs[0].id}: ${bugs[0].summary} (Owner: ${nameOf(bugs[0])})`,
    `- Bug ${bugs[1].id}: ${bugs[1].summary} (Owner: ${nameOf(bugs[1])})`,
    `- Bug ${bugs[2].id}: ${bugs[2].summary} (Owner: ${nameOf(bugs[2])})`,
    "",
    `_Fixture note:_ Bugs ${bugs[0].id} and ${bugs[1].id} share the same owner, while bug ${bugs[2].id} documents work from a different engineer.`,
    "",
    `_OpenAI fixture summary generated for automated UI tests on ${recordedAt.slice(
      0,
      10,
    )}._`,
  ].join("\n");
  const link = buildLink({
    sinceISO,
    whiteboards,
    ids: bugs.map((bug) => bug.id),
  });
  const { markdown, html } = formatSummaryOutput({
    summaryMd,
    demo: [],
    trimmedCount: 0,
    link,
  });

  const discoverCandidates = collection.candidates
    .filter((bug) => bugs.some((b) => b.id === bug.id))
    .map((bug) => minifyCandidate(bug));

  return {
    name: "fx-vpn-trio",
    kind: "paged" as const,
    recordedAt,
    requestBody,
    responses: {
      discover: {
        sinceISO,
        total: discoverCandidates.length,
        logs: [
          {
            kind: "info",
            msg: `Window: last ${days} days (since ${sinceISO})`,
          },
          {
            kind: "info",
            msg: `Whiteboard filters: ${whiteboards.join(", ")}`,
          },
          {
            kind: "info",
            msg: `Bugzilla Candidates: ${discoverCandidates.length}`,
          },
        ],
        candidates: discoverCandidates,
      },
      pages: [
        {
          request: { cursor: 0, pageSize: 35 },
          response: {
            qualifiedIds: bugs.map((bug) => bug.id),
            total: discoverCandidates.length,
          },
        },
      ],
      finalize: {
        output: markdown,
        html,
      },
    },
    meta: {
      sinceISO,
      days,
      recordedAt,
      bugs: bugs.map((bug) => summarizeBug(bug)),
    },
  };
}

async function writeFixture(fixture: ScenarioFixture) {
  const target = path.join(fixturesDir, `${fixture.name}.json`);
  await fs.writeFile(
    target,
    JSON.stringify(fixture, undefined, 2) + "\n",
    "utf8",
  );
  console.log(`Wrote ${target}`);
}

async function main() {
  const BUGZILLA_API_KEY = process.env.BUGZILLA_API_KEY;
  if (!BUGZILLA_API_KEY) {
    throw new Error("BUGZILLA_API_KEY missing in environment");
  }
  const env = {
    BUGZILLA_API_KEY,
    BUGZILLA_HOST: process.env.BUGZILLA_HOST,
  };
  const client = new BugzillaClient(env);
  await ensureDir();
  const devtoolsSample = await collectDevToolsSample(client);
  const fixtures: ScenarioFixture[] = [
    buildDevToolsPagedFixture(devtoolsSample),
    buildDevToolsPatchFixture(devtoolsSample),
    await gatherDevToolsEmptyFixture(client),
    await gatherFxVpnFixture(client),
  ];
  for (const fixture of fixtures) {
    await writeFixture(fixture);
  }
}

await main();
