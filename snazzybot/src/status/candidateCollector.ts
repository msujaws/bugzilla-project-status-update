import { BugzillaClient } from "./bugzillaClient.ts";
import {
  partitionRestrictedBugs,
  qualifiesBugSnapshot,
} from "./qualification.ts";
import type {
  Bug,
  DebugLog,
  ProductComponent,
  ProgressHooks,
} from "./types.ts";

export type CandidateCollection = {
  union: Bug[];
  candidates: Bug[];
  restricted: Bug[];
  byComponents: Bug[];
  byWhiteboards: Bug[];
  byAssignees: Bug[];
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
    assignees?: string[];
    debugLog?: DebugLog;
  },
): Promise<CandidateCollection> {
  const {
    components = [],
    whiteboards = [],
    metabugs = [],
    assignees = [],
    debugLog,
  } = options;

  const [metabugChildren, byComponents, byWhiteboards, byAssignees] =
    await Promise.all([
      client.fetchMetabugChildren(metabugs, hooks),
      client.fetchBugsByComponents(components, sinceISO),
      client.fetchBugsByWhiteboards(whiteboards, sinceISO, hooks),
      client.fetchBugsByAssignees(assignees, sinceISO),
    ]);

  if (debugLog) {
    debugLog(
      `source counts → metabug children: ${metabugChildren.length}, byComponents: ${byComponents.length}, byWhiteboards: ${byWhiteboards.length}, byAssignees: ${byAssignees.length}`,
      { always: true },
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
    if (byAssignees.length > 0) {
      debugLog(`byAssignees sample IDs: ${sample(byAssignees)}`);
    }
  }

  const byIds = await client.fetchBugsByIds(metabugChildren);
  if (debugLog) {
    debugLog(
      `byIds (filtered) count: ${byIds.length} (from metabug children)`,
      {
        always: true,
      },
    );
  }

  const seen = new Set<number>();
  const union = [
    ...byComponents,
    ...byWhiteboards,
    ...byAssignees,
    ...byIds,
  ].filter((bug) => {
    if (seen.has(bug.id)) return false;
    seen.add(bug.id);
    return true;
  });

  const qualified = union.filter((bug) => qualifiesBugSnapshot(bug, sinceISO));
  const { restricted, unrestricted } = partitionRestrictedBugs(qualified);
  const candidates = unrestricted;

  if (debugLog) {
    const totalBeforeDedupe =
      byComponents.length +
      byWhiteboards.length +
      byAssignees.length +
      byIds.length;
    const deduped = totalBeforeDedupe - union.length;
    debugLog(
      `union candidates after dedupe: ${union.length} (removed ${deduped} overlap)`,
      { always: true },
    );
    debugLog(
      `security-restricted removed: ${restricted.length}${
        restricted.length > 0
          ? ` (sample: ${restricted
              .slice(0, 6)
              .map((bug) => bug.id)
              .join(", ")})`
          : ""
      }`,
      { always: true },
    );
    debugLog(`candidates after security filter: ${candidates.length}`, {
      always: true,
    });
  }

  hooks.info?.(`Bugzilla Candidates: ${candidates.length}`);

  return {
    union,
    candidates,
    restricted,
    byComponents,
    byWhiteboards,
    byAssignees,
    byIds,
    metabugChildren,
  };
}
