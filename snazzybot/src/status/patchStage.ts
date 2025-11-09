import { loadPatchContext, type CommitPatch } from "../patch.ts";
import { describeError } from "../utils/errors.ts";
import type { Bug, DebugLog, EnvLike, ProgressHooks } from "./types.ts";

export async function loadPatchContextsForBugs(
  env: EnvLike,
  bugs: Bug[],
  hooks: ProgressHooks,
  options: {
    includePatchContext: boolean;
    debugLog?: DebugLog;
  },
): Promise<Map<number, CommitPatch[]>> {
  const { includePatchContext, debugLog } = options;
  const patchMap = new Map<number, CommitPatch[]>();

  if (!includePatchContext) {
    if (debugLog) debugLog("[patch] patch context disabled via settings");
    return patchMap;
  }

  const seen = new Set<number>();
  const uniqueBugs: Bug[] = [];
  for (const bug of bugs) {
    if (seen.has(bug.id)) continue;
    seen.add(bug.id);
    uniqueBugs.push(bug);
  }

  const total = uniqueBugs.length;
  if (total === 0) {
    if (debugLog) debugLog("[patch] no bugs provided for patch context lookup");
    return patchMap;
  }

  hooks.phase?.("patch-context", { total });
  let completed = 0;

  await Promise.all(
    uniqueBugs.map(async (bug) => {
      try {
        const patches = await loadPatchContext(env, bug.id);
        if (patches.length > 0) {
          patchMap.set(bug.id, patches);
          if (debugLog) {
            const success = patches.filter((patch) => !patch.error).length;
            const failures = patches.length - success;
            debugLog(
              `[patch] bug #${bug.id} patch context loaded (${success}/${patches.length} fetched${
                failures > 0 ? `, ${failures} failed` : ""
              })`,
            );
          }
        } else if (debugLog) {
          debugLog(`[patch] bug #${bug.id} no patch context found`);
        }
      } catch (error) {
        const message = describeError(error);
        hooks.warn?.(`Skipping patch context for #${bug.id}: ${message}`);
        if (debugLog) debugLog(`[patch] bug #${bug.id} error: ${message}`);
      } finally {
        completed++;
        hooks.progress?.("patch-context", completed, total);
      }
    }),
  );

  if (debugLog) {
    debugLog(
      `[patch] collected patch context for ${patchMap.size}/${total} bug(s)`,
    );
  }

  return patchMap;
}
