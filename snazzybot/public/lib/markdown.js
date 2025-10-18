const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const BOLD_PATTERN = /(\*\*|__)(.+?)\1/g;
const ITALIC_PATTERN = /(\*|_)([^*_]+?)\1/g;
const ORDERED_PATTERN = /^\d+\.\s+/;

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

export function sanitizeHref(href) {
  const trimmed = href.trim();
  if (
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    /^mailto:/i.test(trimmed)
  ) {
    return trimmed;
  }
  return "#";
}

function restoreCodeSnippets(target, snippets) {
  let result = target;
  snippets.forEach((snippet, idx) => {
    const token = `@@CODE${idx}@@`;
    result = result.replaceAll(token, snippet);
  });
  return result;
}

export function applyInlineMarkdown(text) {
  if (!text) return "";

  const codeSnippets = [];
  const withoutCode = text.replace(/`([^`]+)`/g, (_match, code) => {
    const token = `@@CODE${codeSnippets.length}@@`;
    codeSnippets.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  const segments = [];
  let lastIndex = 0;
  for (const match of withoutCode.matchAll(LINK_PATTERN)) {
    const [raw, label, href] = match;
    if (typeof match.index === "number") {
      segments.push(escapeHtml(withoutCode.slice(lastIndex, match.index)));
      segments.push(
        `<a href="${sanitizeHref(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          label
        )}</a>`
      );
      lastIndex = match.index + raw.length;
    }
  }
  segments.push(escapeHtml(withoutCode.slice(lastIndex)));

  let formatted = segments.join("");
  formatted = formatted.replace(BOLD_PATTERN, "<strong>$2</strong>");
  formatted = formatted.replace(ITALIC_PATTERN, "<em>$2</em>");
  formatted = restoreCodeSnippets(formatted, codeSnippets);

  return formatted;
}

export function markdownToHtml(md) {
  const lines = (md || "").split(/\r?\n/);
  const out = [];
  let paragraph = [];
  let listType = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${applyInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  const closeList = () => {
    if (listType) {
      out.push(listType === "ol" ? "</ol>" : "</ul>");
      listType = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }

    if (line.startsWith("### ")) {
      flushParagraph();
      closeList();
      out.push(`<h3>${applyInlineMarkdown(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      closeList();
      out.push(`<h2>${applyInlineMarkdown(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      flushParagraph();
      closeList();
      out.push(`<h1>${applyInlineMarkdown(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      const content = line.slice(2).trim();
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${applyInlineMarkdown(content)}</li>`);
      continue;
    }

    if (ORDERED_PATTERN.test(line)) {
      flushParagraph();
      const content = line.replace(ORDERED_PATTERN, "").trim();
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${applyInlineMarkdown(content)}</li>`);
      continue;
    }

    if (listType) closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();

  return out.join("\n");
}
