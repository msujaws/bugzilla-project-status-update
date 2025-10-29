import type { ProductComponent } from "./types.ts";

export function buildBuglistURL(args: {
  sinceISO: string;
  whiteboards?: string[];
  assignees?: string[];
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
    const productOnly = new Set<string>();
    for (const pc of args.components) {
      const product = pc.product?.trim();
      const component = pc.component?.trim();
      if (product && !component) {
        productOnly.add(product);
      }
    }
    for (const product of productOnly) {
      url.searchParams.append("product", product);
    }
    for (const pc of args.components) {
      const product = pc.product?.trim();
      const component = pc.component?.trim();
      if (!product || !component) continue;
      if (productOnly.has(product)) continue;
      url.searchParams.append("product", product);
      url.searchParams.append("component", component);
    }
  }
  let filterIndex = 1;
  const openGroup = (join: "OR" | "AND" = "OR") => {
    url.searchParams.set(`f${filterIndex}`, "OP");
    url.searchParams.set(`j${filterIndex}`, join);
    filterIndex++;
  };
  const closeGroup = () => {
    url.searchParams.set(`f${filterIndex}`, "CP");
    filterIndex++;
  };
  if (args.assignees?.length) {
    openGroup("OR");
    for (const email of args.assignees) {
      url.searchParams.set(`f${filterIndex}`, "assigned_to");
      url.searchParams.set(`o${filterIndex}`, "equals");
      url.searchParams.set(`v${filterIndex}`, email);
      filterIndex++;
    }
    closeGroup();
  }
  if (args.whiteboards?.length) {
    openGroup("OR");
    for (const tag of args.whiteboards) {
      url.searchParams.set(`f${filterIndex}`, "status_whiteboard");
      url.searchParams.set(`o${filterIndex}`, "substring");
      url.searchParams.set(`v${filterIndex}`, tag);
      filterIndex++;
    }
    closeGroup();
  }
  return url.toString();
}
