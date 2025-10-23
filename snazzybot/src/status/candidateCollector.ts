import { BugzillaClient } from "./bugzillaClient.ts";
import { isRestricted } from "./rules.ts";
import type {
  Bug,
  ProductComponent,
  ProgressHooks,
} from "./types.ts";

export type CandidateCollection = {
  union: Bug[];
  candidates: Bug[];
  restricted: Bug[];
  byComponents: Bug[];
  byWhiteboards: Bug[];
  byIds: Bug[];
  metabugChildren: number[];
};

export async function collectCandidates(
  client: BugzillaClient,
  hooks: ProgressHooks,
  sinceISO: string,
  options: {
    components?: ProductComponent[];
    whiteboards?: string[];
    metabugs?: number[];
    debugLog?: (message: string) => void;
  },
): Promise<CandidateCollection> {
  const { components = [], whiteboards = [], metabugs = [], debugLog } =
    options;

  const [metabugChildren, byComponents, byWhiteboards] = await Promise.all([
    client.fetchMetabugChildren(metabugs, hooks),
    client.fetchBugsByComponents(components, sinceISO),
    client.fetchBugsByWhiteboards(whiteboards, sinceISO, hooks),
  ]);

  if (debugLog) {
    debugLog(
      `source counts → metabug children: ${metabugChildren.length}, byComponents: ${byComponents.length}, byWhiteboards: ${byWhiteboards.length}`,
    );
    const sample = (arr: Bug[], n = 8) =>
      arr
        .slice(0, n)
        .map((bug) => bug.id)
        .join(", ");
    if (byComponents.length > 0) {
      debugLog(`byComponents sample IDs: ${sample(byComponents)}`);
    }
    if (byWhiteboards.length > 0) {
      debugLog(`byWhiteboards sample IDs: ${sample(byWhiteboards)}`);
    }
  }

  const byIds = await client.fetchBugsByIds(metabugChildren, sinceISO);
  if (debugLog) {
    debugLog(
      `byIds (filtered) count: ${byIds.length} (from metabug children)`,
    );
  }

  const seen = new Set<number>();
  const union = [...byComponents, ...byWhiteboards, ...byIds].filter((bug) => {
    if (seen.has(bug.id)) return false;
    seen.add(bug.id);
    return true;
  });

  const restricted = union.filter((bug) => isRestricted(bug.groups));
  const candidates = union.filter((bug) => !isRestricted(bug.groups));

  if (debugLog) {
    debugLog(`union candidates: ${union.length}`);
    debugLog(
      `security-restricted removed: ${restricted.length}${
        restricted.length > 0
          ? ` (sample: ${restricted
              .slice(0, 6)
              .map((bug) => bug.id)
              .join(", ")})`
          : ""
      }`,
    );
    debugLog(`candidates after security filter: ${candidates.length}`);
  }

  hooks.info?.(`Candidates after initial query: ${candidates.length}`);

  return {
    union,
    candidates,
    restricted,
    byComponents,
    byWhiteboards,
    byIds,
    metabugChildren,
  };
}
