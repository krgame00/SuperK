"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { ChevronDown } from "lucide-react";

export interface WorkspaceMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  itemRef?: Ref<HTMLButtonElement>;
  onSelect: () => void;
}

export interface WorkspaceMenuHandle {
  openAndFocusItem(id: string): void;
  focusTrigger(): void;
}

export interface WorkspaceMenuProps {
  label: string;
  items: WorkspaceMenuItem[];
  disabled?: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  icon?: ReactNode;
}

export const WorkspaceMenu = forwardRef<WorkspaceMenuHandle, WorkspaceMenuProps>(
  function WorkspaceMenu(
    { label, items, disabled = false, triggerRef, icon },
    ref,
  ): ReactElement {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const menuId = useId();
    const ownTriggerRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const getTrigger = () => triggerRef?.current || ownTriggerRef.current;

    useImperativeHandle(
      ref,
      () => ({
        openAndFocusItem: (id: string) => {
          const idx = items.findIndex((item) => item.id === id);
          if (idx >= 0) {
            setOpen(true);
            setActiveIndex(idx);
          }
        },
        focusTrigger: () => {
          (triggerRef?.current || ownTriggerRef.current)?.focus();
        },
      }),
      [items, triggerRef],
    );

    useEffect(() => {
      const handleOutsideClick = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      if (open) {
        document.addEventListener("mousedown", handleOutsideClick);
      }
      return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, [open]);

    useEffect(() => {
      if (open) {
        const firstEnabled = items.findIndex((item) => !item.disabled);
        const targetIndex = activeIndex >= 0 ? activeIndex : firstEnabled;
        if (targetIndex >= 0 && itemRefs.current[targetIndex]) {
          itemRefs.current[targetIndex]?.focus();
        }
      }
    }, [open, activeIndex, items]);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        getTrigger()?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          const first = items.findIndex((i) => !i.disabled);
          setActiveIndex(first >= 0 ? first : 0);
        } else {
          let next = (activeIndex + 1) % items.length;
          while (items[next]?.disabled && next !== activeIndex) {
            next = (next + 1) % items.length;
          }
          setActiveIndex(next);
          itemRefs.current[next]?.focus();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          const last = items.findLastIndex ? items.findLastIndex((i) => !i.disabled) : items.length - 1;
          setActiveIndex(last >= 0 ? last : items.length - 1);
        } else {
          let prev = (activeIndex - 1 + items.length) % items.length;
          while (items[prev]?.disabled && prev !== activeIndex) {
            prev = (prev - 1 + items.length) % items.length;
          }
          setActiveIndex(prev);
          itemRefs.current[prev]?.focus();
        }
      } else if (e.key === "Home") {
        e.preventDefault();
        const first = items.findIndex((i) => !i.disabled);
        if (first >= 0) {
          setActiveIndex(first);
          itemRefs.current[first]?.focus();
        }
      } else if (e.key === "End") {
        e.preventDefault();
        let last = items.length - 1;
        while (last >= 0 && items[last]?.disabled) {
          last--;
        }
        if (last >= 0) {
          setActiveIndex(last);
          itemRefs.current[last]?.focus();
        }
      }
    };

    return (
      <div ref={containerRef} className="relative inline-block text-left" onKeyDown={handleKeyDown}>
        <button
          ref={triggerRef || ownTriggerRef}
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen((prev) => {
              if (!prev) {
                const first = items.findIndex((i) => !i.disabled);
                setActiveIndex(first >= 0 ? first : 0);
              }
              return !prev;
            });
          }}
          className="inline-flex h-8.5 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
          aria-haspopup="menu"
          aria-expanded={open}
          id={menuId}
        >
          {icon}
          <span>{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted transition-transform duration-200" />
        </button>

        {open && (
          <div
            className="absolute right-0 z-50 mt-1.5 w-48 max-h-[min(70vh,24rem)] overflow-y-auto origin-top-right rounded-xl border border-border bg-surface p-1.5 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 [scrollbar-width:thin]"
            role="menu"
            aria-labelledby={menuId}
          >
            {items.map((item, idx) => (
              <button
                key={item.id}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  getTrigger()?.focus();
                  item.onSelect();
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                  item.disabled
                    ? "opacity-40 cursor-not-allowed text-muted"
                    : activeIndex === idx
                    ? "bg-primary text-primary-content font-semibold"
                    : "text-foreground hover:bg-surface-hover"
                }`}
              >
                {item.icon && <span className="h-4 w-4 shrink-0">{item.icon}</span>}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
