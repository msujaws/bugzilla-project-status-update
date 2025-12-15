import { beforeEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

// Helper to convert phase name to valid CSS ID (matches app.js)
function slugify(name: string): string {
  return name.toLowerCase().replaceAll(/\s+/g, "-");
}

// Type for phase events in tests
interface PhaseEvent {
  kind: string;
  name: string;
  complete?: boolean;
  total?: number;
}

describe("Phase UI handling", () => {
  let dom: JSDOM;
  let document: Document;
  let completePhase: (name: string) => void;
  let ensurePhase: (name: string, label: string) => void;
  let setPhaseText: (name: string, text: string) => void;
  let setPhasePct: (name: string, current: number, total: number) => void;
  let setPhaseIndeterminate: (name: string) => void;

  beforeEach(() => {
    // Create a minimal DOM for testing
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="phases"></div>
        </body>
      </html>
    `);
    document = dom.window.document;
    globalThis.document = document as unknown as Document;

    // Implement the phase UI functions (real implementations for testing)
    completePhase = (name: string) => {
      const slug = slugify(name);
      const bar = document.querySelector(`#bar-${slug}`) as HTMLElement;
      if (bar) {
        bar.classList.remove("indeterminate");
        bar.style.width = "100%";
        bar.dataset.completed = "true";
      }
    };

    ensurePhase = (name: string, label: string) => {
      const slug = slugify(name);
      let host = document.querySelector(`[data-phase="${slug}"]`);
      if (!host) {
        host = document.createElement("div");
        (host as HTMLElement).dataset.phase = slug;
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
        host.append(title, bar);
        document.querySelector("#phases")?.append(host);
      }
    };

    setPhaseText = (name: string, text: string) => {
      const slug = slugify(name);
      const title = document.querySelector(`#title-${slug}`) as HTMLElement;
      if (title) {
        title.textContent = text;
      }
    };

    setPhasePct = (name: string, current: number, total: number) => {
      const slug = slugify(name);
      const bar = document.querySelector(`#bar-${slug}`) as HTMLElement;
      if (bar) {
        bar.classList.remove("indeterminate");
        bar.style.width = `${(100 * current) / total}%`;
      }
    };

    setPhaseIndeterminate = (name: string) => {
      const slug = slugify(name);
      const bar = document.querySelector(`#bar-${slug}`) as HTMLElement;
      if (bar) {
        bar.classList.add("indeterminate");
        bar.style.width = "";
      }
    };
  });

  it("should complete phase when receiving complete: true", () => {
    const phaseName = "Loading bugs";
    const evt = { kind: "phase", name: phaseName, complete: true };

    // Simulate the phase event handler from app.js
    const name = String(evt.name || "phase");
    ensurePhase(name, name);

    if (evt.complete === true) {
      completePhase(name);
      setPhaseText(name, `${name}: done`);
    }

    // Verify the DOM reflects completion (query using slugified ID)
    const slug = slugify(phaseName);
    const bar = document.querySelector(`#bar-${slug}`) as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar?.style.width).toBe("100%");
    expect(bar?.dataset.completed).toBe("true");

    const title = document.querySelector(`#title-${slug}`) as HTMLElement;
    expect(title?.textContent).toBe(`${phaseName}: done`);
  });

  it("should set indeterminate state when phase starts without total", () => {
    const phaseName = "Generating AI summary";
    const evt: PhaseEvent = { kind: "phase", name: phaseName };

    const name = String(evt.name || "phase");
    ensurePhase(name, name);

    if (evt.complete === true) {
      completePhase(name);
      setPhaseText(name, `${name}: done`);
    } else if (typeof evt.total === "number") {
      setPhasePct(name, 0, evt.total || 1);
      setPhaseText(name, `${name}: 0/${evt.total}`);
    } else {
      setPhaseIndeterminate(name);
    }

    const slug = slugify(phaseName);
    const bar = document.querySelector(`#bar-${slug}`) as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar?.classList.contains("indeterminate")).toBe(true);
    expect(bar?.dataset.completed).not.toBe("true");
  });

  it("should set progress when phase starts with total", () => {
    const phaseName = "Fetching bug histories";
    const evt = { kind: "phase", name: phaseName, total: 10 };

    const name = String(evt.name || "phase");
    ensurePhase(name, name);

    if (evt.complete === true) {
      completePhase(name);
      setPhaseText(name, `${name}: done`);
    } else if (typeof evt.total === "number") {
      setPhasePct(name, 0, evt.total || 1);
      setPhaseText(name, `${name}: 0/${evt.total}`);
    } else {
      setPhaseIndeterminate(name);
    }

    const slug = slugify(phaseName);
    const bar = document.querySelector(`#bar-${slug}`) as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar?.style.width).toBe("0%");
    expect(bar?.classList.contains("indeterminate")).toBe(false);

    const title = document.querySelector(`#title-${slug}`) as HTMLElement;
    expect(title?.textContent).toBe(`${phaseName}: 0/10`);
  });

  it("should handle phase lifecycle: start -> complete", () => {
    const phaseName = "Loading commit context";
    const slug = slugify(phaseName);

    // Phase start
    const startEvt = { kind: "phase", name: phaseName };
    let name = String(startEvt.name || "phase");
    ensurePhase(name, name);
    setPhaseIndeterminate(name);

    let bar = document.querySelector(`#bar-${slug}`) as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar?.classList.contains("indeterminate")).toBe(true);

    // Phase complete
    const completeEvt = { kind: "phase", name: phaseName, complete: true };
    name = String(completeEvt.name || "phase");

    if (completeEvt.complete === true) {
      completePhase(name);
      setPhaseText(name, `${name}: done`);
    }

    bar = document.querySelector(`#bar-${slug}`) as HTMLElement;
    expect(bar?.style.width).toBe("100%");
    expect(bar?.dataset.completed).toBe("true");
    expect(bar?.classList.contains("indeterminate")).toBe(false);

    const title = document.querySelector(`#title-${slug}`) as HTMLElement;
    expect(title?.textContent).toBe(`${phaseName}: done`);
  });

  it("should NOT complete phase when complete is false", () => {
    const phaseName = "Test phase";
    const evt = { kind: "phase", name: phaseName, complete: false };

    const name = String(evt.name || "phase");
    ensurePhase(name, name);

    if (evt.complete === true) {
      completePhase(name);
      setPhaseText(name, `${name}: done`);
    } else {
      setPhaseIndeterminate(name);
    }

    const slug = slugify(phaseName);
    const bar = document.querySelector(`#bar-${slug}`) as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar?.dataset.completed).not.toBe("true");
    expect(bar?.classList.contains("indeterminate")).toBe(true);
  });

  it("should NOT complete phase when complete is missing", () => {
    const phaseName = "Test phase";
    const evt: PhaseEvent = { kind: "phase", name: phaseName };

    const name = String(evt.name || "phase");
    ensurePhase(name, name);

    if (evt.complete === true) {
      completePhase(name);
      setPhaseText(name, `${name}: done`);
    } else {
      setPhaseIndeterminate(name);
    }

    const slug = slugify(phaseName);
    const bar = document.querySelector(`#bar-${slug}`) as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar?.dataset.completed).not.toBe("true");
    expect(bar?.classList.contains("indeterminate")).toBe(true);
  });
});
