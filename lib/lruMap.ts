/**
 * A Map with bounded capacity that evicts its least-recently-used entries on
 * insert. Accessing a key refreshes its recency. Compatible with the plain
 * Map surface used across the app (get/set/has/delete/iteration), so it can
 * replace cache Maps without touching call sites.
 */
export interface LRUMapOptions<K, V> {
  isProtected?: (key: K) => boolean;
  maxWeight?: number;
  weightOf?: (value: V, key: K) => number;
}

export class LRUMap<K, V> extends Map<K, V> {
  private readonly maxEntries: number;
  private readonly isProtected?: (key: K) => boolean;
  private readonly maxWeight: number;
  private readonly weightOf: (value: V, key: K) => number;
  private currentWeight = 0;

  constructor(
    maxEntries: number,
    optionsOrProtection?: ((key: K) => boolean) | LRUMapOptions<K, V>,
  ) {
    super();
    this.maxEntries = Math.max(1, maxEntries);
    const options =
      typeof optionsOrProtection === "function"
        ? { isProtected: optionsOrProtection }
        : optionsOrProtection;
    this.isProtected = options?.isProtected;
    this.maxWeight = Math.max(1, options?.maxWeight ?? Number.POSITIVE_INFINITY);
    this.weightOf = options?.weightOf ?? (() => 1);
  }

  get totalWeight(): number {
    return this.currentWeight;
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
    if (super.has(key)) {
      const previous = super.get(key) as V;
      this.currentWeight -= this.entryWeight(previous, key);
      super.delete(key);
    }
    super.set(key, value);
    this.currentWeight += this.entryWeight(value, key);
    while (this.size > this.maxEntries || this.currentWeight > this.maxWeight) {
      const evicted = this.findEvictable();
      if (evicted === undefined) break;
      this.delete(evicted);
    }
    return this;
  }

  override delete(key: K): boolean {
    if (!super.has(key)) return false;
    const value = super.get(key) as V;
    const deleted = super.delete(key);
    if (deleted) {
      this.currentWeight = Math.max(
        0,
        this.currentWeight - this.entryWeight(value, key),
      );
    }
    return deleted;
  }

  override clear(): void {
    super.clear();
    this.currentWeight = 0;
  }

  private entryWeight(value: V, key: K): number {
    const weight = this.weightOf(value, key);
    return Number.isFinite(weight) ? Math.max(0, weight) : 0;
  }

  private findEvictable(): K | undefined {
    for (const key of super.keys()) {
      if (!this.isProtected?.(key)) return key;
    }
    return undefined;
  }
}
