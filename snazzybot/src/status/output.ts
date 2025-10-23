import type { ProductComponent } from "./types.ts";

export function buildBuglistURL(args: {
  sinceISO: string;
  whiteboards?: string[];
  ids?: number[];
  components?: ProductComponent[];
  host?: string;
}) {
  const host = args.host || "https://bugzilla.mozilla.org";
  const url = new URL(`${host}/buglist.cgi`);
  url.searchParams.set("bug_status", "RESOLVED,VERIFIED,CLOSED");
  url.searchParams.set("resolution", "FIXED");
  url.searchParams.set("chfieldfrom", args.sinceISO);
  url.searchParams.set("chfieldto", "Now");
  if (args.ids?.length) url.searchParams.set("bug_id", args.ids.join(","));
  if (args.components?.length) {
    for (const pc of args.components) {
      url.searchParams.append("product", pc.product);
      url.searchParams.append("component", pc.component);
    }
  }
  if (args.whiteboards?.length) {
    let idx = 1;
    url.searchParams.set(`f${idx}`, "OP");
    url.searchParams.set(`j${idx}`, "OR");
    idx++;
    for (const tag of args.whiteboards) {
      url.searchParams.set(`f${idx}`, "status_whiteboard");
      url.searchParams.set(`o${idx}`, "substring");
      url.searchParams.set(`v${idx}`, tag);
      idx++;
    }
    url.searchParams.set(`f${idx}`, "CP");
  }
  return url.toString();
}
