import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { WorkspaceAdvancedTools } from "@/components/workspace/WorkspaceAdvancedTools";
import { WorkspaceExportMenu } from "@/components/workspace/WorkspaceExportMenu";
import { WorkspacePrimaryAction } from "@/components/workspace/WorkspacePrimaryAction";

describe("WorkspaceControls", () => {
  test("renders one dominant action and dispatches its current state", () => {
    const onAction = vi.fn();
    render(
      <WorkspacePrimaryAction
        state={{ kind: "review", label: "ตรวจแก้คำแปล", disabled: false, cancellable: false }}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "ตรวจแก้คำแปล" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  test("announces busy state and exposes cancel only when supported", () => {
    const onCancel = vi.fn();
    render(
      <WorkspacePrimaryAction
        state={{ kind: "busy", label: "กำลังแปล…", disabled: true, cancellable: true }}
        onAction={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("กำลังแปล");
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test("export menu contains every existing format", () => {
    const onExport = vi.fn();
    render(<WorkspaceExportMenu disabled={false} onExport={onExport} />);
    const trigger = screen.getByRole("button", { name: "ส่งออก" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    for (const name of ["รูปภาพหน้านี้", "PDF", "Strip", "ZIP", "CBZ"]) {
      expect(screen.getByRole("menuitem", { name })).toBeVisible();
    }
    fireEvent.click(screen.getByRole("menuitem", { name: "CBZ" }));
    expect(onExport).toHaveBeenCalledWith("cbz");
    expect(trigger).toHaveFocus();
  });

  test("menu closes on Escape and restores trigger focus", () => {
    render(
      <WorkspaceAdvancedTools
        canClean
        canEditMask
        busy={false}
        batchFailureCount={0}
        onClean={vi.fn()}
        onEditMask={vi.fn()}
        onTranslateBook={vi.fn()}
        onRetryFailedPages={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "เครื่องมือขั้นสูง" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
