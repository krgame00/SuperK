/**
 * SuperK — Bounded Undo/Redo Manager with Dual Memory Tiers
 *
 * Enforces strict memory quotas for:
 * 1. MAX_UNDO_STATES (50): Lightweight text, layout, styling, and metadata states.
 * 2. MAX_RASTER_UNDO_STATES (8): Heavy bitmap canvas, brush strokes, and inpaint masks.
 *
 * Automatically disposes dropped or pruned states to prevent V8 heap bloat
 * and graphical GPU/CPU texture leaks.
 */

export type UndoActionKind = "generic" | "raster";

export interface UndoAction {
  label: string;
  undo: () => void;
  redo: () => void;
  kind?: UndoActionKind;
  dispose?: () => void;
}

export const DEFAULT_MAX_UNDO_STATES = 50;
export const DEFAULT_MAX_RASTER_UNDO_STATES = 8;

export class UndoManager {
  private stack: UndoAction[] = [];
  private pointer = -1;
  private maxSize = DEFAULT_MAX_UNDO_STATES;
  private maxRasterStates = DEFAULT_MAX_RASTER_UNDO_STATES;
  private listeners: (() => void)[] = [];

  constructor(maxSize = DEFAULT_MAX_UNDO_STATES, maxRasterStates = DEFAULT_MAX_RASTER_UNDO_STATES) {
    this.maxSize = Math.max(1, maxSize);
    this.maxRasterStates = Math.max(1, maxRasterStates);
  }

  push(action: UndoAction): void {
    // 1. Cut any redo actions ahead of pointer and dispose their resources
    if (this.pointer < this.stack.length - 1) {
      const abandoned = this.stack.slice(this.pointer + 1);
      for (const item of abandoned) {
        try {
          item.dispose?.();
        } catch (err) {
          console.warn("[UndoManager] Error disposing abandoned action:", err);
        }
      }
      this.stack = this.stack.slice(0, this.pointer + 1);
    }

    // 2. Add new action
    this.stack.push(action);
    this.pointer++;

    // 3. Enforce MAX_RASTER_UNDO_STATES if current action or stack contains raster items
    if (action.kind === "raster") {
      this.enforceRasterCap();
    }

    // 4. Enforce general MAX_UNDO_STATES cap
    while (this.stack.length > this.maxSize) {
      const oldest = this.stack.shift();
      try {
        oldest?.dispose?.();
      } catch (err) {
        console.warn("[UndoManager] Error disposing evicted action:", err);
      }
      this.pointer = Math.max(-1, this.pointer - 1);
    }

    this.notify();
  }

  private enforceRasterCap(): void {
    let rasterCount = 0;
    for (const item of this.stack) {
      if (item.kind === "raster") rasterCount++;
    }

    // If raster count exceeds budget, evict the oldest raster action(s)
    while (rasterCount > this.maxRasterStates) {
      const oldestRasterIdx = this.stack.findIndex((item) => item.kind === "raster");
      if (oldestRasterIdx === -1) break;

      const [removed] = this.stack.splice(oldestRasterIdx, 1);
      try {
        removed?.dispose?.();
      } catch (err) {
        console.warn("[UndoManager] Error disposing evicted raster action:", err);
      }

      if (oldestRasterIdx <= this.pointer) {
        this.pointer = Math.max(-1, this.pointer - 1);
      }
      rasterCount--;
    }
  }

  undo(): string | null {
    if (!this.canUndo()) return null;
    const action = this.stack[this.pointer];
    action.undo();
    this.pointer--;
    this.notify();
    return action.label;
  }

  redo(): string | null {
    if (!this.canRedo()) return null;
    this.pointer++;
    const action = this.stack[this.pointer];
    action.redo();
    this.notify();
    return action.label;
  }

  canUndo(): boolean {
    return this.pointer >= 0;
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  clear(): void {
    for (const action of this.stack) {
      try {
        action.dispose?.();
      } catch (err) {
        console.warn("[UndoManager] Error disposing action during clear:", err);
      }
    }
    this.stack = [];
    this.pointer = -1;
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  // Diagnostics and introspection
  getStackSize(): number {
    return this.stack.length;
  }

  getRasterCount(): number {
    return this.stack.filter((item) => item.kind === "raster").length;
  }

  getPointer(): number {
    return this.pointer;
  }

  getMaxSize(): number {
    return this.maxSize;
  }

  getMaxRasterStates(): number {
    return this.maxRasterStates;
  }

  setMaxSize(size: number): void {
    this.maxSize = Math.max(1, size);
    while (this.stack.length > this.maxSize) {
      const oldest = this.stack.shift();
      oldest?.dispose?.();
      this.pointer = Math.max(-1, this.pointer - 1);
    }
    this.notify();
  }

  setMaxRasterStates(count: number): void {
    this.maxRasterStates = Math.max(1, count);
    this.enforceRasterCap();
    this.notify();
  }
}

export const undoManager = new UndoManager();
