import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAllSearches,
  saveSearch,
  deleteSearch,
  updateSearchName,
  getSearchById,
} from "../../public/lib/saved-searches.js";

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

// Mock crypto.randomUUID if not available
if (!globalThis.crypto || !globalThis.crypto.randomUUID) {
  globalThis.crypto = {
    randomUUID: () =>
      `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  };
}

describe("SavedSearches Storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("saves a new search to localStorage", () => {
    const search = {
      name: "My Search",
      params: {
        components: "Firefox",
        whiteboards: "",
        metabugs: "",
        assignees: "",
        githubRepos: "",
        emailMapping: "",
        days: 7,
        voice: "normal",
        audience: "technical",
        debug: false,
        cache: true,
        patchContext: "omit",
      },
    };
    const saved = saveSearch(search);
    const stored = getAllSearches();

    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("My Search");
    expect(stored[0].id).toBeDefined();
    expect(stored[0].createdAt).toBeDefined();
    expect(saved.id).toBeDefined();
  });

  it("generates unique IDs for each saved search", () => {
    const search1 = saveSearch({ name: "Search 1", params: {} });
    const search2 = saveSearch({ name: "Search 2", params: {} });
    const searches = getAllSearches();

    expect(searches).toHaveLength(2);
    expect(search1.id).not.toBe(search2.id);
  });

  it("retrieves all saved searches in order", () => {
    saveSearch({ name: "First", params: {} });
    saveSearch({ name: "Second", params: {} });

    const searches = getAllSearches();
    expect(searches).toHaveLength(2);
    expect(searches[0].name).toBe("Second");
    expect(searches[1].name).toBe("First");
  });

  it("deletes a search by ID", () => {
    const search = saveSearch({ name: "Delete Me", params: {} });
    expect(getAllSearches()).toHaveLength(1);

    deleteSearch(search.id);
    expect(getAllSearches()).toHaveLength(0);
  });

  it("updates an existing search name", () => {
    const search = saveSearch({ name: "Old Name", params: {} });
    updateSearchName(search.id, "New Name");
    const updated = getSearchById(search.id);
    expect(updated.name).toBe("New Name");
  });

  it("returns null when getting search by non-existent ID", () => {
    const result = getSearchById("non-existent-id");
    expect(result).toBeUndefined();
  });

  it("handles localStorage quota exceeded gracefully", () => {
    // Mock localStorage.setItem to throw QuotaExceededError
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = vi.fn(() => {
      const error = new Error("QuotaExceededError");
      error.name = "QuotaExceededError";
      throw error;
    });

    expect(() => saveSearch({ name: "Test", params: {} })).toThrow(
      /Storage quota exceeded/,
    );

    // Restore original
    localStorage.setItem = originalSetItem;
  });

  it("handles corrupted localStorage data gracefully", () => {
    localStorage.setItem("snazzybot_searches", "invalid-json{{{");
    const searches = getAllSearches();
    expect(searches).toEqual([]); // Returns empty array, doesn't crash
    // Verify it cleared the corrupted data
    expect(localStorage.getItem("snazzybot_searches")).toBeUndefined();
  });

  it("limits storage to 50 searches, removing oldest by createdAt", () => {
    vi.useFakeTimers();
    const startTime = Date.now();

    // Create 51 searches with incrementing createdAt timestamps
    for (let i = 0; i < 51; i++) {
      vi.setSystemTime(startTime + i * 1000);
      saveSearch({
        name: `Search ${i}`,
        params: {},
      });
    }

    const searches = getAllSearches();
    expect(searches).toHaveLength(50);

    // The oldest search (Search 0) should have been removed
    const hasOldest = searches.some((s) => s.name === "Search 0");
    expect(hasOldest).toBe(false);

    // The newest searches should be present
    const hasNewest = searches.some((s) => s.name === "Search 50");
    expect(hasNewest).toBe(true);

    vi.useRealTimers();
  });

  it("preserves existing id and createdAt when provided", () => {
    const customId = "custom-id-123";
    const customCreatedAt = 1_234_567_890;

    const search = saveSearch({
      id: customId,
      name: "Custom",
      params: {},
      createdAt: customCreatedAt,
    });

    expect(search.id).toBe(customId);
    expect(search.createdAt).toBe(customCreatedAt);
  });

  it("does not modify other searches when updating one", () => {
    const search1 = saveSearch({ name: "Search 1", params: {} });
    const search2 = saveSearch({ name: "Search 2", params: {} });

    updateSearchName(search1.id, "Modified 1");

    const updated1 = getSearchById(search1.id);
    const updated2 = getSearchById(search2.id);

    expect(updated1.name).toBe("Modified 1");
    expect(updated2.name).toBe("Search 2");
  });

  it("does not crash when deleting non-existent search", () => {
    saveSearch({ name: "Test", params: {} });
    expect(() => deleteSearch("non-existent-id")).not.toThrow();
    expect(getAllSearches()).toHaveLength(1);
  });

  it("returns empty array when localStorage is completely empty", () => {
    const searches = getAllSearches();
    expect(searches).toEqual([]);
  });
});
