// Undo/Redo Manager - Command Pattern for vanilla DOM bubble manipulation

type UndoAction = {
  undo: () => void;
  redo: () => void;
  label: string;
};

class UndoManager {
  private stack: UndoAction[] = [];
  private pointer = -1;
  private maxSize = 50;
  private listeners: (() => void)[] = [];

  push(action: UndoAction) {
    // Cut any redo actions ahead of pointer
    this.stack = this.stack.slice(0, this.pointer + 1);
    this.stack.push(action);
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    } else {
      this.pointer++;
    }
    this.notify();
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

  clear() {
    this.stack = [];
    this.pointer = -1;
    this.notify();
  }

  onChange(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }
}

export const undoManager = new UndoManager();
