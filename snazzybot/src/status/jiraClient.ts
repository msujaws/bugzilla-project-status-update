import { describeError } from "../utils/errors.ts";
import {
  createExpiringMemoryCache,
  DAY_IN_MILLISECONDS,
  DAY_IN_SECONDS,
  getDefaultCache,
} from "../utils/cache.ts";
import { SUB_OPERATION_PHASES } from "./phases.ts";
import type { EnvLike, ProgressHooks } from "./types.ts";
import type {
  JiraIssue,
  JiraIssueHistory,
  JiraRawSearchResponse,
  JiraRawIssue,
  JiraRawChangelogResponse,
} from "./jiraTypes.ts";

const JIRA_FIELDS = [
  "key",
  "summary",
  "status",
  "resolution",
  "resolutiondate",
  "updated",
  "project",
  "components",
  "assignee",
  "labels",
  "security",
];

const requestCache = createExpiringMemoryCache<unknown>(DAY_IN_MILLISECONDS);

export class JiraClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly bypass: boolean;

  constructor(private readonly env: EnvLike) {
    if (!env.JIRA_URL) {
      throw new Error("JIRA_URL environment variable is required");
    }
    if (!env.JIRA_API_KEY) {
      throw new Error("JIRA_API_KEY environment variable is required");
    }
    this.baseUrl = env.JIRA_URL.replace(/\/$/, "");
    this.apiKey = env.JIRA_API_KEY;
    this.bypass = !!env.SNAZZY_SKIP_CACHE;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    if (!this.bypass) {
      const cfCache = getDefaultCache();
      if (cfCache) {
        const cached = await cfCache.match(url);
        if (cached) {
          return cached.json() as Promise<T>;
        }
      } else {
        const hit = requestCache.get(url);
        if (hit !== undefined) return hit as T;
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira ${response.status}: ${errorText}`);
    }

    const json = (await response.json()) as T;

    if (!this.bypass) {
      const cfCache = getDefaultCache();
      if (cfCache) {
        try {
          await cfCache.put(
            url,
            new Response(JSON.stringify(json), {
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": `public, s-maxage=${DAY_IN_SECONDS}, max-age=0, immutable`,
              },
            }),
          );
        } catch (error) {
          console.warn("Failed to cache Jira response", error);
        }
      } else {
        requestCache.set(url, json as unknown);
      }
    }

    return json;
  }

  private normalizeIssue(raw: JiraRawIssue): JiraIssue {
    const component =
      raw.fields.components && raw.fields.components.length > 0
        ? raw.fields.components[0].name
        : undefined;

    return {
      key: raw.key,
      id: raw.id,
      summary: raw.fields.summary,
      project: raw.fields.project.key,
      projectName: raw.fields.project.name,
      component,
      status: raw.fields.status.name,
      statusCategory: raw.fields.status.statusCategory.key,
      resolution: raw.fields.resolution?.name,
      assignee: raw.fields.assignee?.accountId,
      assigneeDisplayName: raw.fields.assignee?.displayName,
      assigneeEmail: raw.fields.assignee?.emailAddress,
      updated: raw.fields.updated,
      resolutionDate: raw.fields.resolutiondate || undefined,
      labels: raw.fields.labels || [],
      isSecure: !!raw.fields.security,
    };
  }

  /**
   * Execute a JQL query with pagination support
   */
  async searchByJQL(jql: string, hooks?: ProgressHooks): Promise<JiraIssue[]> {
    const allIssues: JiraIssue[] = [];
    let startAt = 0;
    const maxResults = 100;
    let total = 0;

    hooks?.info?.(`Executing JQL: ${jql}`);

    do {
      const encodedJQL = encodeURIComponent(jql);
      const encodedFields = encodeURIComponent(JIRA_FIELDS.join(","));
      const path = `/rest/api/3/search?jql=${encodedJQL}&startAt=${startAt}&maxResults=${maxResults}&fields=${encodedFields}`;

      const response = await this.get<JiraRawSearchResponse>(path);
      total = response.total;

      for (const rawIssue of response.issues) {
        const issue = this.normalizeIssue(rawIssue);
        allIssues.push(issue);
      }

      startAt += response.issues.length;

      if (response.issues.length < maxResults) {
        break;
      }
    } while (startAt < total);

    hooks?.info?.(`Found ${allIssues.length} issues`);
    return allIssues;
  }

  /**
   * Generate JQL for a project with time window and status filters
   */
  generateProjectJQL(project: string, sinceDays: number): string {
    return `project = ${project} AND statusCategory = Done AND updated >= -${sinceDays}d`;
  }

  /**
   * Fetch issues by project names with parallel execution
   */
  async fetchIssuesByProjects(
    projects: string[],
    sinceDays: number,
    hooks: ProgressHooks,
  ): Promise<JiraIssue[]> {
    if (projects.length === 0) return [];

    const results: JiraIssue[] = [];
    const CONCURRENCY = 8;
    let cursor = 0;

    const worker = async () => {
      while (cursor < projects.length) {
        const index = cursor++;
        const project = projects[index];
        const jql = this.generateProjectJQL(project, sinceDays);
        const issues = await this.searchByJQL(jql, hooks);
        results.push(...issues);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return results;
  }

  /**
   * Fetch issues by explicit JQL queries with parallel execution
   */
  async fetchIssuesByJQL(
    jqlQueries: string[],
    hooks: ProgressHooks,
  ): Promise<JiraIssue[]> {
    if (jqlQueries.length === 0) return [];

    const results: JiraIssue[] = [];
    const CONCURRENCY = 8;
    let cursor = 0;

    const worker = async () => {
      while (cursor < jqlQueries.length) {
        const index = cursor++;
        const jql = jqlQueries[index];
        const issues = await this.searchByJQL(jql, hooks);
        results.push(...issues);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return results;
  }

  /**
   * Fetch issues by their keys
   */
  async fetchIssuesByKeys(keys: string[]): Promise<JiraIssue[]> {
    if (keys.length === 0) return [];

    const chunkSize = 100;
    const results: JiraIssue[] = [];

    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      const jql = `key IN (${chunk.join(",")})`;
      const encodedJQL = encodeURIComponent(jql);
      const encodedFields = encodeURIComponent(JIRA_FIELDS.join(","));
      const path = `/rest/api/3/search?jql=${encodedJQL}&maxResults=${chunkSize}&fields=${encodedFields}`;

      const response = await this.get<JiraRawSearchResponse>(path);
      for (const rawIssue of response.issues) {
        const issue = this.normalizeIssue(rawIssue);
        results.push(issue);
      }
    }

    return results;
  }

  /**
   * Fetch changelog/history for multiple issues with concurrency control
   */
  async fetchChangelogs(
    keys: string[],
    hooks: ProgressHooks,
  ): Promise<JiraIssueHistory[]> {
    if (keys.length === 0) return [];

    hooks.phase?.(SUB_OPERATION_PHASES.HISTORIES, { total: keys.length });
    hooks.info?.(
      "History mode: per-issue /rest/api/3/issue/<key>/changelog (concurrency=8)",
    );

    const out: JiraIssueHistory[] = [];
    const CONCURRENCY = 8;
    let handled = 0;
    let cursor = 0;

    const worker = async () => {
      while (cursor < keys.length) {
        const index = cursor++;
        const key = keys[index];
        try {
          const history = await this.fetchSingleChangelog(key);
          out.push(history);
        } catch (error) {
          hooks.warn?.(
            `Skipping changelog for ${key} (${describeError(error)})`,
          );
        } finally {
          handled++;
          hooks.progress?.(
            SUB_OPERATION_PHASES.HISTORIES,
            handled,
            keys.length,
          );
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return out;
  }

  /**
   * Fetch changelog for a single issue with pagination
   */
  private async fetchSingleChangelog(key: string): Promise<JiraIssueHistory> {
    const allHistories: JiraRawChangelogResponse["histories"] = [];
    let startAt = 0;
    const maxResults = 100;
    let total = 0;

    do {
      const path = `/rest/api/3/issue/${key}/changelog?startAt=${startAt}&maxResults=${maxResults}`;
      const response = await this.get<JiraRawChangelogResponse>(path);
      total = response.total;

      if (response.histories) {
        allHistories.push(...response.histories);
      }

      startAt += maxResults;

      if (!response.histories || response.histories.length < maxResults) {
        break;
      }
    } while (startAt < total);

    return {
      key,
      id: key, // Using key as id since we don't have numeric ID in this context
      changelog: (allHistories || []).map((h) => ({
        id: h.id,
        created: h.created,
        items: (h.items || []).map((item) => ({
          field: item.field,
          fieldtype: item.fieldtype,
          from: item.from,
          fromString: item.fromString,
          to: item.to,
          toString: item.toString,
        })),
      })),
    };
  }
}
