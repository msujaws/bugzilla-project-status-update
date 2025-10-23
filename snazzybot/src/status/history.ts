import type { BugHistoryEntry } from "./types.ts";

export function qualifiesByHistory(
  entry: BugHistoryEntry,
  sinceISO: string,
): boolean {
  const since = Date.parse(sinceISO);
  for (const history of entry.history || []) {
    const when = Date.parse(history.when);
    if (when < since) continue;
    let statusProgress = false;
    let fixed = false;
    for (const change of history.changes) {
      const field = change.field_name?.toLowerCase();
      if (
        (field === "status" || field === "bug_status") &&
        (change.added === "RESOLVED" ||
          change.added === "VERIFIED" ||
          change.added === "CLOSED")
      ) {
        statusProgress = true;
      }
      if (field === "resolution" && change.added === "FIXED") {
        fixed = true;
      }
    }
    if (fixed || statusProgress) return true;
  }
  return false;
}

export function qualifiesByHistoryWhy(
  entry: BugHistoryEntry,
  sinceISO: string,
): { ok: boolean; why?: string } {
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
    for (const change of history.changes) {
      const field = change.field_name?.toLowerCase();
      if (
        (field === "status" || field === "bug_status") &&
        (change.added === "RESOLVED" ||
          change.added === "VERIFIED" ||
          change.added === "CLOSED")
      ) {
        statusProgress = true;
      }
      if (field === "resolution" && change.added === "FIXED") {
        fixed = true;
      }
    }
    if (fixed || statusProgress) {
      return { ok: true };
    }
  }
  if (!sawRecent) return { ok: false, why: "no recent history in window" };
  return { ok: false, why: "no qualifying transitions (bug_status/resolution)" };
}
