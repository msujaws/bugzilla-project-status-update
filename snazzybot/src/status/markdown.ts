import { marked } from "marked";

const SAFE_PROTOCOL =
  /^(?:https?:\/\/|mailto:|\/(?!\/)|\.\.?\/|#|data:image\/(png|gif|jpg|jpeg|webp);base64,)/i;

export const escapeHtml = (text: string | null | undefined): string => {
  const source =
    typeof text === "string" ? text : text == undefined ? "" : String(text);
  return source.replaceAll(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": {
        return "&amp;";
      }
      case "<": {
        return "&lt;";
      }
      case ">": {
        return "&gt;";
      }
      case '"': {
        return "&quot;";
      }
      case "'": {
        return "&#39;";
      }
      default: {
        return ch;
      }
    }
  });
};

export const sanitizeHref = (href: string | null | undefined): string => {
  if (typeof href !== "string") return "#";
  const trimmed = href.trim();
  if (SAFE_PROTOCOL.test(trimmed)) {
    return trimmed;
  }
  return "#";
};

const renderer = new marked.Renderer();

renderer.link = function link(token) {
  const safeHref = sanitizeHref(token?.href);
  const titleAttr = token?.title ? ` title="${escapeHtml(token.title)}"` : "";
  const extra =
    safeHref.startsWith("http://") || safeHref.startsWith("https://")
      ? ' target="_blank" rel="noopener noreferrer"'
      : "";
  const label = Array.isArray(token?.tokens)
    ? this.parser.parseInline(token.tokens)
    : escapeHtml(token?.text ?? "");
  return `<a href="${escapeHtml(safeHref)}"${titleAttr}${extra}>${label}</a>`;
};

renderer.image = function image(token) {
  const safeHref = sanitizeHref(token?.href);
  const titleAttr = token?.title ? ` title="${escapeHtml(token.title)}"` : "";
  const altText =
    token?.text ?? (token?.tokens?.length ? token.tokens[0].raw : "");
  const alt = altText ? ` alt="${escapeHtml(altText)}"` : ' alt=""';
  return `<img src="${escapeHtml(safeHref)}"${titleAttr}${alt} />`;
};

renderer.html = (token) =>
  escapeHtml(
    typeof token === "string"
      ? token
      : (token?.text ?? token?.raw ?? token?.body ?? undefined),
  );

marked.use({
  renderer,
  gfm: true,
  mangle: false,
  headerIds: false,
});

marked.setOptions({
  // ensure synchronous parsing so callers get a string back
  async: false,
});

export const markdownToHtml = (markdown: string | null | undefined): string =>
  marked.parse(markdown ?? "") as string;
