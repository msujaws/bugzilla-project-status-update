import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  markdownToHtml,
  sanitizeHref,
} from "../../src/status/markdown.ts";

describe("markdown helpers", () => {
  it("escapes HTML entities", () => {
    expect(escapeHtml("<b>& \" ' >")).toBe("&lt;b&gt;&amp; &quot; &#39; &gt;");
  });

  it("sanitizes href to safe targets", () => {
    expect(sanitizeHref("https://ok.test/x")).toBe("https://ok.test/x");
    expect(sanitizeHref("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(sanitizeHref("javascript:alert(1)")).toBe("#");
  });

  it("renders markdown with headings and lists", () => {
    const src = "# T\n\n- A\n- B\n1. X\n2. Y";
    expect(markdownToHtml(src)).toMatchInlineSnapshot(`
"<h1>T</h1>
<ul>
<li>A</li>
<li>B</li>
</ul>
<ol>
<li>X</li>
<li>Y</li>
</ol>
"
`);
  });

  it("escapes inline HTML content", () => {
    const html = markdownToHtml("Danger <script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("adds target attributes to links", () => {
    const html = markdownToHtml(
      "See [Bugzilla](https://bugzilla.mozilla.org/show_bug.cgi?id=123)",
    );
    expect(html).toContain(
      '<a href="https://bugzilla.mozilla.org/show_bug.cgi?id=123" target="_blank" rel="noopener noreferrer">',
    );
  });
});
