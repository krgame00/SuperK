/**
 * SuperK — Machine-Aware Resource Budget & Bounded Residency Manager (ADR 0013)
 *
 * Enforces a bounded memory budget (~5-8% host RAM, min 128MB, max 1024MB)
 * across recomputable page representations (decoded source, clean image, masks, translated renders).
 */

export interface ResourceItem<T = unknown> {
  key: string;
  category: "source" | "clean" | "mask" | "translated-render";
  sizeBytes: number;
  lastAccessedAt: number;
  data: T;
}

export interface ResourceBudgetConfig {
  /** Host RAM in MB. If undefined, defaults to 8192 MB (8GB) */
  hostRamMB?: number;
  /** Fraction of host RAM to allocate (default 0.06 = 6%) */
  targetRatio?: number;
  /** Minimum budget cap in MB (default 128MB) */
  minCapMB?: number;
  /** Maximum budget cap in MB (default 1024MB) */
  maxCapMB?: number;
}

export class ResourceBudgetManager<T = unknown> {
  private readonly maxBudgetMB: number;
  private readonly maxSizeBytes: number;
  private currentSizeBytes = 0;
  private items = new Map<string, ResourceItem<T>>();

  constructor(config: ResourceBudgetConfig = {}) {
    const hostRam = config.hostRamMB ?? this.detectHostRamMB();
    const ratio = config.targetRatio ?? 0.06;
    const minCap = config.minCapMB ?? 128;
    const maxCap = config.maxCapMB ?? 1024;

    const computedMB = Math.round(hostRam * ratio);
    this.maxBudgetMB = Math.max(minCap, Math.min(maxCap, computedMB));
    this.maxSizeBytes = this.maxBudgetMB * 1024 * 1024;
  }

  private detectHostRamMB(): number {
    if (typeof navigator !== "undefined" && "deviceMemory" in navigator) {
      const dm = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
      if (typeof dm === "number" && dm > 0) {
        return dm * 1024;
      }
    }
    return 8192; // 8GB default
  }

  getBudgetMB(): number {
    return this.maxBudgetMB;
  }

  getCurrentUsageMB(): number {
    return Number((this.currentSizeBytes / (1024 * 1024)).toFixed(2));
  }

  getCurrentUsageBytes(): number {
    return this.currentSizeBytes;
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  get(key: string): T | undefined {
    const item = this.items.get(key);
    if (!item) return undefined;
    item.lastAccessedAt = Date.now();
    return item.data;
  }

  set(
    key: string,
    data: T,
    sizeBytes: number,
    category: ResourceItem["category"] = "translated-render",
    isWarm?: (key: string) => boolean,
    onEvictItem?: (item: ResourceItem<T>) => void,
  ): string[] {
    const existing = this.items.get(key);
    if (existing) {
      this.currentSizeBytes -= existing.sizeBytes;
    }

    const item: ResourceItem<T> = {
      key,
      category,
      sizeBytes,
      lastAccessedAt: Date.now(),
      data,
    };

    this.items.set(key, item);
    this.currentSizeBytes += sizeBytes;

    // Return list of evicted keys if budget exceeded
    return this.evictToFit(this.maxSizeBytes, isWarm, onEvictItem);
  }

  delete(key: string): boolean {
    const existing = this.items.get(key);
    if (!existing) return false;
    this.currentSizeBytes -= existing.sizeBytes;
    this.items.delete(key);
    return true;
  }

  clear(): void {
    this.items.clear();
    this.currentSizeBytes = 0;
  }

  /**
   * Reclaims resources to fit target budget. Prefers evicting cold/non-warm entries.
   */
  evictToFit(
    targetBytes: number = this.maxSizeBytes,
    isWarm?: (key: string) => boolean,
    onEvictItem?: (item: ResourceItem<T>) => void,
  ): string[] {
    if (this.currentSizeBytes <= targetBytes) return [];

    const evicted: string[] = [];
    // Sort items: non-warm first, then oldest lastAccessedAt
    const sorted = Array.from(this.items.values()).sort((a, b) => {
      const aWarm = isWarm ? isWarm(a.key) : false;
      const bWarm = isWarm ? isWarm(b.key) : false;
      if (aWarm !== bWarm) {
        return aWarm ? 1 : -1; // non-warm first
      }
      return a.lastAccessedAt - b.lastAccessedAt; // oldest first
    });

    for (const item of sorted) {
      if (this.currentSizeBytes <= targetBytes) break;
      if (onEvictItem) {
        onEvictItem(item);
      }
      this.currentSizeBytes -= item.sizeBytes;
      this.items.delete(item.key);
      evicted.push(item.key);
    }

    return evicted;
  }

  /**
   * Handles high memory pressure by evicting all non-warm entries.
   */
  handleMemoryPressure(isWarm?: (key: string) => boolean): string[] {
    const evicted: string[] = [];
    if (!isWarm) {
      return this.evictToFit(this.maxSizeBytes * 0.5);
    }

    // Under pressure with warm predicate: evict all non-warm entries immediately
    for (const [key, item] of Array.from(this.items.entries())) {
      if (!isWarm(key)) {
        this.currentSizeBytes -= item.sizeBytes;
        this.items.delete(key);
        evicted.push(key);
      }
    }
    return evicted;
  }
}
