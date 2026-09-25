/**
 * SuperK — Workspace Resource & Eviction Manager (ADR 0013)
 *
 * Coordinates ResourceBudgetManager and PageBlobStore,
 * and pageLifecycle to ensure bounded memory residency across long sessions.
 */

import { ResourceBudgetManager, type ResourceItem } from "./resourceBudget";
import { getWarmPageIndices } from "./pageLifecycle";
import { pageBlobStore } from "./pageBlobStore";

export interface WorkspaceResourceHookConfig {
  hostRamMB?: number;
  targetRatio?: number;
  minCapMB?: number;
  maxCapMB?: number;
  onEvict?: (key: string, category: ResourceItem["category"]) => void;
}

export interface RenderedImageCacheEntry {
  signature: string;
  dataUrl: string;
}

export class WorkspaceResourceManager {
  private budgetManager: ResourceBudgetManager<unknown>;
  private pageIds: string[] = [];
  private currentPage = 0;
  private onEvictCallback?: (key: string, category: ResourceItem["category"]) => void;

  constructor(config: WorkspaceResourceHookConfig = {}) {
    this.budgetManager = new ResourceBudgetManager({
      hostRamMB: config.hostRamMB,
      targetRatio: config.targetRatio ?? 0.06,
      minCapMB: config.minCapMB ?? 128,
      maxCapMB: config.maxCapMB ?? 1024,
    });
    this.onEvictCallback = config.onEvict;
  }

  getBudgetMB(): number {
    return this.budgetManager.getBudgetMB();
  }

  getCurrentUsageMB(): number {
    return this.budgetManager.getCurrentUsageMB();
  }

  getCurrentUsageBytes(): number {
    return this.budgetManager.getCurrentUsageBytes();
  }

  /**
   * Predicate checking whether a resource key belongs to a warm page.
   */
  isWarm = (key: string): boolean => {
    const warmIndices = getWarmPageIndices(this.currentPage, this.pageIds.length);
    const warmPageIds = new Set(warmIndices.map((i) => this.pageIds[i]));

    // Keys might be pageId or pageId:category
    const pageId = key.split(":")[0];
    return warmPageIds.has(pageId);
  };

  /**
   * Updates current page list and active index, reconciling warm set and evicting cold items.
   */
  updateNavigation(pageIds: string[], currentPage: number): string[] {
    this.pageIds = pageIds;
    this.currentPage = currentPage;

    const warmIndices = getWarmPageIndices(currentPage, pageIds.length);

    // Ensure warm pages have active Object URLs ready
    for (const idx of warmIndices) {
      const pageId = pageIds[idx];
      if (pageId && pageBlobStore.has(pageId)) {
        const url = pageBlobStore.getOrCreateObjectUrl(pageId);
        const entry = pageBlobStore.getEntry(pageId);
        if (url && entry && !this.budgetManager.has(`${pageId}:source`)) {
          this.budgetManager.set(
            `${pageId}:source`,
            url,
            entry.sizeBytes,
            "source",
            this.isWarm,
          );
        }
      }
    }

    // Evict cold items exceeding budget
    return this.budgetManager.evictToFit(undefined, this.isWarm, this.handleEvictedItem);
  }

  /**
   * Registers a recomputable resource representation in the budget.
   */
  registerResource(
    pageId: string,
    category: ResourceItem["category"],
    data: unknown,
    sizeBytes: number,
  ): string[] {
    const key = `${pageId}:${category}`;
    return this.budgetManager.set(
      key,
      data,
      sizeBytes,
      category,
      this.isWarm,
      this.handleEvictedItem,
    );
  }

  /**
   * Retrieves a cached resource if resident in memory.
   */
  getResource<T = unknown>(pageId: string, category: ResourceItem["category"]): T | undefined {
    return this.budgetManager.get(`${pageId}:${category}`) as T | undefined;
  }

  hasResource(pageId: string, category: ResourceItem["category"]): boolean {
    return this.budgetManager.has(`${pageId}:${category}`);
  }

  /**
   * Rehydrates a page's source representation when revisited or needed for export.
   */
  rehydrateSourceUrl(pageId: string): string | null {
    const sourceKey = `${pageId}:source`;
    const cached = this.budgetManager.get(sourceKey);
    if (typeof cached === "string") return cached;

    if (pageBlobStore.has(pageId)) {
      const url = pageBlobStore.getOrCreateObjectUrl(pageId);
      const entry = pageBlobStore.getEntry(pageId);
      if (url && entry) {
        this.budgetManager.set(sourceKey, url, entry.sizeBytes, "source", this.isWarm, this.handleEvictedItem);
        return url;
      }
    }
    return null;
  }

  /**
   * Registers a rendered image along with its revision signature in the budget.
   */
  registerRenderedImage(
    pageId: string,
    signature: string,
    dataUrl: string,
    sizeBytes?: number,
  ): string[] {
    const bytes = sizeBytes ?? Math.round(dataUrl.length * 0.75);
    const key = `${pageId}:translated-render`;
    return this.budgetManager.set(
      key,
      { signature, dataUrl } satisfies RenderedImageCacheEntry,
      bytes,
      "translated-render",
      this.isWarm,
      this.handleEvictedItem,
    );
  }

  /**
   * Returns a resident render only when its revision matches. Evicted renders
   * are recomputed by the caller from saved bubbles/edits, not retained in a
   * second in-memory cache outside the resource budget.
   */
  restoreRenderedImage(pageId: string, expectedSignature: string): string | null {
    const memKey = `${pageId}:translated-render`;
    const mem = this.budgetManager.get(memKey) as RenderedImageCacheEntry | string | undefined;
    if (mem) {
      if (typeof mem === "object" && mem !== null && "signature" in mem && "dataUrl" in mem) {
        if (mem.signature === expectedSignature) {
          return mem.dataUrl;
        }
        // Stale revision in memory -> purge from budget
        this.budgetManager.delete(memKey);
      } else if (typeof mem === "string") {
        if (expectedSignature === "default") {
          return mem;
        }
        this.budgetManager.delete(memKey);
      }
    }

    return null;
  }

  /**
   * Handles actions required when an item is evicted from memory.
   */
  private handleEvictedItem = (item: ResourceItem<unknown>): void => {
    const [pageId, category] = item.key.split(":") as [string, ResourceItem["category"]];

    if (category === "source") {
      // Revoke the object URL to immediately reclaim browser memory
      pageBlobStore.revokeObjectUrl(pageId);
    }

    if (this.onEvictCallback) {
      this.onEvictCallback(item.key, category);
    }
  };

  /**
   * Cleans up all resources on workspace unload.
   */
  clear(): void {
    this.budgetManager.clear();
    pageBlobStore.clear();
    this.pageIds = [];
    this.currentPage = 0;
  }
}

export const workspaceResourceManager = new WorkspaceResourceManager();
