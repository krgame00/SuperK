import { describe, expect, it } from "vitest";

import { LRUMap } from "@/lib/lruMap";

describe("LRUMap", () => {
  it("evicts the least recently used entry beyond capacity", () => {
    const lru = new LRUMap<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.get("a")).toBe(1); // refresh "a" — now "b" is oldest
    lru.set("c", 3);
    expect(lru.has("a")).toBe(true);
    expect(lru.has("b")).toBe(false);
    expect(lru.has("c")).toBe(true);
  });

  it("never evicts protected keys", () => {
    const lru = new LRUMap<string, number>(2, (key) => key === "pinned");
    lru.set("pinned", 0);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    expect(lru.has("pinned")).toBe(true);
    expect(lru.has("a")).toBe(false);
    expect(lru.has("c")).toBe(true);
  });

  it("re-setting a key refreshes it instead of duplicating", () => {
    const lru = new LRUMap<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("a", 10);
    expect(lru.size).toBe(2);
    expect(lru.get("a")).toBe(10);
  });

  it("is snapshot-compatible with new Map(lru)", () => {
    const lru = new LRUMap<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("c", 3);
    const snapshot = new Map(lru);
    expect(snapshot.has("a")).toBe(false);
    expect(snapshot.get("c")).toBe(3);
    expect(snapshot.size).toBe(2);
  });

  it("evicts by total weight before the entry limit is reached", () => {
    const lru = new LRUMap<string, string>(10, {
      maxWeight: 8,
      weightOf: (value) => value.length,
    });
    lru.set("a", "1234");
    lru.set("b", "5678");
    lru.set("c", "90");

    expect(lru.has("a")).toBe(false);
    expect(lru.has("b")).toBe(true);
    expect(lru.has("c")).toBe(true);
    expect(lru.totalWeight).toBe(6);
  });

  it("updates weight when values are replaced or deleted", () => {
    const lru = new LRUMap<string, string>(10, {
      maxWeight: 10,
      weightOf: (value) => value.length,
    });
    lru.set("a", "1234");
    lru.set("a", "12");
    lru.set("b", "567");
    expect(lru.totalWeight).toBe(5);

    lru.delete("a");
    expect(lru.totalWeight).toBe(3);
    lru.clear();
    expect(lru.totalWeight).toBe(0);
  });

  it("keeps a protected entry even when it alone exceeds the weight budget", () => {
    const lru = new LRUMap<string, string>(10, {
      isProtected: (key) => key === "current",
      maxWeight: 3,
      weightOf: (value) => value.length,
    });
    lru.set("current", "12345");

    expect(lru.get("current")).toBe("12345");
    expect(lru.totalWeight).toBe(5);
  });
});
