/**
 * A Map with bounded capacity that evicts its least-recently-used entries on
 * insert. Accessing a key refreshes its recency. Compatible with the plain
 * Map surface used across the app (get/set/has/delete/iteration), so it can
 * replace cache Maps without touching call sites.
 */
export class LRUMap<K, V> extends Map<K, V> {
  private readonly maxEntries: number;
  private readonly isProtected?: (key: K) => boolean;

  constructor(maxEntries: number, isProtected?: (key: K) => boolean) {
    super();
    this.maxEntries = Math.max(1, maxEntries);
    this.isProtected = isProtected;
  }

  override get(key: K): V | undefined {
    const value = super.get(key);
    if (value !== undefined) {
      // Refresh recency: re-insert moves the key to the back of the queue.
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }

  override set(key: K, value: V): this {
    super.delete(key);
    super.set(key, value);
    while (this.size > this.maxEntries) {
      const evicted = this.findEvictable();
      if (evicted === undefined) break;
      super.delete(evicted);
    }
    return this;
  }

  private findEvictable(): K | undefined {
    for (const key of super.keys()) {
      if (!this.isProtected?.(key)) return key;
    }
    return undefined;
  }
}
