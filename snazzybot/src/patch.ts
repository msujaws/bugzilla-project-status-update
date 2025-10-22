import { XMLParser } from "fast-xml-parser";
import type { EnvLike } from "./core.ts";

export type CommitPatch = {
  commitUrl: string;
  message: string;
  patch: string;
  error?: string;
};

type CachePayload = {
  bugId: number;
  patches: CommitPatch[];
};

const ONE_DAY_S = 24 * 60 * 60;
const ONE_DAY_MS = ONE_DAY_S * 1000;
const memCache = new Map<string, { exp: number; data: CachePayload }>();

type GlobalWithCaches = typeof globalThis & { caches?: CacheStorage };

const getDefaultCache = (): Cache | undefined =>
  (globalThis as GlobalWithCaches).caches?.default;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "value",
  trimValues: false,
});

const commitRegex =
  /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/[0-9a-f]{7,40}/gi;

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const normalizeText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const maybe = (value as { value?: unknown; "#text"?: unknown }).value;
    if (typeof maybe === "string") return maybe;
    const legacy = (value as { "#text"?: unknown })["#text"];
    if (typeof legacy === "string") return legacy;
  }
  return "";
};

const normalizeEmail = (value: unknown): string =>
  normalizeText(value).trim().toLowerCase();

const toCacheKey = (host: string, bugId: number): string =>
  `https://${host}/${bugId}.patch`;

const readCache = async (
  key: string,
  bypass: boolean
): Promise<CachePayload | undefined> => {
  if (bypass) return undefined;
  const cfCache = getDefaultCache();
  if (cfCache) {
    try {
      const hit = await cfCache.match(key);
      if (!hit) return undefined;
      const json = (await hit.json()) as CachePayload;
      if (json && typeof json === "object") return json;
    } catch (error) {
      console.warn("Failed to read patch context from cache", error);
    }
    return undefined;
  }
  const entry = memCache.get(key);
  if (entry && entry.exp > Date.now()) return entry.data;
  return undefined;
};

const writeCache = async (
  key: string,
  payload: CachePayload,
  bypass: boolean
) => {
  if (bypass) return;
  const cfCache = getDefaultCache();
  if (cfCache) {
    try {
      await cfCache.put(
        key,
        new Response(JSON.stringify(payload), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": `public, s-maxage=${ONE_DAY_S}, max-age=0, immutable`,
          },
        })
      );
    } catch (error) {
      console.warn("Failed to write patch context to cache", error);
    }
    return;
  }
  memCache.set(key, { exp: Date.now() + ONE_DAY_MS, data: payload });
};

const extractLastPulsebotComment = (parsed: unknown) => {
  const bugzilla =
    (parsed as { bugzilla?: unknown })?.bugzilla ??
    (parsed as { bugs?: unknown })?.bugs;
  const bug =
    (bugzilla as { bug?: unknown })?.bug ??
    (parsed as { bug?: unknown })?.bug ??
    bugzilla;
  if (!bug) return;
  const longDescRaw = (bug as { long_desc?: unknown }).long_desc;
  if (!longDescRaw) return;
  const longDescs = Array.isArray(longDescRaw)
    ? longDescRaw
    : [longDescRaw].filter(Boolean);
  const pulsebot = longDescs.filter(
    (desc) => normalizeEmail((desc as { who?: unknown }).who) === "pulsebot"
  );
  if (pulsebot.length === 0) return;
  return pulsebot.at(-1);
};

const extractCommitUrls = (comment: unknown): string[] => {
  const text = normalizeText((comment as { thetext?: unknown }).thetext);
  if (!text) return [];
  const matches = text.match(commitRegex);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.trim()))];
};

const parsePatchMessage = (patch: string): string => {
  const subjectMatch = patch.match(/^Subject:\s*(?:\[PATCH\]\s*)?(.*)$/im);
  if (subjectMatch && subjectMatch[1]) return subjectMatch[1].trim();
  const firstLine = patch.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.trim();
};

export async function loadPatchContext(
  env: EnvLike,
  bugId: number
): Promise<CommitPatch[]> {
  const host = env.BUGZILLA_HOST || "https://bugzilla.mozilla.org";
  const key = toCacheKey(host, bugId);
  const bypass = !!env.SNAZZY_SKIP_CACHE;

  const cached = await readCache(key, bypass);
  if (cached) return cached.patches;

  const xmlResp = await fetch(
    `${host}/show_bug.cgi?ctype=xml&id=${encodeURIComponent(bugId)}`
  );
  if (!xmlResp.ok) {
    throw new Error(`Bugzilla XML ${xmlResp.status}: ${await xmlResp.text()}`);
  }
  const xml = await xmlResp.text();
  const parsed = parser.parse(xml);

  const comment = extractLastPulsebotComment(parsed);
  if (!comment) {
    const payload = { bugId, patches: [] };
    await writeCache(key, payload, bypass);
    return [];
  }

  const commitUrls = extractCommitUrls(comment);
  if (commitUrls.length === 0) {
    const payload = { bugId, patches: [] };
    await writeCache(key, payload, bypass);
    return [];
  }

  const patches: CommitPatch[] = [];
  for (const baseUrl of commitUrls) {
    let message = `Commit ${baseUrl.split("/").pop() ?? ""}`.trim();
    let patchText = "";
    let error: string | undefined;
    try {
      const patchResp = await fetch(`${baseUrl}.patch`, {
        headers: { accept: "text/x-patch,text/plain;q=0.9" },
      });
      if (patchResp.ok) {
        const body = await patchResp.text();
        if (body) {
          patchText = body;
          message = parsePatchMessage(body);
        } else {
          error = "Patch body empty";
        }
      } else {
        error = `Patch download failed (HTTP ${patchResp.status})`;
      }
    } catch (error_) {
      console.warn(`Failed to fetch patch for ${baseUrl}`, error_);
      error = `Patch download error: ${describeError(error_)}`;
    }
    if (!patchText && !error) {
      error = "Patch unavailable (no response body)";
    }
    patches.push({
      commitUrl: baseUrl,
      message,
      patch: patchText,
      error,
    });
  }

  const payload = { bugId, patches };
  await writeCache(key, payload, bypass);
  return patches;
}
