"use client";

import type { ReactElement, RefObject } from "react";
import {
  Eraser,
  Paintbrush,
  RotateCcw,
  Sparkles,
  Wrench,
} from "lucide-react";

import { WorkspaceMenu, type WorkspaceMenuItem } from "@/components/workspace/WorkspaceMenu";

export interface WorkspaceAdvancedToolsProps {
  canClean: boolean;
  canEditMask: boolean;
  busy: boolean;
  batchFailureCount: number;
  onClean: () => void;
  onEditMask: () => void;
  onTranslateBook: () => void;
  onRetryFailedPages: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function WorkspaceAdvancedTools({
  canClean,
  canEditMask,
  busy,
  batchFailureCount,
  onClean,
  onEditMask,
  onTranslateBook,
  onRetryFailedPages,
  triggerRef,
}: WorkspaceAdvancedToolsProps): ReactElement {
  const items: WorkspaceMenuItem[] = [
    {
      id: "clean",
      label: "คลีนข้อความใหม่",
      icon: <Eraser className="h-4 w-4 text-primary" />,
      disabled: !canClean || busy,
      onSelect: onClean,
    },
    {
      id: "edit-mask",
      label: "แก้ Mask",
      icon: <Paintbrush className="h-4 w-4 text-primary" />,
      disabled: !canEditMask || busy,
      onSelect: onEditMask,
    },
    {
      id: "translate-book",
      label: "แปลทั้งเล่ม",
      icon: <Sparkles className="h-4 w-4 text-primary" />,
      disabled: busy,
      onSelect: onTranslateBook,
    },
    ...(batchFailureCount > 0
      ? [
          {
            id: "retry-failed",
            label: `ลองใหม่ ${batchFailureCount} หน้าที่พลาด`,
            icon: <RotateCcw className="h-4 w-4 text-amber-400" />,
            disabled: busy,
            onSelect: onRetryFailedPages,
          },
        ]
      : []),
  ];

  return (
    <WorkspaceMenu
      label="เครื่องมือขั้นสูง"
      disabled={busy}
      triggerRef={triggerRef}
      icon={<Wrench className="h-3.5 w-3.5 text-muted" aria-hidden="true" />}
      items={items}
    />
  );
}
