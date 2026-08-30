import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { WorkspaceAdvancedTools } from "@/components/workspace/WorkspaceAdvancedTools";
import { WorkspaceExportMenu } from "@/components/workspace/WorkspaceExportMenu";
import { WorkspacePrimaryAction } from "@/components/workspace/WorkspacePrimaryAction";

describe("WorkspaceControls Task 9 Verification", () => {
  test("at compact presentation, exactly one enabled primary workflow button is accessible", () => {
    render(
      <WorkspacePrimaryAction
        isTranslating={false}
        isTranslatingAll={false}
        onTranslateCurrent={vi.fn()}
        onTranslateBook={vi.fn()}
        onCancelTranslateAll={vi.fn()}
        compact
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("แปลหน้านี้");
  });

  test("advanced and export triggers expose aria-expanded and open interactive menus", () => {
    const onExport = vi.fn();
    const onRetryFailed = vi.fn();

    render(
      <div>
        <WorkspaceAdvancedTools
          batchFailures={[2, 3]}
          onRetryFailedPages={onRetryFailed}
          nsfwBypassMode={false}
          onToggleNsfw={vi.fn()}
          viewLayout="single"
          onToggleViewLayout={vi.fn()}
          onOpenSettings={vi.fn()}
        />
        <WorkspaceExportMenu
          disabled={false}
          onExport={onExport}
        />
      </div>,
    );

    const toolsTrigger = screen.getByRole("button", { name: /เครื่องมือ/i });
    const exportTrigger = screen.getByRole("button", { name: /ส่งออก/i });

    expect(toolsTrigger).toHaveAttribute("aria-expanded", "false");
    expect(exportTrigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toolsTrigger);
    expect(toolsTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /ลองใหม่ 2 หน้าที่พลาด/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /ลองใหม่ 2 หน้าที่พลาด/i }));
    expect(onRetryFailed).toHaveBeenCalledOnce();
  });

  test("batch partial failure keeps the export action enabled for successful pages", () => {
    const onExport = vi.fn();

    render(
      <WorkspaceExportMenu
        disabled={false}
        disabledKinds={{
          image: false,
          pdf: true,
          strip: true,
          zip: true,
          cbz: true,
        }}
        onExport={onExport}
      />,
    );

    const exportTrigger = screen.getByRole("button", { name: /ส่งออก/i });
    expect(exportTrigger).not.toBeDisabled();

    fireEvent.click(exportTrigger);
    const imageOption = screen.getByRole("menuitem", { name: /รูปภาพหน้านี้/i });
    expect(imageOption).not.toBeDisabled();

    fireEvent.click(imageOption);
    expect(onExport).toHaveBeenCalledWith("image");
  });

  test("ongoing progress renders with role status and aria-live polite", () => {
    render(
      <WorkspacePrimaryAction
        isTranslating={false}
        isTranslatingAll={true}
        translateAllProgress={{
          current: 3,
          total: 10,
          message: "กำลังแปลหน้า 3...",
        }}
        onTranslateCurrent={vi.fn()}
        onTranslateBook={vi.fn()}
        onCancelTranslateAll={vi.fn()}
      />,
    );

    const statusRegion = screen.getByRole("status");
    expect(statusRegion).toHaveAttribute("aria-live", "polite");
    expect(statusRegion).toHaveTextContent("30%");
    expect(statusRegion).toHaveTextContent("กำลังแปลหน้า 3...");
  });
});
