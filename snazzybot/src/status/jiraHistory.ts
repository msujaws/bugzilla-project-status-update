import type { JiraIssueHistory } from "./jiraTypes.ts";

/**
 * Check if a Jira issue qualifies based on its changelog history.
 * An issue qualifies if it had a status transition to a "Done" status
 * category within the time window.
 */
export function qualifiesByJiraHistory(
  history: JiraIssueHistory,
  sinceISO: string,
): boolean {
  const since = Date.parse(sinceISO);

  for (const change of history.changelog || []) {
    const when = Date.parse(change.created);
    if (when < since) continue;

    // Check if any item in this changelog entry is a status change to "Done"
    for (const item of change.items || []) {
      if (item.field.toLowerCase() === "status") {
        // Check if the status change was to a "Done" status
        // We look for transitions TO resolved/done states
        const toStatus = item.toString?.toLowerCase() || "";
        if (
          toStatus.includes("done") ||
          toStatus.includes("resolved") ||
          toStatus.includes("closed") ||
          toStatus.includes("complete")
        ) {
          return true;
        }
      }

      // Also check statusCategory field which is more reliable
      if (item.field.toLowerCase() === "statuscategory") {
        const toCategory = item.toString?.toLowerCase() || "";
        if (toCategory === "done" || toCategory === "complete") {
          return true;
        }
      }

      // Check resolution field
      if (item.field.toLowerCase() === "resolution") {
        const toResolution = item.toString?.toLowerCase() || "";
        // Any transition TO a resolution (from null/empty) indicates completion
        if (
          toResolution &&
          toResolution !== "unresolved" &&
          item.fromString === null
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if a Jira issue qualifies and provide detailed reasoning.
 * Useful for debugging and logging.
 */
export function qualifiesByJiraHistoryWhy(
  history: JiraIssueHistory,
  sinceISO: string,
): { ok: boolean; why?: string; detail?: string } {
  const since = Date.parse(sinceISO);

  if (!history?.changelog || history.changelog.length === 0) {
    return { ok: false, why: "no changelog entries" };
  }

  let sawRecent = false;

  for (const change of history.changelog) {
    const when = Date.parse(change.created);
    if (when < since) continue;

    sawRecent = true;

    for (const item of change.items || []) {
      const field = item.field.toLowerCase();
      const toString = item.toString?.toLowerCase() || "";
      const fromString = item.fromString?.toLowerCase() || "";

      if (
        field === "status" &&
        (toString.includes("done") ||
          toString.includes("resolved") ||
          toString.includes("closed") ||
          toString.includes("complete"))
      ) {
        return {
          ok: true,
          detail: `status → ${item.toString} on ${change.created}`,
        };
      }

      if (
        field === "statuscategory" &&
        (toString === "done" || toString === "complete")
      ) {
        return {
          ok: true,
          detail: `statusCategory → ${item.toString} on ${change.created}`,
        };
      }

      if (
        field === "resolution" &&
        toString &&
        toString !== "unresolved" &&
        (!fromString || fromString === "null")
      ) {
        return {
          ok: true,
          detail: `resolution → ${item.toString} on ${change.created}`,
        };
      }
    }
  }

  if (!sawRecent) {
    return { ok: false, why: "no recent changelog in window" };
  }

  return {
    ok: false,
    why: "no qualifying transitions (status/statusCategory/resolution)",
  };
}
