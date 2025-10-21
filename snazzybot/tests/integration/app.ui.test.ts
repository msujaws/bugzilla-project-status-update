import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { server } from "../utils/msw/node";
import { http, HttpResponse } from "msw";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(dirname, "../../public/index.html");
const appJsPath = path.join(dirname, "../../public/app.js");

let dom: JSDOM;
type ClipboardStub = {
  writeText: (text: string) => Promise<void>;
  write: (items: unknown[]) => Promise<void>;
};
type MutableGlobal = typeof globalThis & Record<string, unknown>;
const testGlobal = globalThis as MutableGlobal;
type MatchMediaStub = (query: string) => {
  matches: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};
const fallbackMatchMedia: MatchMediaStub = () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
});

beforeEach(() => {
  const html = fs.readFileSync(htmlPath, "utf8");
  dom = new JSDOM(html, {
    url: "https://local.test/",
    pretendToBeVisual: true,
  });

  const { window } = dom;
  // Minimal stubs so the app code can run without browser APIs
  window.matchMedia = window.matchMedia ?? fallbackMatchMedia;
  window.requestAnimationFrame = (cb: (time: number) => void) =>
    setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id: number) => clearTimeout(id);
  window.HTMLCanvasElement.prototype.getContext = () => {};
  testGlobal.matchMedia = window.matchMedia;

  testGlobal.window = window;
  testGlobal.document = window.document;
  const clipboardStub: ClipboardStub = {
    writeText: vi.fn(async () => {}),
    write: vi.fn(async () => {}),
  };
  testGlobal.navigator = {
    clipboard: {
      writeText: clipboardStub.writeText,
      write: clipboardStub.write,
    },
  };
  delete testGlobal.ClipboardItem;
  testGlobal.history = window.history;
  testGlobal.location = window.location;
  testGlobal.Blob = window.Blob;
  testGlobal.URL = window.URL;

  server.use(
    http.post("https://local.test/api/status", async ({ request }) => {
      const body = await request.json();
      const mode = body.mode || "discover";
      if (mode === "discover") {
        return HttpResponse.json({
          total: 1,
          candidates: [
            {
              id: 1_987_802,
              last_change_time: "2025-10-21T09:36:11Z",
              product: "Firefox",
              component: "IP Protection",
            },
          ],
        });
      }
      if (mode === "page") {
        return HttpResponse.json({
          qualifiedIds: [1_987_802],
          nextCursor: undefined,
          total: 1,
        });
      }
      if (mode === "finalize" || mode === "oneshot") {
        return HttpResponse.json({
          output: "Hello\n\n[View bugs in Bugzilla](https://x)",
        });
      }
      return HttpResponse.json({ output: "Unexpected mode" });
    }),
  );
});

afterEach(() => {
  dom.window.close();
  delete testGlobal.window;
  delete testGlobal.document;
  delete testGlobal.navigator;
  delete testGlobal.matchMedia;
  delete testGlobal.history;
  delete testGlobal.location;
  delete testGlobal.Blob;
  delete testGlobal.URL;
});

describe("public/app.js UI", () => {
  it("renders returned Markdown into iframe and enables actions", async () => {
    await import(appJsPath);

    const runBtn = dom.window.document.querySelector<HTMLButtonElement>("#run");
    expect(runBtn).toBeTruthy();
    runBtn?.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const copyBtn =
      dom.window.document.querySelector<HTMLButtonElement>("#copy");
    expect(copyBtn?.disabled).toBe(false);

    const frame =
      dom.window.document.querySelector<HTMLIFrameElement>("#resultFrame");
    expect(frame?.srcdoc).toContain("View bugs in Bugzilla");
  });
});
