import type { ReactElement, RefObject } from "react";
import {
  Archive,
  BookOpen,
  FileText,
  ImageDown,
  Rows3,
  Wand2,
} from "lucide-react";

import { WorkspaceMenu } from "@/components/workspace/WorkspaceMenu";

export type WorkspaceExportKind = "image" | "pdf" | "strip" | "zip" | "cbz";

interface WorkspaceExportMenuProps {
  disabled: boolean;
  disabledKinds?: Partial<Record<WorkspaceExportKind, boolean>>;
  onExport: (kind: WorkspaceExportKind) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  variant?: "default" | "primary";
}

export function WorkspaceExportMenu({
  disabled,
  disabledKinds = {},
  onExport,
  triggerRef,
  variant = "default",
}: WorkspaceExportMenuProps): ReactElement {
  const kinds: WorkspaceExportKind[] = ["image", "pdf", "strip", "zip", "cbz"];
  const allKindsDisabled = kinds.every((kind) => disabledKinds[kind]);

  return (
    <WorkspaceMenu
      label="ส่งออก"
      variant={variant}
      icon={
        variant === "primary" ? (
          <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
        ) : undefined
      }
      disabled={disabled || allKindsDisabled}
      triggerRef={triggerRef}
      items={[
        {
          id: "image",
          label: "รูปภาพหน้านี้",
          icon: <ImageDown className="h-4 w-4" />,
          disabled: disabled || disabledKinds.image,
          onSelect: () => onExport("image"),
        },
        {
          id: "pdf",
          label: "PDF",
          icon: <FileText className="h-4 w-4" />,
          disabled: disabled || disabledKinds.pdf,
          onSelect: () => onExport("pdf"),
        },
        {
          id: "strip",
          label: "Strip",
          icon: <Rows3 className="h-4 w-4" />,
          disabled: disabled || disabledKinds.strip,
          onSelect: () => onExport("strip"),
        },
        {
          id: "zip",
          label: "ZIP",
          icon: <Archive className="h-4 w-4" />,
          disabled: disabled || disabledKinds.zip,
          onSelect: () => onExport("zip"),
        },
        {
          id: "cbz",
          label: "CBZ",
          icon: <BookOpen className="h-4 w-4" />,
          disabled: disabled || disabledKinds.cbz,
          onSelect: () => onExport("cbz"),
        },
      ]}
    />
  );
}
