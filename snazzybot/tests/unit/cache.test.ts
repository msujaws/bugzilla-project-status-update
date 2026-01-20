import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createExpiringMemoryCache,
  DAY_IN_MILLISECONDS,
} from "../../src/utils/cache.ts";

describe("createExpiringMemoryCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return undefined for non-existent keys", () => {
    const cache = createExpiringMemoryCache<string>(1000);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("should store and retrieve values", () => {
    const cache = createExpiringMemoryCache<string>(1000);
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  it("should expire values after TTL", () => {
    const cache = createExpiringMemoryCache<string>(1000);
    cache.set("key", "value");

    vi.advanceTimersByTime(1001);

    expect(cache.get("key")).toBeUndefined();
  });

  it("should delete values", () => {
    const cache = createExpiringMemoryCache<string>(1000);
    cache.set("key", "value");
    cache.delete("key");
    expect(cache.get("key")).toBeUndefined();
  });

  it("should clear all values", () => {
    const cache = createExpiringMemoryCache<string>(1000);
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.clear();
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBeUndefined();
  });

  describe("proactive cleanup", () => {
    it("should expose size for testing memory growth", () => {
      const cache = createExpiringMemoryCache<string>(1000);
      cache.set("key1", "value1");
      cache.set("key2", "value2");

      // Cache should expose size for observability
      expect(cache.size()).toBe(2);
    });

    it("should proactively clean up expired entries on write after cleanup interval", () => {
      const cache = createExpiringMemoryCache<string>(100); // 100ms TTL
      const TWO_HOURS = 2 * 60 * 60 * 1000;

      // Add entries
      cache.set("key1", "value1");
      cache.set("key2", "value2");
      expect(cache.size()).toBe(2);

      // Advance time past TTL and past cleanup interval (2 hours)
      vi.advanceTimersByTime(TWO_HOURS + 100);

      // Add a new entry (which should trigger cleanup due to interval elapsed)
      cache.set("key3", "value3");

      // Expired entries should be cleaned up proactively
      // Without proactive cleanup, size would be 3
      expect(cache.size()).toBe(1);
    });

    it("should clean up expired entries periodically even without new writes", () => {
      const cache = createExpiringMemoryCache<string>(100);
      const TWO_HOURS = 2 * 60 * 60 * 1000;

      cache.set("key1", "value1");
      cache.set("key2", "value2");
      expect(cache.size()).toBe(2);

      // Advance time past TTL and cleanup interval (2 hours)
      vi.advanceTimersByTime(TWO_HOURS + 100);

      // Cleanup should have run, removing expired entries
      expect(cache.size()).toBe(0);
    });
  });
});

describe("DAY_IN_MILLISECONDS", () => {
  it("should equal 24 hours in milliseconds", () => {
    expect(DAY_IN_MILLISECONDS).toBe(24 * 60 * 60 * 1000);
  });
});
