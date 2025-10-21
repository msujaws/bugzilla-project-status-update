import { markdownToHtml } from "./lib/markdown.js";

const $ = (id) => document.getElementById(id);

// ===== Emoji Confetti Engine (no deps) =====
const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

function burstEmojis(mode = "normal") {
  if (reduceMotion) return; // respect reduced motion preference
  const canvas = document.getElementById("fx-layer");
  if (!canvas) return;

  const sets = {
    normal: ["🎉", "✨", "🎊", "⭐️"],
    pirate: ["🏴‍☠️", "☠️", "🦜", "⚓️"],
    "snazzy-robot": ["🤖", "✨", "🛠️", "🔧"],
  };
  const EMOJI = sets[mode] || sets.normal;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let W;
  let H;
  let DPR;

  const resize = () => {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  };

  resize();
  window.addEventListener("resize", resize, { once: true });

  const N = 80;
  const lifeMs = 5000;
  const start = performance.now();
  const parts = Array.from({ length: N }, () => {
    const x = Math.random() * W;
    const y = -20 - Math.random() * 40;
    const speed = 2 + Math.random() * 3;
    const angle = (Math.random() * Math.PI) / 3 + Math.PI / 6;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1),
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.2,
      size: 18 + Math.random() * 10,
      emoji: EMOJI[(Math.random() * EMOJI.length) | 0],
      t0: start,
    };
  });

  const step = (now) => {
    const t = now - start;
    if (t > lifeMs + 400) {
      ctx.clearRect(0, 0, W, H);
      return;
    }

    ctx.clearRect(0, 0, W, H);
    const fade = 1 - Math.min(1, t / lifeMs);
    ctx.globalAlpha = Math.max(0, fade);

    for (const p of parts) {
      p.vy += 0.03;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.font = `${p.size}px system-ui, Apple Color Emoji, Segoe UI Emoji`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.emoji, 0, 0);
      ctx.restore();
    }
    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

// Phase UI ------------------------------------------------------------------
function ensurePhase(name, label) {
  let host = document.querySelector(`[data-phase="${name}"]`);
  if (!host) {
    host = document.createElement("div");
    host.dataset.phase = name;
    const title = document.createElement("div");
    title.className = "phase-title";
    title.id = `title-${name}`;
    title.textContent = label || name;
    const bar = document.createElement("div");
    bar.className = "progress";
    const fill = document.createElement("div");
    fill.className = "bar";
    fill.id = `bar-${name}`;
    bar.appendChild(fill);
    host.appendChild(title);
    host.appendChild(bar);
    const phases = $("phases");
    if (phases) phases.appendChild(host);
  }
  return host;
}

function setPhaseText(name, txt) {
  const t = $(`title-${name}`);
  if (t) t.textContent = txt;
}

function setPhasePct(name, current, total) {
  const bar = $(`bar-${name}`);
  if (!bar || !total) return;
  bar.classList.remove("indeterminate");
  const pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  bar.style.width = `${pct}%`;
}

function setPhaseIndeterminate(name) {
  const bar = $(`bar-${name}`);
  if (bar) {
    bar.classList.add("indeterminate");
    bar.style.width = "";
  }
}

function completePhase(name) {
  const bar = $(`bar-${name}`);
  if (bar) {
    bar.classList.remove("indeterminate");
    bar.style.width = "100%";
  }
}

// Logging -------------------------------------------------------------------
function log(kind, msg) {
  const line = document.createElement("div");
  line.className = `line ${kind}`;
  line.textContent =
    (kind === "warn" ? "⚠️ " : "") +
    (kind === "error" ? "❌ " : "") +
    (kind === "info" ? "ℹ️ " : "") +
    msg;
  const logHost = $("log");
  if (!logHost) return;
  logHost.appendChild(line);
  logHost.scrollTop = logHost.scrollHeight;
}

// Utilities -----------------------------------------------------------------
function parseLines(t) {
  return t
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function setActionsEnabled(enabled) {
  ["copy", "copy-rendered", "dl-md", "dl-html"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !enabled;
  });
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setResultIframe(html) {
  const frame = $("resultFrame");
  if (!frame) return;
  const doc = `<!doctype html><html><head>
  <meta charset="utf-8" />
  <style>
    body{font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,Arial;padding:16px;color:rgb(170,176,214);}
    a{color:#0f62fe}
    h1,h2,h3{margin:0.6em 0 0.35em}
    ul{margin:0.4em 0 0.6em 1.2em}
    p{margin:0.6em 0;}
    code{background:#f2f4f8;padding:2px 5px;border-radius:6px}
  </style>
</head><body>${html}</body></html>`;
  frame.srcdoc = doc;

  const onload = () => {
    try {
      const h = frame.contentDocument.documentElement.scrollHeight;
      frame.style.height = `${Math.min(Math.max(h + 2, 240), 1200)}px`;
    } catch (err) {
      console.error(err);
    }
  };
  frame.onload = onload;
  setTimeout(onload, 50);
}

// State for copy buttons ----------------------------------------------------
let lastMarkdown = "";
let lastHTML = "";
let currentVoice = "normal";

// Helpers shared by both runners -------------------------------------------
function resetUIBeforeRun() {
  const out = $("out");
  if (out) {
    out.textContent = "";
    out.style.display = "none";
  }
  const logHost = $("log");
  if (logHost) logHost.textContent = "";
  const phases = $("phases");
  if (phases) phases.innerHTML = "";
  const quickStatus = $("quick-status");
  if (quickStatus) quickStatus.style.display = "none";
  setResultIframe("<em>Waiting for results…</em>");
}

// Streaming runner (NDJSON) -------------------------------------------------
async function runSnazzyStream(body) {
  const runBtn = $("run");
  const spin = $("spin");
  if (!runBtn || !spin) return;

  runBtn.disabled = true;
  setActionsEnabled(false);
  spin.style.display = "inline-flex";
  spin.textContent = "⏳ Starting…";
  resetUIBeforeRun();

  try {
    const res = await fetch("/api/status", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // tell the Worker to use the streaming branch
        "accept": "application/x-ndjson",
        "x-snazzy-stream": "1",
      },
      body: JSON.stringify({
        ...body,
        // no mode needed for streaming; the server does oneshot with hooks
      }),
    });
    if (!res.ok || !res.body) {
      const data = await res.text().catch(() => "");
      throw new Error(data || res.statusText || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const flushLine = (line) => {
      if (!line.trim()) return;
      let evt;
      try { evt = JSON.parse(line); } catch { return; }
      switch (evt.kind) {
        case "start":
          spin.textContent = "⏳ Discovering…";
          break;
        case "info":
          log("info", evt.msg || "");
          break;
        case "warn":
          log("warn", evt.msg || "");
          break;
        case "phase": {
          const name = String(evt.name || "phase");
          ensurePhase(name, name);
          if (typeof evt.total === "number") {
            setPhasePct(name, 0, evt.total || 1);
          } else {
            setPhaseIndeterminate(name);
          }
          break;
        }
        case "progress": {
          const name = String(evt.phase || "phase");
          if (typeof evt.total === "number") {
            setPhasePct(name, Number(evt.current) || 0, Number(evt.total) || 1);
          } else {
            setPhaseIndeterminate(name);
          }
          break;
        }
        case "done": {
          lastMarkdown = (evt.output || "").trim();
          lastHTML = markdownToHtml(lastMarkdown);
          setResultIframe(lastHTML);
          setActionsEnabled(Boolean(lastMarkdown));
          spin.style.display = "none";
          burstEmojis(currentVoice);
          break;
        }
        case "error":
          throw new Error(evt.msg || "Server error");
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        flushLine(line);
      }
    }
    // flush any remaining partial (in case the stream ended without newline)
    if (buf) flushLine(buf);
  } catch (err) {
    console.error(err);
    const out = $("out");
    if (out) {
      out.style.display = "block";
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "";
      out.textContent = `ERROR: ${message || "Unknown error"}`;
    }
    setActionsEnabled(Boolean(lastMarkdown));
    $("spin")?.style && ( $("spin").style.display = "none" );
  } finally {
    const runBtn = $("run");
    if (runBtn) runBtn.disabled = false;
  }
}

// Existing paged runner (kept as fallback) ----------------------------------
async function runSnazzyPaged(body) {
  const runBtn = $("run");
  const spin = $("spin");
  if (!runBtn || !spin) return;

  runBtn.disabled = true;
  setActionsEnabled(false);
  spin.style.display = "inline-flex";
  spin.textContent = "⏳ Starting…";

  resetUIBeforeRun();

  const callJSON = async (payload) => {
    const res = await fetch("/api/status", {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
    }
    return res.json();
  };

  try {
    // 1) Discover all candidates (counts & compact metadata)
    spin.style.display = "inline-flex";
    spin.textContent = "⏳ Discovering…";
    const discover = await callJSON({ ...body, mode: "discover" });
    const total = discover.total || 0;
    log("info", `Candidates: ${total}`);

    // 2) Page through histories
    const qualified = new Set();
    let cursor = 0;
    const step = Math.min(35, Math.max(20, Math.ceil(40))); // default ~35 per page
    ensurePhase("histories", "histories");
    while (cursor != null && cursor < total) {
      spin.textContent = `⏳ Histories ${cursor + 1}-${Math.min(cursor + step, total)} of ${total}`;
      setPhaseText("histories", `histories: ${cursor + 1}-${Math.min(cursor + step, total)} of ${total}`);
      setPhasePct("histories", Math.min(cursor + step, total), total);
      const page = await callJSON({ ...body, mode: "page", cursor, pageSize: step });
      (page.qualifiedIds || []).forEach((id) => qualified.add(id));
      cursor = page.nextCursor;
    }
    completePhase("histories");
    log("info", `Qualified (history): ${qualified.size}`);

    // 3) Finalize (OpenAI + output)
    spin.textContent = "⏳ Summarizing…";
    ensurePhase("openai", "openai");
    setPhaseIndeterminate("openai");
    const final = await callJSON({ ...body, mode: "finalize", ids: [...qualified] });
    lastMarkdown = final.output || "";
    lastHTML = markdownToHtml(lastMarkdown);
    setResultIframe(lastHTML);
    completePhase("openai");
    setActionsEnabled(Boolean(lastMarkdown));
    spin.style.display = "none";
    const out = $("out");
    if (out) out.style.display = "none";
    burstEmojis(currentVoice);
  } catch (err) {
    console.error(err);
    setActionsEnabled(Boolean(lastMarkdown));
    if (out) {
      out.style.display = "block";
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "";
      out.textContent = `ERROR: ${message || "Unknown error"}`;
    }
    spin.style.display = "none";
  } finally {
    runBtn.disabled = false;
  }
}

// Wire inputs ---------------------------------------------------------------
const runButton = $("run");
if (runButton) {
  runButton.addEventListener("click", () => {
    const components = parseLines($("components")?.value || "")
      .map((s) => {
        const [product, component] = s
          .split(":")
          .map((x) => (x ? x.trim() : ""));
        return product && component ? { product, component } : null;
      })
      .filter(Boolean);
    const metabugs = parseLines($("metabugs")?.value || "")
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));
    const whiteboards = parseLines($("whiteboards")?.value || "");
    const days = Number($("days")?.value) || 8;
    const voice = $("voice")?.value || "normal";
    const audience = $("audience")?.value || "technical";
    const debug = $("debug")?.value === "true";
    const skipCache = $("cache")?.value === "false";

    const sp = new URLSearchParams();
    // Store raw textarea strings; they're newline-safe in params.
    sp.set("components", $("components")?.value || "");
    sp.set("whiteboards", $("whiteboards")?.value || "");
    sp.set("metabugs", $("metabugs")?.value || "");
    sp.set("days", String(days));
    sp.set("voice", voice);
    sp.set("aud", audience);
    sp.set("debug", String(debug));
    if (skipCache) sp.set("nocache", "1");
    else sp.delete("nocache");
    history.replaceState(null, "", `?${sp.toString()}`);

    currentVoice = voice;
    const payload = {
      components,
      metabugs,
      whiteboards,
      days,
      format: "md",
      voice,
      audience,
      debug,
      skipCache,
    };
    // If Debug = Yes, use streaming (shows live logs + progress)
    if (debug) {
      runSnazzyStream(payload);
    } else {
      runSnazzyPaged(payload);
    }
  });
}

function hydrateFromURL() {
  const sp = new URLSearchParams(location.search);
  const set = (id, v) => {
    const el = $(id);
    if (el && v != null) el.value = v;
  };
  if (sp.has("components")) set("components", sp.get("components") || "");
  if (sp.has("whiteboards")) set("whiteboards", sp.get("whiteboards") || "");
  if (sp.has("metabugs")) set("metabugs", sp.get("metabugs") || "");
  if (sp.has("days")) set("days", sp.get("days") || "7");
  if (sp.has("voice")) set("voice", sp.get("voice") || "normal");
  if (sp.has("aud")) set("audience", sp.get("aud") || "technical");
  if (sp.has("debug"))
    set("debug", sp.get("debug") === "true" ? "true" : "false");
  if (sp.has("nocache")) set("cache", "false");
}
hydrateFromURL();

// Actions -------------------------------------------------------------------
const copyBtn = $("copy");
if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    if (!lastMarkdown.trim()) return;
    try {
      await navigator.clipboard.writeText(lastMarkdown);
      const quickStatus = $("quick-status");
      if (quickStatus) {
        quickStatus.textContent = "Copied Markdown";
        quickStatus.style.display = "inline-flex";
      }
    } catch (err) {
      console.error(err);
    }
  });
}

const copyRenderedBtn = $("copy-rendered");
if (copyRenderedBtn) {
  copyRenderedBtn.addEventListener("click", async () => {
    if (!lastHTML.trim()) return;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blob = new Blob([lastHTML], { type: "text/html" });
        const item = new ClipboardItem({
          "text/html": blob,
          "text/plain": new Blob([lastMarkdown], { type: "text/plain" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(lastHTML);
      }
      const quickStatus = $("quick-status");
      if (quickStatus) {
        quickStatus.textContent = "Copied rendered HTML";
        quickStatus.style.display = "inline-flex";
      }
    } catch (err) {
      console.error(err);
    }
  });
}

const downloadMdBtn = $("dl-md");
if (downloadMdBtn) {
  downloadMdBtn.addEventListener("click", () => {
    if (!lastMarkdown.trim()) return;
    download(
      "snazzybot-status.md",
      lastMarkdown,
      "text/markdown;charset=utf-8"
    );
  });
}

const downloadHtmlBtn = $("dl-html");
if (downloadHtmlBtn) {
  downloadHtmlBtn.addEventListener("click", () => {
    if (!lastHTML.trim()) return;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>SnazzyBot Status</title></head><body>${lastHTML}</body></html>`;
    download("snazzybot-status.html", html, "text/html;charset=utf-8");
  });
}
