import { describeError } from "../utils/errors.ts";
import {
  createExpiringMemoryCache,
  DAY_IN_MILLISECONDS,
  DAY_IN_SECONDS,
  getDefaultCache,
} from "../utils/cache.ts";
import type {
  Bug,
  BugHistoryEntry,
  BugHistoryPayload,
  EnvLike,
  ProgressHooks,
  ProductComponent,
} from "./types.ts";

const BUG_FIELDS = [
  "id",
  "summary",
  "product",
  "component",
  "status",
  "resolution",
  "assigned_to",
  "assigned_to_detail",
  "last_change_time",
  "groups",
  "depends_on",
  "blocks",
];

const requestCache = createExpiringMemoryCache<unknown>(DAY_IN_MILLISECONDS);

type BugQueryParams = Record<
  string,
  string | number | string[] | undefined
>;

export class BugzillaClient {
  private readonly host: string;
  private readonly bypass: boolean;

  constructor(private readonly env: EnvLike) {
    this.host = env.BUGZILLA_HOST || "https://bugzilla.mozilla.org";
    this.bypass = !!env.SNAZZY_SKIP_CACHE;
  }

  private makeUrl(path: string, params: BugQueryParams = {}) {
    const url = new URL(`${this.host}/rest${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    url.searchParams.set("api_key", this.env.BUGZILLA_API_KEY);
    return url;
  }

  private async get<T>(path: string, params: BugQueryParams = {}): Promise<T> {
    const url = this.makeUrl(path, params);
    const key = url.toString();

    if (!this.bypass) {
      const cfCache = getDefaultCache();
      if (cfCache) {
        const cached = await cfCache.match(key);
        if (cached) {
          return cached.json() as Promise<T>;
        }
      } else {
        const hit = requestCache.get(key);
        if (hit !== undefined) return hit as T;
      }
    }

    const response = await fetch(key);
    if (!response.ok) {
      throw new Error(`Bugzilla ${response.status}: ${await response.text()}`);
    }
    const json = (await response.json()) as T;

    if (!this.bypass) {
      const cfCache = getDefaultCache();
      if (cfCache) {
        try {
          await cfCache.put(
            key,
            new Response(JSON.stringify(json), {
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": `public, s-maxage=${DAY_IN_SECONDS}, max-age=0, immutable`,
              },
            }),
          );
        } catch (error) {
          console.warn("Failed to cache Bugzilla response", error);
        }
      } else {
        requestCache.set(key, json as unknown);
      }
    }

    return json;
  }

  async fetchMetabugChildren(
    metabugIds: number[],
    hooks: ProgressHooks,
  ): Promise<number[]> {
    if (metabugIds.length === 0) return [];
    hooks.info?.(`Fetching metabugs: ${metabugIds.join(", ")}`);
    const { bugs } = await this.get<{ bugs: Bug[] }>(`/bug`, {
      id: metabugIds.join(","),
      include_fields: "id,depends_on,blocks",
    });
    const ids = new Set<number>();
    for (const bug of bugs) {
      for (const id of bug.depends_on || []) ids.add(id);
      for (const id of bug.blocks || []) ids.add(id);
    }
    return [...ids];
  }

  async fetchBugsByComponents(
    pairs: ProductComponent[],
    sinceISO: string,
  ): Promise<Bug[]> {
    if (pairs.length === 0) return [];
    const results: Bug[] = [];
    for (const pair of pairs) {
      const { bugs } = await this.get<{ bugs: Bug[] }>(`/bug`, {
        product: pair.product,
        component: pair.component,
        status: ["RESOLVED", "VERIFIED", "CLOSED"],
        resolution: "FIXED",
        last_change_time: sinceISO,
        include_fields: BUG_FIELDS.join(","),
      });
      results.push(...bugs);
    }
    return results;
  }

  async fetchBugsByWhiteboards(
    tags: string[],
    sinceISO: string,
    hooks: ProgressHooks,
  ): Promise<Bug[]> {
    if (tags.length === 0) return [];
    const results: Bug[] = [];
    hooks.phase?.("collect-whiteboards", { total: tags.length });
    let cursor = 0;
    for (const tag of tags) {
      hooks.progress?.("collect-whiteboards", ++cursor, tags.length);
      const { bugs } = await this.get<{ bugs: Bug[] }>(`/bug`, {
        status: ["RESOLVED", "VERIFIED", "CLOSED"],
        resolution: "FIXED",
        whiteboard: tag,
        whiteboard_type: "substring",
        last_change_time: sinceISO,
        include_fields: BUG_FIELDS.join(","),
      });
      results.push(...bugs);
    }
    return results;
  }

  async fetchBugsByAssignees(
    assignees: string[],
    sinceISO: string,
  ): Promise<Bug[]> {
    const emails = assignees
      .map((email) => email?.trim())
      .filter(Boolean);
    if (emails.length === 0) return [];
    const { bugs } = await this.get<{ bugs: Bug[] }>(`/bug`, {
      assigned_to: emails,
      status: ["RESOLVED", "VERIFIED", "CLOSED"],
      resolution: "FIXED",
      last_change_time: sinceISO,
      include_fields: BUG_FIELDS.join(","),
    });
    return bugs;
  }

  async fetchBugsByIds(
    ids: number[],
    sinceISO?: string,
    options: { filterResolved?: boolean } = {},
  ): Promise<Bug[]> {
    if (ids.length === 0) return [];
    const { filterResolved = true } = options;
    const chunkSize = 300;
    const results: Bug[] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { bugs } = await this.get<{ bugs: Bug[] }>(`/bug`, {
        id: chunk.join(","),
        include_fields: BUG_FIELDS.join(","),
      });
      results.push(...bugs);
    }
    if (!filterResolved) return results;
    const sinceDate = sinceISO ? new Date(sinceISO) : undefined;
    return results.filter((bug) => {
      const statusOk = ["RESOLVED", "VERIFIED", "CLOSED"].includes(bug.status);
      const resolutionOk = bug.resolution === "FIXED";
      const timeOk = sinceDate
        ? new Date(bug.last_change_time) >= sinceDate
        : true;
      return statusOk && resolutionOk && timeOk;
    });
  }

  async fetchHistories(
    ids: number[],
    hooks: ProgressHooks,
  ): Promise<BugHistoryEntry[]> {
    if (ids.length === 0) return [];
    hooks.phase?.("histories", { total: ids.length });
    hooks.info?.(
      "History mode: per-ID /rest/bug/<id>/history (concurrency=8)",
    );

    const out: BugHistoryEntry[] = [];
    const CONCURRENCY = 8;
    let handled = 0;
    let cursor = 0;

    const worker = async () => {
      while (cursor < ids.length) {
        const index = cursor++;
        const id = ids[index];
        try {
          const payload = await this.get<BugHistoryPayload>(`/bug/${id}/history`);
          if (payload?.bugs?.length) {
            out.push(payload.bugs[0]);
          }
        } catch (error) {
          hooks.warn?.(
            `Skipping history for #${id} (${describeError(error)})`,
          );
        } finally {
          handled++;
          hooks.progress?.("histories", handled, ids.length);
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return out;
  }
}
