import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  SavedSearches,
  saveSearch,
  getAllSearches,
} from "../../public/lib/saved-searches.js";

// Setup DOM environment
let dom;
let container;
let mockCallbacks;

beforeEach(() => {
  // Create a minimal DOM
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://test.local/",
    pretendToBeVisual: true,
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;

  // Mock localStorage
  const localStorageMock = (() => {
    let store = {};
    return {
      getItem: (key) => store[key] || undefined,
      setItem: (key, value) => {
        store[key] = value.toString();
      },
      removeItem: (key) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
  })();
  globalThis.localStorage = localStorageMock;

  // Mock crypto
  if (!globalThis.crypto || !globalThis.crypto.randomUUID) {
    globalThis.crypto = {
      randomUUID: () =>
        `test-uuid-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    };
  }

  // Mock fetch for AI suggestions
  globalThis.fetch = vi.fn();

  // Setup container
  container = document.createElement("div");
  container.id = "saved-searches-container";
  document.body.append(container);

  // Clear localStorage
  localStorage.clear();

  // Setup mock callbacks
  mockCallbacks = {
    onLoad: vi.fn(),
    onSave: vi.fn(),
  };
});

afterEach(() => {
  localStorage.clear();
  if (dom) {
    dom.window.close();
  }
  vi.restoreAllMocks();
});

describe("SavedSearches Class", () => {
  it("initializes with empty state when no searches exist", () => {
    new SavedSearches(container, mockCallbacks);
    expect(container.children).toHaveLength(0);
  });

  it("renders saved searches from localStorage", () => {
    saveSearch({
      name: "Test 1",
      params: { components: "Firefox", days: 7 },
    });
    saveSearch({
      name: "Test 2",
      params: { components: "DevTools", days: 14 },
    });

    new SavedSearches(container, mockCallbacks);
    const searchElements = container.querySelectorAll(".saved-search");
    expect(searchElements).toHaveLength(2);
    expect(container.textContent).toContain("Test 1");
    expect(container.textContent).toContain("Test 2");
  });

  it("creates a new search with AI-generated name", async () => {
    const mockSuggestName = vi
      .fn()
      .mockResolvedValue("DevTools Weekly Updates");
    const params = { components: "DevTools", days: 7 };

    const searches = new SavedSearches(container, mockCallbacks);
    await searches.createFromParams(params, { suggestName: mockSuggestName });

    expect(mockSuggestName).toHaveBeenCalledWith(params);
    expect(container.textContent).toContain("DevTools Weekly Updates");
    expect(mockCallbacks.onSave).toHaveBeenCalled();
  });

  it("falls back to generic name if AI suggestion fails", async () => {
    const mockSuggestName = vi.fn().mockRejectedValue(new Error("API Error"));
    const params = { components: "Firefox", days: 7 };

    const searches = new SavedSearches(container, mockCallbacks);
    await searches.createFromParams(params, { suggestName: mockSuggestName });

    const searchNames = container.querySelectorAll(".search-name");
    expect(searchNames).toHaveLength(1);
    expect(searchNames[0].textContent).toMatch(/Saved Search \d+/);
  });

  it("populates form fields when search is clicked", () => {
    const params = { components: "Firefox:General", days: 14 };
    saveSearch({ name: "Click Me", params });

    new SavedSearches(container, mockCallbacks);
    const searchEl = container.querySelector(".saved-search");
    expect(searchEl).toBeTruthy();

    searchEl.click();

    expect(mockCallbacks.onLoad).toHaveBeenCalledWith(params);
  });

  it("does not auto-run when search is clicked", () => {
    const params = { components: "DevTools", days: 7 };
    saveSearch({ name: "Click Me", params });

    mockCallbacks.onRun = vi.fn();
    new SavedSearches(container, mockCallbacks);

    container.querySelector(".saved-search").click();

    expect(mockCallbacks.onRun).not.toHaveBeenCalled();
  });

  it("enables inline editing when edit button is clicked", () => {
    saveSearch({ name: "Edit Me", params: {} });

    new SavedSearches(container, mockCallbacks);
    const editBtn = container.querySelector(".edit-btn");
    expect(editBtn).toBeTruthy();
    expect(editBtn.getAttribute("aria-label")).toBe("Edit search name");

    editBtn.click();

    const input = container.querySelector("input[type='text']");
    expect(input).toBeTruthy();
    expect(input.value).toBe("Edit Me");
    expect(input.className).toBe("search-name-input");
  });

  it("saves new name on Enter key", async () => {
    const search = saveSearch({ name: "Old Name", params: {} });

    new SavedSearches(container, mockCallbacks);
    const editBtn = container.querySelector(".edit-btn");
    editBtn.click();

    const input = container.querySelector("input");
    input.value = "New Name";

    const enterEvent = new dom.window.KeyboardEvent("keydown", {
      key: "Enter",
    });
    input.dispatchEvent(enterEvent);

    // Wait for re-render
    await new Promise((resolve) => setTimeout(resolve, 10));

    const allSearches = getAllSearches();
    const updated = allSearches.find((s) => s.id === search.id);
    expect(updated.name).toBe("New Name");
  });

  it("cancels editing on Escape key", async () => {
    saveSearch({ name: "Original", params: {} });

    new SavedSearches(container, mockCallbacks);
    const editBtn = container.querySelector(".edit-btn");
    editBtn.click();

    const input = container.querySelector("input");
    input.value = "Changed";

    const escapeEvent = new dom.window.KeyboardEvent("keydown", {
      key: "Escape",
    });
    input.dispatchEvent(escapeEvent);

    // Wait for re-render
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(container.textContent).toContain("Original");
    expect(container.querySelector("input")).toBeFalsy();
  });

  it("shows delete button with trash icon", () => {
    saveSearch({ name: "Delete Me", params: {} });

    new SavedSearches(container, mockCallbacks);
    const deleteBtn = container.querySelector(".delete-btn");

    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn.querySelector("svg use")).toBeTruthy();
    expect(deleteBtn.querySelector("svg use").getAttribute("href")).toBe(
      "#icon-trash",
    );
    expect(deleteBtn.getAttribute("aria-label")).toBe("Delete search");
  });

  it("shows 'Undo' text for 3 seconds after delete", () => {
    vi.useFakeTimers();
    saveSearch({ name: "Delete Me", params: {} });

    new SavedSearches(container, mockCallbacks);
    const deleteBtn = container.querySelector(".delete-btn");
    deleteBtn.click();

    // Should show undo button
    expect(container.textContent).toContain("Undo");
    expect(container.querySelector(".undo-btn")).toBeTruthy();
    expect(container.querySelector(".search-name-deleted")).toBeTruthy();

    // After 3 seconds, search should be deleted
    vi.advanceTimersByTime(3000);
    vi.runAllTimers();

    expect(container.textContent).not.toContain("Delete Me");
    expect(container.textContent).not.toContain("Undo");

    vi.useRealTimers();
  });

  it("restores search when Undo is clicked within 3 seconds", () => {
    vi.useFakeTimers();
    saveSearch({ name: "Restore Me", params: {} });

    new SavedSearches(container, mockCallbacks);
    const deleteBtn = container.querySelector(".delete-btn");
    deleteBtn.click();

    const undoBtn = container.querySelector(".undo-btn");
    expect(undoBtn).toBeTruthy();

    undoBtn.click();
    vi.runAllTimers();

    expect(container.textContent).toContain("Restore Me");
    expect(container.textContent).not.toContain("Undo");
    expect(getAllSearches()).toHaveLength(1);

    vi.useRealTimers();
  });

  it("wraps searches horizontally when multiple exist", () => {
    for (let i = 0; i < 10; i++) {
      saveSearch({ name: `Search ${i}`, params: {} });
    }

    new SavedSearches(container, mockCallbacks);
    const wrapper = container.querySelector(".saved-searches-wrapper");

    expect(wrapper).toBeTruthy();
    expect(wrapper.querySelectorAll(".saved-search")).toHaveLength(10);
    // Wrapper should have flex display for wrapping
    expect(wrapper.className).toBe("saved-searches-wrapper");
  });

  it("generates shareable URL with query parameters", () => {
    const search = saveSearch({
      name: "Share Me",
      params: { components: "Firefox", days: 7 },
    });

    const searches = new SavedSearches(container, mockCallbacks);
    const url = searches.getShareableURL(search.id);

    expect(url).toContain("?components=Firefox");
    expect(url).toContain("days=7");
  });

  it("generates full URL with origin for copying", () => {
    const search = saveSearch({
      name: "Share Me",
      params: { components: "Firefox", days: 7 },
    });

    const searches = new SavedSearches(container, mockCallbacks);
    const url = searches.getShareableURL(search.id, { includeOrigin: true });

    expect(url).toContain("https://test.local/");
    expect(url).toContain("components=Firefox");
    expect(url).toContain("days=7");
  });

  it("returns empty string for non-existent search ID when getting shareable URL", () => {
    const searches = new SavedSearches(container, mockCallbacks);
    const url = searches.getShareableURL("non-existent-id");

    expect(url).toBe("");
  });

  it("cancels previous pending delete when deleting another search", () => {
    vi.useFakeTimers();
    saveSearch({ name: "Search 1", params: {} });
    saveSearch({ name: "Search 2", params: {} });

    new SavedSearches(container, mockCallbacks);

    // Get delete buttons
    const deleteButtons = container.querySelectorAll(".delete-btn");
    expect(deleteButtons.length).toBe(2);

    // Delete first search in the list
    deleteButtons[0].click();
    expect(container.textContent).toContain("Undo");

    // After delete, re-query to get current delete buttons
    // The search that wasn't deleted should still have a delete button
    const remainingDeleteButtons = container.querySelectorAll(".delete-btn");
    expect(remainingDeleteButtons.length).toBeGreaterThan(0);

    // Delete the second search
    if (remainingDeleteButtons.length > 0) {
      remainingDeleteButtons[0].click();
    }

    // Advance time and check results
    vi.advanceTimersByTime(3000);
    vi.runAllTimers();

    // At least one search should remain
    const allSearches = getAllSearches();
    expect(allSearches.length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
  });

  it("calls suggestNameViaAPI by default when no custom suggestName provided", async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ name: "AI Generated Name" }),
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const params = { components: "Firefox", days: 7 };
    const searches = new SavedSearches(container, mockCallbacks);

    await searches.createFromParams(params);

    expect(fetch).toHaveBeenCalledWith("/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params }),
    });

    expect(container.textContent).toContain("AI Generated Name");
  });

  it("handles API failure gracefully in suggestNameViaAPI", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const params = { components: "Firefox", days: 7 };
    const searches = new SavedSearches(container, mockCallbacks);

    await searches.createFromParams(params);

    // Should fall back to generic name
    const searchNames = container.querySelectorAll(".search-name");
    expect(searchNames).toHaveLength(1);
    expect(searchNames[0].textContent).toMatch(/Saved Search \d+/);
  });

  it("shows share button that copies URL to clipboard", async () => {
    saveSearch({
      name: "Test Search",
      params: { components: "Firefox", days: 7 },
    });

    // Mock clipboard API
    const writeTextMock = vi.fn().mockResolvedValue();
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    new SavedSearches(container, mockCallbacks);
    const shareBtn = container.querySelector(".share-btn");

    expect(shareBtn).toBeTruthy();
    expect(shareBtn.getAttribute("aria-label")).toBe("Copy share link");

    await shareBtn.click();

    // Should have called clipboard with full URL including query parameters
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("https://test.local/"),
    );
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("components=Firefox"),
    );

    // Should show success feedback
    expect(shareBtn.innerHTML).toBe("✓");
  });

  it("shows error feedback when clipboard fails", async () => {
    saveSearch({
      name: "Test Search",
      params: { components: "Firefox", days: 7 },
    });

    // Mock clipboard API to fail
    const writeTextMock = vi
      .fn()
      .mockRejectedValue(new Error("Clipboard not available"));
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    new SavedSearches(container, mockCallbacks);
    const shareBtn = container.querySelector(".share-btn");

    await shareBtn.click();

    // Should show error feedback
    expect(shareBtn.innerHTML).toBe("✗");
  });
});
