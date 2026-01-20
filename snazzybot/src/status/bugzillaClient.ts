import { describeError } from "../utils/errors.ts";
import { DAY_IN_SECONDS, getDefaultCache } from "../utils/cache.ts";
import { SUB_OPERATION_PHASES } from "./phases.ts";
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

type BugQueryParams = Record<string, string | number | string[] | undefined>;

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
    // API key is sent via header, not URL params, to avoid exposure in logs/caches
    return url;
  }

  private async get<T>(path: string, params: BugQueryParams = {}): Promise<T> {
    const url = this.makeUrl(path, params);
    // Use URL without API key as cache key to avoid credential exposure
    const cacheKey = url.toString();
    const cfCache = this.bypass ? undefined : getDefaultCache();

    if (cfCache) {
      const cached = await cfCache.match(cacheKey);
      if (cached) {
        return cached.json() as Promise<T>;
      }
    }

    // Send API key via header instead of URL to prevent exposure in logs/caches
    const response = await fetch(url.toString(), {
      headers: {
        "X-BUGZILLA-API-KEY": this.env.BUGZILLA_API_KEY,
      },
    });
    if (!response.ok) {
      throw new Error(`Bugzilla ${response.status}: ${await response.text()}`);
    }
    const json = (await response.json()) as T;

    if (cfCache) {
      try {
        await cfCache.put(
          cacheKey,
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
    const productOnly = new Set<string>();
    for (const pair of pairs) {
      const product = pair.product?.trim();
      const component = pair.component?.trim();
      if (product && !component) {
        productOnly.add(product);
      }
    }
    const seen = new Set<string>();
    for (const pair of pairs) {
      const product = pair.product?.trim();
      const component = pair.component?.trim();
      if (!product) continue;
      if (component && productOnly.has(product)) continue;
      const key = `${product}:::${component ?? "*"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { bugs } = await this.get<{ bugs: Bug[] }>(`/bug`, {
        product,
        component: component || undefined,
        status: ["RESOLVED", "VERIFIED", "CLOSED"],
        resolution: "FIXED",
        chfield: "resolution",
        chfieldfrom: sinceISO,
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
    hooks.phase?.(SUB_OPERATION_PHASES.COLLECT_WHITEBOARDS, {
      total: tags.length,
    });
    let cursor = 0;
    for (const tag of tags) {
      hooks.progress?.(
        SUB_OPERATION_PHASES.COLLECT_WHITEBOARDS,
        ++cursor,
        tags.length,
      );
      const { bugs } = await this.get<{ bugs: Bug[] }>(`/bug`, {
        status: ["RESOLVED", "VERIFIED", "CLOSED"],
        resolution: "FIXED",
        whiteboard: tag,
        whiteboard_type: "substring",
        chfield: "resolution",
        chfieldfrom: sinceISO,
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
    const emails = assignees.map((email) => email?.trim()).filter(Boolean);
    if (emails.length === 0) return [];
    const { bugs } = await this.get<{ bugs: Bug[] }>(`/bug`, {
      assigned_to: emails,
      status: ["RESOLVED", "VERIFIED", "CLOSED"],
      resolution: "FIXED",
      chfield: "resolution",
      chfieldfrom: sinceISO,
      include_fields: BUG_FIELDS.join(","),
    });
    return bugs;
  }

  async fetchBugsByIds(ids: number[]): Promise<Bug[]> {
    if (ids.length === 0) return [];
    const chunkSize = 300;
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }

    const results: Bug[] = [];
    const CONCURRENCY = 8;
    let cursor = 0;

    const worker = async () => {
      while (cursor < chunks.length) {
        const index = cursor++;
        const chunk = chunks[index];
        const { bugs } = await this.get<{ bugs: Bug[] }>(`/bug`, {
          id: chunk.join(","),
          include_fields: BUG_FIELDS.join(","),
        });
        results.push(...bugs);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return results;
  }

  async fetchHistories(
    ids: number[],
    hooks: ProgressHooks,
  ): Promise<BugHistoryEntry[]> {
    if (ids.length === 0) return [];
    hooks.phase?.(SUB_OPERATION_PHASES.HISTORIES, { total: ids.length });
    hooks.info?.("History mode: per-ID /rest/bug/<id>/history (concurrency=8)");

    const out: BugHistoryEntry[] = [];
    const CONCURRENCY = 8;
    let handled = 0;
    let cursor = 0;

    const worker = async () => {
      while (cursor < ids.length) {
        const index = cursor++;
        const id = ids[index];
        try {
          const payload = await this.get<BugHistoryPayload>(
            `/bug/${id}/history`,
          );
          if (payload?.bugs?.length) {
            out.push(payload.bugs[0]);
          }
        } catch (error) {
          hooks.warn?.(`Skipping history for #${id} (${describeError(error)})`);
        } finally {
          handled++;
          hooks.progress?.(SUB_OPERATION_PHASES.HISTORIES, handled, ids.length);
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return out;
  }
}
