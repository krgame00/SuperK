"use client";

import type { ReactElement, RefObject } from "react";
import {
  Eraser,
  Paintbrush,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Wrench,
  ClipboardCheck,
} from "lucide-react";

import { WorkspaceMenu, type WorkspaceMenuItem } from "@/components/workspace/WorkspaceMenu";

export interface WorkspaceAdvancedToolsProps {
  canClean: boolean;
  canEditMask: boolean;
  busy: boolean;
  batchFailureCount: number;
  contaminatedPageCount: number;
  onClean: () => void;
  onEditMask: () => void;
  onTranslateBook: () => void;
  onTranslateCurrent?: () => void;
  onOrganizeAllPages?: () => void;
  canOrganizeAll?: boolean;
  onRetryFailedPages: () => void;
  onScanTranslations: () => void;
  onRetranslateContaminated: () => void;
  onOpenExportReport: () => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function WorkspaceAdvancedTools({
  canClean,
  canEditMask,
  busy,
  batchFailureCount,
  contaminatedPageCount,
  onClean,
  onEditMask,
  onTranslateBook,
  onTranslateCurrent,
  onOrganizeAllPages,
  canOrganizeAll = true,
  onRetryFailedPages,
  onScanTranslations,
  onRetranslateContaminated,
  onOpenExportReport,
  triggerRef,
}: WorkspaceAdvancedToolsProps): ReactElement {
  const items: WorkspaceMenuItem[] = [
    ...(onTranslateCurrent
      ? [
          {
            id: "translate-current",
            label: "แปลหน้านี้ใหม่",
            icon: <Sparkles className="h-4 w-4 text-primary" />,
            disabled: busy || !canClean,
            onSelect: onTranslateCurrent,
          },
        ]
      : []),
    {
      id: "translate-book",
      label: "แปลทั้งเล่ม",
      icon: <Sparkles className="h-4 w-4 text-primary" />,
      disabled: busy,
      onSelect: onTranslateBook,
    },
    ...(onOrganizeAllPages
      ? [
          {
            id: "organize-all-pages",
            label: "จัดระเบียบคำแปลทุกหน้า",
            icon: <Sparkles className="h-4 w-4 text-primary" />,
            disabled: busy || !canOrganizeAll,
            onSelect: onOrganizeAllPages,
          },
        ]
      : []),
    {
      id: "clean",
      label: "คลีนข้อความใหม่",
      icon: <Eraser className="h-4 w-4 text-primary" />,
      disabled: !canClean || busy,
      onSelect: onClean,
    },
    {
      id: "export-report",
      label: "รายงานก่อนส่งออก",
      icon: <ClipboardCheck className="h-4 w-4 text-primary" />,
      disabled: busy,
      onSelect: onOpenExportReport,
    },
    ...(contaminatedPageCount > 0
      ? [
          {
            id: "retranslate-contaminated",
            label: `แปลใหม่ ${contaminatedPageCount} หน้า (ตัวอักษรปน)`,
            icon: <RotateCcw className="h-4 w-4 text-amber-400" />,
            disabled: busy,
            onSelect: onRetranslateContaminated,
          },
        ]
      : [
          {
            id: "scan-translations",
            label: "ตรวจคำแปลทั้งเล่ม",
            icon: <ScanSearch className="h-4 w-4 text-primary" />,
            disabled: busy,
            onSelect: onScanTranslations,
          },
        ]),
    {
      id: "edit-mask",
      label: "แก้ Mask",
      icon: <Paintbrush className="h-4 w-4 text-primary" />,
      disabled: !canEditMask || busy,
      onSelect: onEditMask,
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
      label="เครื่องมือ"
      disabled={busy}
      triggerRef={triggerRef}
      icon={<Wrench className="h-3.5 w-3.5 text-muted" aria-hidden="true" />}
      items={items}
    />
  );
}
