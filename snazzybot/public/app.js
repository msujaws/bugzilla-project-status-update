import DOMPurify from "./vendor/dompurify.js";
import { SavedSearches } from "./lib/saved-searches.js";

const $ = (id) => document.querySelector(`#${id}`);
const defaultTitle = document.title;

// Facts Rotation Manager
class FactsRotator {
  constructor() {
    this.facts = [];
    this.usedFactIndices = [];
    this.intervalId = undefined;
    this.container = undefined;
    this.statusMessage = undefined;
    this.isRunning = false;
    this.DISPLAY_TIME = 7000; // 7 seconds per fact
    this.statusMessages = [
      "Analyzing bug impact trajectories",
      "Calibrating priority matrices",
      "Parsing assignee metadata",
      "Compiling patch histories",
      "Reticulating status updates",
      "Aggregating resolution timelines",
      "Synthesizing dependency graphs",
      "Normalizing severity distributions",
      "Calculating regression probabilities",
      "Extracting changelog artifacts",
      "Indexing component hierarchies",
      "Correlating duplicate patterns",
      "Stratifying milestone layers",
      "Sequencing review cycles",
      "Optimizing summarization vectors",
      "Triangulating user impact scores",
      "Coalescing whiteboard metadata",
      "Factoring product dimensions",
      "Iterating through bug histories",
      "Distilling actionable insights",
    ];
  }

  async loadFacts() {
    try {
      const response = await fetch("/facts.json");
      const data = await response.json();
      this.facts = data.facts || [];
    } catch (error) {
      console.error("Failed to load facts:", error);
      this.facts = [
        {
          fact: "Loading interesting facts about Bugzilla and Mozilla...",
          score: 5,
        },
      ];
    }
  }

  getRandomFact() {
    if (this.facts.length === 0) return;

    // Reset if we've used all facts
    if (this.usedFactIndices.length >= this.facts.length) {
      this.usedFactIndices = [];
    }

    // Find unused facts
    const availableIndices = [];
    for (let i = 0; i < this.facts.length; i++) {
      if (!this.usedFactIndices.includes(i)) {
        availableIndices.push(i);
      }
    }

    // Pick random unused fact
    const randomIndex =
      availableIndices[Math.floor(Math.random() * availableIndices.length)];
    this.usedFactIndices.push(randomIndex);
    return { index: randomIndex, fact: this.facts[randomIndex] };
  }

  getRandomStatusMessage() {
    return this.statusMessages[
      Math.floor(Math.random() * this.statusMessages.length)
    ];
  }

  start() {
    if (this.isRunning || this.facts.length === 0) return;

    const frame = $("resultFrame");
    if (!frame) return;

    // Hide the iframe and create facts container
    frame.style.display = "none";

    // Create or reuse the facts container
    let container = document.querySelector("#factsContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "factsContainer";
      frame.parentNode.insertBefore(container, frame);
    }
    container.style.display = "flex";
    this.container = container;

    // Create or reuse status message element
    let statusMsg = container.querySelector(".status-message");
    if (!statusMsg) {
      statusMsg = document.createElement("div");
      statusMsg.className = "status-message";
      container.append(statusMsg);
    }
    this.statusMessage = statusMsg;

    // Start showing facts
    this.isRunning = true;
    this.usedFactIndices = [];
    this.showRandomFact();

    // Set up rotation interval
    this.intervalId = setInterval(() => {
      this.showRandomFact();
    }, this.DISPLAY_TIME);
  }

  showRandomFact() {
    if (!this.container || this.facts.length === 0) return;

    const randomFact = this.getRandomFact();
    if (!randomFact) return;

    // Update status message (no animation)
    if (this.statusMessage) {
      this.statusMessage.textContent = `${this.getRandomStatusMessage()}...`;
    }

    const currentSlide = this.container.querySelector(".fact-slide.active");
    if (currentSlide) {
      currentSlide.classList.remove("active");
      currentSlide.classList.add("exiting");
    }

    // Create new fact slide
    const slide = document.createElement("div");
    slide.className = "fact-slide";
    slide.textContent = randomFact.fact.fact;
    this.container.append(slide);

    // Trigger animation after a brief delay
    setTimeout(() => {
      slide.classList.add("active");

      // Remove old slide after transition
      if (currentSlide) {
        setTimeout(() => {
          if (currentSlide.parentNode) {
            currentSlide.remove();
          }
        }, 600);
      }
    }, 50);
  }

  stop() {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Hide facts container and show iframe
    if (this.container) {
      this.container.style.display = "none";
    }

    const frame = $("resultFrame");
    if (frame) {
      frame.style.display = "block";
    }
  }
}

const factsRotator = new FactsRotator();
// Load facts when page loads
factsRotator.loadFacts();

const escapeHtml = (text = "") =>
  text.replaceAll(/[&<>"']/g, (ch) => {
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

const fallbackMarkdownToHtml = (markdown) => {
  if (!markdown) return "";
  return `<pre>${escapeHtml(markdown).replaceAll(/\r?\n/g, "<br />")}</pre>`;
};

function resetTabTitle() {
  document.title = defaultTitle;
}

function markResultsComplete() {
  document.title = `Results ready - ${defaultTitle}`;
}

window.addEventListener("focus", resetTabTitle);

// ===== Emoji Confetti Engine (no deps) =====
const reduceMotion = globalThis.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

function burstEmojis(mode = "normal") {
  if (reduceMotion) return; // respect reduced motion preference
  const canvas = document.querySelector("#fx-layer");
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
      emoji: EMOJI[Math.trunc(Math.random() * EMOJI.length)],
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
// Convert phase name to valid CSS ID
function slugify(name) {
  return name.toLowerCase().replaceAll(/\s+/g, "-");
}

function ensurePhase(name, label) {
  const slug = slugify(name);
  let host = document.querySelector(`[data-phase="${slug}"]`);
  if (!host) {
    host = document.createElement("div");
    host.dataset.phase = slug;
    const title = document.createElement("div");
    title.className = "phase-title";
    title.id = `title-${slug}`;
    title.textContent = label || name;
    const bar = document.createElement("div");
    bar.className = "progress";
    const fill = document.createElement("div");
    fill.className = "bar";
    fill.id = `bar-${slug}`;
    bar.append(fill);
    host.append(title);
    host.append(bar);
    const phases = $("phases");
    if (phases) phases.append(host);
  }
  return host;
}

function setPhaseText(name, txt) {
  const slug = slugify(name);
  const t = $(`title-${slug}`);
  if (t) t.textContent = txt;
}

function setPhasePct(name, current, total) {
  const slug = slugify(name);
  const bar = $(`bar-${slug}`);
  if (!bar || !total) return;
  bar.classList.remove("indeterminate");
  const pct = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  bar.style.width = `${pct}%`;
}

function setPhaseIndeterminate(name) {
  const slug = slugify(name);
  const bar = $(`bar-${slug}`);
  if (bar) {
    bar.classList.add("indeterminate");
    bar.style.width = "";
  }
}

function completePhase(name) {
  const slug = slugify(name);
  const bar = $(`bar-${slug}`);
  if (bar) {
    bar.classList.remove("indeterminate");
    bar.style.width = "100%";
    bar.dataset.completed = "true";
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
  logHost.append(line);
  logHost.scrollTop = logHost.scrollHeight;
}

// Utilities -----------------------------------------------------------------
function parseLines(t) {
  return t
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseEmailMapping(text) {
  if (!text || !text.trim()) return {};

  const mapping = {};
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(.+?)\s*->\s*(.+)$/);
    if (match) {
      const [, email, username] = match;
      mapping[email.trim()] = username.trim();
    }
  }

  return mapping;
}

function setActionsEnabled(enabled) {
  for (const id of ["copy", "copy-rendered", "dl-md", "dl-html"]) {
    const el = $(id);
    if (el) el.disabled = !enabled;
  }
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setResultIframe(html) {
  // Stop facts rotation when displaying results
  factsRotator.stop();

  const safeHtml = DOMPurify.sanitize(html ?? "", {
    USE_PROFILES: { html: true },
  });
  const frame = $("resultFrame");
  if (!frame) return safeHtml;
  const doc = `<!doctype html><html><head>
  <meta charset="utf-8" />
  <style>
    body{
      font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
      padding:16px;color:rgb(170,176,214);}
    a,a:visited{color:#aab0d6}
    h1,h2,h3{margin:0.6em 0 0.35em}
    ul{margin:0.4em 0 0.6em 1.2em}
    p{margin:0.6em 0;}
    code {
      font-size: 0.95em;
      font-family: ui-monospace, monospace;
      background: transparent;
      color: #cfcfcf;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      padding: 0.1em 0.4em;
    }
  </style>
</head><body>${safeHtml}</body></html>`;
  frame.srcdoc = doc;

  const onload = () => {
    try {
      const docElement = frame.contentDocument?.documentElement;
      if (!docElement) return;
      const h = docElement.scrollHeight;
      frame.style.height = `${Math.min(Math.max(h + 2, 240), 1200)}px`;
    } catch (error) {
      console.error(error);
    }
  };
  frame.addEventListener("load", onload);
  setTimeout(onload, 50);
  return safeHtml;
}

// State for copy buttons ----------------------------------------------------
let lastMarkdown = "";
let lastHTML = "";
let currentVoice = "normal";

// Helpers shared by both runners -------------------------------------------
function resetUIBeforeRun() {
  const out = $("out");
  resetTabTitle();
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

  // Start rotating facts instead of showing "Waiting for results..."
  factsRotator.start();
}

async function postStatusJSON(payload) {
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
        accept: "application/x-ndjson",
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
      try {
        evt = JSON.parse(line);
      } catch {
        return;
      }
      switch (evt.kind) {
        case "start": {
          spin.textContent = "⏳ Discovering…";
          break;
        }
        case "info": {
          log("info", evt.msg || "");
          break;
        }
        case "warn": {
          log("warn", evt.msg || "");
          break;
        }
        case "phase": {
          const name = String(evt.name || "phase");
          ensurePhase(name, name);
          if (evt.complete === true) {
            // Phase completed
            completePhase(name);
            setPhaseText(name, `${name}: done`);
          } else if (typeof evt.total === "number") {
            // Phase started with known total
            setPhasePct(name, 0, evt.total || 1);
            setPhaseText(name, `${name}: 0/${evt.total}`);
          } else {
            // Phase started with unknown duration
            setPhaseIndeterminate(name);
          }
          break;
        }
        case "progress": {
          const name = String(evt.phase || "phase");
          if (typeof evt.total === "number") {
            setPhasePct(name, Number(evt.current) || 0, Number(evt.total) || 1);
            setPhaseText(
              name,
              `${name}: ${Number(evt.current) || 0}/${Number(evt.total) || 1}`
            );
          } else {
            setPhaseIndeterminate(name);
          }
          break;
        }
        case "done": {
          setPhaseText("openai", "openai: done");
          completePhase("openai");
          lastMarkdown =
            typeof evt.output === "string" ? evt.output.trim() : "";
          const html = typeof evt.html === "string" ? evt.html : "";
          if (html) {
            lastHTML = html;
          } else if (body.format === "html") {
            lastHTML = lastMarkdown;
          } else {
            lastHTML = fallbackMarkdownToHtml(lastMarkdown);
          }
          lastHTML = setResultIframe(lastHTML);
          setActionsEnabled(Boolean(lastMarkdown));
          spin.style.display = "none";
          burstEmojis(currentVoice);
          markResultsComplete();
          break;
        }
        case "error": {
          throw new Error(evt.msg || "Server error");
        }
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
  } catch (error) {
    console.error(error);
    const out = $("out");
    if (out) {
      out.style.display = "block";
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "";
      out.textContent = `ERROR: ${message || "Unknown error"}`;
    }
    setActionsEnabled(Boolean(lastMarkdown));
    if (spin) spin.style.display = "none";
  } finally {
    runBtn.disabled = false;
  }
}

// Existing paged runner (kept as fallback) ----------------------------------
async function runSnazzyPaged(body) {
  const runBtn = $("run");
  const spin = $("spin");
  const out = $("out");
  if (!runBtn || !spin) return;

  runBtn.disabled = true;
  setActionsEnabled(false);
  spin.style.display = "inline-flex";
  spin.textContent = "⏳ Starting…";

  resetUIBeforeRun();

  try {
    // 1) Discover all candidates (counts & compact metadata)
    spin.style.display = "inline-flex";
    spin.textContent = "⏳ Discovering…";
    const discover = await postStatusJSON({ ...body, mode: "discover" });
    const total = discover.total || 0;
    log("info", `Candidates: ${total}`);

    // 2) Page through histories
    const qualified = new Set();
    let cursor = 0;
    const step = Math.min(35, Math.max(20, Math.ceil(40))); // default ~35 per page
    ensurePhase("histories", "histories");
    while (cursor != undefined && cursor < total) {
      spin.textContent = `⏳ Histories ${cursor + 1}-${Math.min(cursor + step, total)} of ${total}`;
      setPhaseText(
        "histories",
        `histories: ${cursor + 1}-${Math.min(cursor + step, total)} of ${total}`
      );
      setPhasePct("histories", Math.min(cursor + step, total), total);
      const page = await postStatusJSON({
        ...body,
        mode: "page",
        cursor,
        pageSize: step,
      });
      for (const id of page.qualifiedIds || []) qualified.add(id);
      // Log qualification reasons for each bug
      if (page.results && Array.isArray(page.results)) {
        for (const result of page.results) {
          if (result.qualified && result.detail) {
            log("info", `Bug ${result.id}: qualified – ${result.detail}`);
          } else if (!result.qualified && result.reason) {
            log("info", `Bug ${result.id}: excluded – ${result.reason}`);
          }
        }
      }
      cursor = page.nextCursor;
    }
    completePhase("histories");
    log("info", `Qualified (history): ${qualified.size}`);

    // 3) Gather patch context
    const qualifiedIds = [...qualified];
    const includePatchContext = body.includePatchContext !== false;
    if (includePatchContext) {
      spin.textContent = "⏳ Preparing patch context…";
      ensurePhase("patch-context", "patch-context");
      if (qualifiedIds.length > 0) {
        setPhasePct("patch-context", 0, qualifiedIds.length);
        setPhaseText(
          "patch-context",
          `patch-context: 0/${qualifiedIds.length}`
        );
      } else {
        setPhaseIndeterminate("patch-context");
      }
    } else {
      spin.textContent = "⏳ Summarizing…";
      ensurePhase("openai", "openai");
      setPhaseIndeterminate("openai");
    }
    // 4) Finalize (OpenAI + output)
    const final = await postStatusJSON({
      ...body,
      mode: "finalize",
      ids: qualifiedIds,
    });
    if (includePatchContext) {
      completePhase("patch-context");
      setPhaseText("patch-context", "patch-context: done");
      spin.textContent = "⏳ Summarizing…";
    }
    ensurePhase("openai", "openai");
    setPhaseIndeterminate("openai");
    lastMarkdown = typeof final.output === "string" ? final.output.trim() : "";
    if (typeof final.html === "string" && final.html) {
      lastHTML = final.html;
    } else if (body.format === "html") {
      lastHTML = lastMarkdown;
    } else {
      lastHTML = fallbackMarkdownToHtml(lastMarkdown);
    }
    lastHTML = setResultIframe(lastHTML);
    completePhase("openai");
    setActionsEnabled(Boolean(lastMarkdown));
    spin.style.display = "none";
    if (out) out.style.display = "none";
    burstEmojis(currentVoice);
    markResultsComplete();
  } catch (error) {
    console.error(error);
    setActionsEnabled(Boolean(lastMarkdown));
    if (out) {
      out.style.display = "block";
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "";
      out.textContent = `ERROR: ${message || "Unknown error"}`;
    }
    if (body.includePatchContext !== false) {
      setPhaseIndeterminate("patch-context");
    }
    spin.style.display = "none";
  } finally {
    runBtn.disabled = false;
  }
}

const setFieldValue = (id, value) => {
  const el = $(id);
  if (el && value !== undefined && "value" in el) {
    el.value = value;
  }
};

// Wire inputs ---------------------------------------------------------------
const runButton = $("run");
if (runButton) {
  runButton.addEventListener("click", () => {
    const components = parseLines($("components")?.value || "")
      .map((s) => {
        const trimmed = s.trim();
        if (!trimmed) return;
        const colon = trimmed.indexOf(":");
        if (colon === -1) {
          return { product: trimmed };
        }
        const product = trimmed.slice(0, colon).trim();
        const component = trimmed.slice(colon + 1).trim();
        if (!product) {
          throw new Error(`Bad component "${s}"`);
        }
        if (!component) {
          return { product };
        }
        return { product, component };
      })
      .filter(Boolean);
    const metabugs = parseLines($("metabugs")?.value || "")
      .map(Number)
      .filter((n) => Number.isFinite(n));
    const whiteboards = parseLines($("whiteboards")?.value || "");
    const assignees = parseLines($("assignees")?.value || "");
    const githubRepos = parseLines($("github-repos")?.value || "");
    const emailMapping = parseEmailMapping($("email-mapping")?.value || "");
    const days = Number($("days")?.value) || 8;
    const voice = $("voice")?.value || "normal";
    const audience = $("audience")?.value || "technical";
    const debug = $("debug")?.value === "true";
    const skipCache = $("cache")?.value === "false";
    const includePatchContext =
      ($("patch-context")?.value || "include") !== "omit";
    const includeGithubActivity = githubRepos.length > 0;

    const sp = new URLSearchParams();
    // Store raw textarea strings; they're newline-safe in params.
    sp.set("components", $("components")?.value || "");
    sp.set("whiteboards", $("whiteboards")?.value || "");
    sp.set("metabugs", $("metabugs")?.value || "");
    sp.set("assignees", $("assignees")?.value || "");
    sp.set("days", String(days));
    sp.set("voice", voice);
    sp.set("aud", audience);
    sp.set("debug", String(debug));
    if (skipCache) sp.set("nocache", "1");
    else sp.delete("nocache");
    if (includePatchContext) {
      sp.delete("pc");
    } else {
      sp.set("pc", "0");
    }
    history.replaceState(undefined, "", `?${sp.toString()}`);

    currentVoice = voice;
    const payload = {
      components,
      metabugs,
      whiteboards,
      assignees,
      days,
      format: "md",
      voice,
      audience,
      debug,
      skipCache,
      includePatchContext,
      githubRepos,
      emailMapping,
      includeGithubActivity,
    };
    // If Debug = Yes, use streaming (shows live logs + progress)
    if (debug) {
      runSnazzyStream(payload);
    } else {
      runSnazzyPaged(payload);
    }
  });
}

function getCurrentFormParams() {
  return {
    components: $("components")?.value || "",
    whiteboards: $("whiteboards")?.value || "",
    metabugs: $("metabugs")?.value || "",
    assignees: $("assignees")?.value || "",
    githubRepos: $("github-repos")?.value || "",
    emailMapping: $("email-mapping")?.value || "",
    days: Number($("days")?.value) || 7,
    voice: $("voice")?.value || "normal",
    audience: $("audience")?.value || "technical",
    debug: $("debug")?.value === "true",
    cache: $("cache")?.value === "true",
    patchContext: $("patch-context")?.value || "omit",
  };
}

function hydrateFromURL() {
  const sp = new URLSearchParams(location.search);

  // Parse query parameters
  if (sp.has("components"))
    setFieldValue("components", sp.get("components") || "");
  if (sp.has("whiteboards"))
    setFieldValue("whiteboards", sp.get("whiteboards") || "");
  if (sp.has("metabugs")) setFieldValue("metabugs", sp.get("metabugs") || "");
  if (sp.has("assignees"))
    setFieldValue("assignees", sp.get("assignees") || "");
  if (sp.has("github-repos"))
    setFieldValue("github-repos", sp.get("github-repos") || "");
  if (sp.has("email-mapping"))
    setFieldValue("email-mapping", sp.get("email-mapping") || "");
  if (sp.has("days")) setFieldValue("days", sp.get("days") || "7");
  if (sp.has("voice")) setFieldValue("voice", sp.get("voice") || "normal");
  if (sp.has("aud")) setFieldValue("audience", sp.get("aud") || "technical");
  if (sp.has("debug"))
    setFieldValue("debug", sp.get("debug") === "true" ? "true" : "false");
  if (sp.has("nocache")) setFieldValue("cache", "false");
  if (sp.get("pc") === "0") setFieldValue("patch-context", "omit");

  // Auto-execute if 'auto' parameter is present
  if (sp.has("auto") && sp.get("auto") === "1") {
    // Remove 'auto' parameter from URL after reading it
    sp.delete("auto");
    const cleanURL = sp.toString() ? `?${sp.toString()}` : location.pathname;
    history.replaceState(undefined, "", cleanURL);

    // Trigger the run button after a short delay to ensure DOM is ready
    setTimeout(() => {
      if (runButton) {
        runButton.click();
      }
    }, 100);
  }
}
hydrateFromURL();

// Initialize Saved Searches -------------------------------------------------
const savedSearchesContainer = document.querySelector(
  "#saved-searches-container"
);

const savedSearches = new SavedSearches(savedSearchesContainer, {
  onLoad: (params) => {
    // Populate form fields
    setFieldValue("components", params.components || "");
    setFieldValue("whiteboards", params.whiteboards || "");
    setFieldValue("metabugs", params.metabugs || "");
    setFieldValue("assignees", params.assignees || "");
    setFieldValue("github-repos", params.githubRepos || "");
    setFieldValue("email-mapping", params.emailMapping || "");
    setFieldValue("days", String(params.days || 7));
    setFieldValue("voice", params.voice || "normal");
    setFieldValue("audience", params.audience || "technical");
    setFieldValue("debug", params.debug ? "true" : "false");
    setFieldValue("cache", params.cache ? "true" : "false");
    setFieldValue("patch-context", params.patchContext || "omit");
  },
});

// Add "Save Search" button
const actionsRow = document.querySelector(".actions-row .actions");
if (actionsRow) {
  const saveSearchBtn = document.createElement("button");
  saveSearchBtn.id = "save-search";
  saveSearchBtn.className = "secondary";
  saveSearchBtn.textContent = "Save Search";
  saveSearchBtn.addEventListener("click", async () => {
    const params = getCurrentFormParams();
    await savedSearches.createFromParams(params);
  });
  actionsRow.append(saveSearchBtn);
}

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
    } catch (error) {
      console.error(error);
    }
  });
}

const copyRenderedBtn = $("copy-rendered");
if (copyRenderedBtn) {
  copyRenderedBtn.addEventListener("click", async () => {
    if (!lastHTML.trim()) return;
    try {
      if (navigator.clipboard && globalThis.ClipboardItem) {
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
    } catch (error) {
      console.error(error);
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
