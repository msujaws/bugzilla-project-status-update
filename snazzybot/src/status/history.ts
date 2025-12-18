import type { BugHistoryEntry } from "./types.ts";

export function qualifiesByHistoryWhy(
  entry: BugHistoryEntry,
  sinceISO: string,
): { ok: boolean; why?: string; detail?: string } {
  const since = Date.parse(sinceISO);
  if (!entry?.history || entry.history.length === 0) {
    return { ok: false, why: "no history entries" };
  }
  let sawRecent = false;
  for (const history of entry.history) {
    const when = Date.parse(history.when);
    if (when < since) continue;
    sawRecent = true;
    let statusProgress = false;
    let fixed = false;
    let detail: string | undefined;
    const changes = Array.isArray(history.changes) ? history.changes : [];
    for (const change of changes) {
      const field = change.field_name?.toLowerCase();
      if (
        (field === "status" || field === "bug_status") &&
        (change.added === "RESOLVED" ||
          change.added === "VERIFIED" ||
          change.added === "CLOSED")
      ) {
        statusProgress = true;
        detail = `status ${change.added} on ${history.when}`;
      }
      if (field === "resolution" && change.added === "FIXED") {
        fixed = true;
        detail = `resolution FIXED on ${history.when}`;
      }
    }
    if (fixed || statusProgress) {
      return { ok: true, detail };
    }
  }
  if (!sawRecent) return { ok: false, why: "no recent history in window" };
  return {
    ok: false,
    why: "no qualifying transitions (bug_status/resolution)",
  };
}
