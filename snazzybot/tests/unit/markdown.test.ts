import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  sanitizeHref,
  applyInlineMarkdown,
  markdownToHtml,
} from "../../public/lib/markdown.js";

describe("markdown helpers", () => {
  it("escapes HTML entities", () => {
    expect(escapeHtml("<b>& \" ' >")).toBe("&lt;b&gt;&amp; &quot; &#39; &gt;");
  });

  it("sanitizes href to safe targets", () => {
    expect(sanitizeHref("https://ok.test/x")).toBe("https://ok.test/x");
    expect(sanitizeHref("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(sanitizeHref("javascript:alert(1)")).toBe("#"); // unsafe
  });

  it("protects code before italic/bold parsing", () => {
    const md = "Use `a_b` and **bold _ok_**";
    const html = applyInlineMarkdown(md);
    expect(html).toMatchInlineSnapshot(
      '"Use <code>a_b</code> and <strong>bold <em>ok</em></strong>"',
    );
  });

  it("renders simple doc to HTML (headers, lists)", () => {
    const src = "# T\n\n- A\n- B\n1. X\n2. Y";
    expect(markdownToHtml(src)).toMatchSnapshot();
  });

  it("leaves underscores inside links intact", () => {
    const src =
      "Check [hello_world](https://x.test?bug_id=12345&field_name=foo)";
    const html = applyInlineMarkdown(src);
    expect(html).toContain("hello_world");
    expect(html).toContain('href="https://x.test?bug_id=12345&field_name=foo"');
  });
});
