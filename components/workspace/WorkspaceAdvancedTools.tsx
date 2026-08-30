"use client";

import type { ReactElement, RefObject } from "react";
import {
  Flame,
  GalleryVertical,
  Keyboard,
  RectangleHorizontal,
  RotateCcw,
  Settings,
  Wrench,
} from "lucide-react";

import { WorkspaceMenu } from "@/components/workspace/WorkspaceMenu";

export interface WorkspaceAdvancedToolsProps {
  batchFailures: readonly unknown[];
  onRetryFailedPages: () => void;
  disabled?: boolean;
  nsfwBypassMode: boolean;
  onToggleNsfw: () => void;
  viewLayout: "single" | "scroll";
  onToggleViewLayout: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts?: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function WorkspaceAdvancedTools({
  batchFailures,
  onRetryFailedPages,
  disabled = false,
  nsfwBypassMode,
  onToggleNsfw,
  viewLayout,
  onToggleViewLayout,
  onOpenSettings,
  onOpenShortcuts,
  triggerRef,
}: WorkspaceAdvancedToolsProps): ReactElement {
  const hasFailures = batchFailures.length > 0;

  const items = [
    ...(hasFailures
      ? [
          {
            id: "retry-failed",
            label: `ลองใหม่ ${batchFailures.length} หน้าที่พลาด`,
            icon: <RotateCcw className="h-4 w-4 text-amber-400" />,
            disabled,
            onSelect: onRetryFailedPages,
          },
        ]
      : []),
    {
      id: "nsfw-toggle",
      label: nsfwBypassMode ? "โหมด 18+ (เปิดอยู่)" : "โหมด 18+ หั่นภาพ",
      icon: <Flame className="h-4 w-4 text-red-400" />,
      disabled,
      onSelect: onToggleNsfw,
    },
    {
      id: "layout-toggle",
      label: viewLayout === "scroll" ? "เปลี่ยนเป็นโหมดทีละหน้า" : "เปลี่ยนเป็นโหมดเลื่อนอ่าน",
      icon:
        viewLayout === "scroll" ? (
          <RectangleHorizontal className="h-4 w-4" />
        ) : (
          <GalleryVertical className="h-4 w-4" />
        ),
      disabled,
      onSelect: onToggleViewLayout,
    },
    {
      id: "settings",
      label: "ตั้งค่า API & ฟอนต์",
      icon: <Settings className="h-4 w-4" />,
      onSelect: onOpenSettings,
    },
    ...(onOpenShortcuts
      ? [
          {
            id: "shortcuts",
            label: "ดูคีย์ลัด (Shortcuts)",
            icon: <Keyboard className="h-4 w-4" />,
            onSelect: onOpenShortcuts,
          },
        ]
      : []),
  ];

  return (
    <WorkspaceMenu
      label="เครื่องมือ"
      disabled={disabled}
      triggerRef={triggerRef}
      icon={<Wrench className="h-3.5 w-3.5 text-muted" aria-hidden="true" />}
      items={items}
    />
  );
}
