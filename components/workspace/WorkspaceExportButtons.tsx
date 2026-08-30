import type { ReactElement } from "react";
import {
  Archive,
  BookOpen,
  FileText,
  ImageDown,
  Rows3,
} from "lucide-react";

import type { WorkspaceExportKind } from "@/components/workspace/WorkspaceExportMenu";

export interface WorkspaceExportButtonsProps {
  disabled?: boolean;
  disabledKinds?: Partial<Record<WorkspaceExportKind, boolean>>;
  onExport: (kind: WorkspaceExportKind) => void;
}

export const EXPORT_ACTIONS = [
  {
    kind: "image" as const,
    label: "รูปหน้านี้",
    accessibleName: "ดาวน์โหลดรูปหน้านี้",
    icon: ImageDown,
  },
  {
    kind: "pdf" as const,
    label: "PDF",
    accessibleName: "ดาวน์โหลด PDF",
    icon: FileText,
  },
  {
    kind: "strip" as const,
    label: "Strip",
    accessibleName: "ดาวน์โหลด Strip",
    icon: Rows3,
  },
  {
    kind: "zip" as const,
    label: "ZIP",
    accessibleName: "ดาวน์โหลด ZIP",
    icon: Archive,
  },
  {
    kind: "cbz" as const,
    label: "CBZ",
    accessibleName: "ดาวน์โหลด CBZ",
    icon: BookOpen,
  },
] as const;

export function WorkspaceExportButtons({
  disabled = false,
  disabledKinds = {},
  onExport,
}: WorkspaceExportButtonsProps): ReactElement {
  return (
    <div
      role="group"
      aria-label="ตัวเลือกการส่งออก"
      className="flex-shrink-0 flex items-center bg-surface rounded-lg border border-border overflow-hidden shadow-xs"
    >
      {EXPORT_ACTIONS.map(({ kind, label, accessibleName, icon: Icon }, index) => {
        const isActionDisabled = disabled || Boolean(disabledKinds[kind]);
        const isLast = index === EXPORT_ACTIONS.length - 1;
        return (
          <button
            key={kind}
            type="button"
            disabled={isActionDisabled}
            aria-label={accessibleName}
            title={accessibleName}
            onClick={() => onExport(kind)}
            className={`h-8.5 flex items-center gap-1.5 px-3 text-xs font-semibold text-foreground transition-all duration-150 hover:bg-surface-hover hover:text-white active:bg-surface-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none ${
              !isLast ? "border-r border-border" : ""
            }`}
          >
            <Icon className="h-3.5 w-3.5 text-muted shrink-0" aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
