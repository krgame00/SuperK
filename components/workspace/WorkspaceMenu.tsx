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

interface WorkspaceMenuProps {
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        (triggerRef?.current || ownTriggerRef.current)?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(0);
        } else {
          setActiveIndex((prev) => (prev + 1) % items.length);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(items.length - 1);
        } else {
          setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
        }
      }
    };

    return (
      <div ref={containerRef} className="relative inline-block text-left" onKeyDown={handleKeyDown}>
        <button
          ref={triggerRef || ownTriggerRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-hover bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
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
            className="absolute right-0 z-50 mt-1.5 w-48 origin-top-right rounded-xl border border-surface-hover bg-surface p-1.5 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
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
                  item.onSelect();
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                  item.disabled
                    ? "opacity-40 cursor-not-allowed text-muted"
                    : activeIndex === idx
                    ? "bg-primary text-white"
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
