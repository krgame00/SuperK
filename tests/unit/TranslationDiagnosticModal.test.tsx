import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import {
  TranslationDiagnosticModal,
  type DiagnosticFailureGroup,
} from "../../components/workspace/TranslationDiagnosticModal";
import { DIAGNOSTIC_TAXONOMY } from "../../lib/translation/diagnostics";

describe("TranslationDiagnosticModal", () => {
  it("renders failure groups with affected page numbers", () => {
    const groups: DiagnosticFailureGroup[] = [
      {
        diagnostic: DIAGNOSTIC_TAXONOMY.MISSING_KEY,
        pages: [1, 3],
      },
      {
        diagnostic: DIAGNOSTIC_TAXONOMY.SAFETY_BLOCKED,
        pages: [5],
      },
    ];

    render(
      <TranslationDiagnosticModal
        isOpen={true}
        onClose={vi.fn()}
        failureGroups={groups}
      />
    );

    expect(screen.getByText("รายงานสาเหตุการแปลไม่สำเร็จ")).toBeDefined();
    expect(screen.getByText("ยังไม่ได้ระบุ Gemini API Key")).toBeDefined();
    expect(screen.getByText("หน้า 1")).toBeDefined();
    expect(screen.getByText("หน้า 3")).toBeDefined();
    expect(screen.getByText("หน้า 5")).toBeDefined();
  });

  it("triggers action button callback when clicked", () => {
    const onOpenSettingsApiKey = vi.fn();
    const onClose = vi.fn();

    const groups: DiagnosticFailureGroup[] = [
      {
        diagnostic: DIAGNOSTIC_TAXONOMY.MISSING_KEY,
        pages: [2],
      },
    ];

    render(
      <TranslationDiagnosticModal
        isOpen={true}
        onClose={onClose}
        failureGroups={groups}
        onOpenSettingsApiKey={onOpenSettingsApiKey}
      />
    );

    const btn = screen.getByRole("button", { name: /เปิดหน้าตั้งค่า API Key/i });
    fireEvent.click(btn);

    expect(onClose).toHaveBeenCalled();
    expect(onOpenSettingsApiKey).toHaveBeenCalled();
  });
});
