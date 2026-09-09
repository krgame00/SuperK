import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import {
  TranslationDiagnosticModal,
  type DiagnosticFailureGroup,
} from "../../components/workspace/TranslationDiagnosticModal";
import { DIAGNOSTIC_TAXONOMY } from "../../lib/translation/diagnostics";

function group(
  id: string,
  diagnostic: DiagnosticFailureGroup["diagnostic"],
  pages: number[],
  cooldownRemainingSeconds = 0,
): DiagnosticFailureGroup {
  return {
    id,
    diagnostic,
    pages,
    pageIndices: pages.map((page) => page - 1),
    cooldownRemainingSeconds,
  };
}

describe("TranslationDiagnosticModal", () => {
  it("renders stable failure groups with affected page numbers", () => {
    const groups: DiagnosticFailureGroup[] = [
      group("batch-1:MISSING_KEY", DIAGNOSTIC_TAXONOMY.MISSING_KEY, [1, 3]),
      group("batch-1:SAFETY_BLOCKED", DIAGNOSTIC_TAXONOMY.SAFETY_BLOCKED, [5]),
    ];

    render(
      <TranslationDiagnosticModal
        isOpen={true}
        onClose={vi.fn()}
        failureGroups={groups}
      />,
    );

    expect(screen.getByText("รายงานสาเหตุการแปลไม่สำเร็จ")).toBeDefined();
    expect(screen.getByText("ยังไม่ได้ระบุ Gemini API Key")).toBeDefined();
    expect(screen.getByText("หน้า 1")).toBeDefined();
    expect(screen.getByText("หน้า 3")).toBeDefined();
    expect(screen.getByText("หน้า 5")).toBeDefined();
  });

  it("passes the stable group id to API key recovery", () => {
    const onOpenSettingsApiKey = vi.fn();
    const onClose = vi.fn();

    render(
      <TranslationDiagnosticModal
        isOpen={true}
        onClose={onClose}
        failureGroups={[
          group("batch-7:MISSING_KEY", DIAGNOSTIC_TAXONOMY.MISSING_KEY, [2]),
        ]}
        onOpenSettingsApiKey={onOpenSettingsApiKey}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /เปิดหน้าตั้งค่า API Key/i }));

    expect(onClose).toHaveBeenCalled();
    expect(onOpenSettingsApiKey).toHaveBeenCalledWith("batch-7:MISSING_KEY");
  });

  it("passes only the stable group identity to a safety recovery action", () => {
    const onEnable = vi.fn();
    render(
      <TranslationDiagnosticModal
        isOpen={true}
        onClose={vi.fn()}
        failureGroups={[
          group("batch-9:SAFETY_BLOCKED", DIAGNOSTIC_TAXONOMY.SAFETY_BLOCKED, [2, 4]),
        ]}
        onEnableNsfwBypassAndRetry={onEnable}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /NSFW Bypass/i }));
    expect(onEnable).toHaveBeenCalledWith("batch-9:SAFETY_BLOCKED");
  });

  it("keeps quota retry disabled until its owning group cooldown expires", () => {
    const onRetry = vi.fn();
    const quota = group(
      "batch-3:QUOTA_EXHAUSTED",
      DIAGNOSTIC_TAXONOMY.QUOTA_EXHAUSTED,
      [2, 3],
      12,
    );
    const { rerender } = render(
      <TranslationDiagnosticModal
        isOpen={true}
        onClose={vi.fn()}
        failureGroups={[quota]}
        onRetryFailureGroup={onRetry}
      />,
    );

    expect(screen.getByText(/12 วิ/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /ลองแปลหน้าที่ตกหล่นใหม่/i })).toBeNull();

    rerender(
      <TranslationDiagnosticModal
        isOpen={true}
        onClose={vi.fn()}
        failureGroups={[{ ...quota, cooldownRemainingSeconds: 0 }]}
        onRetryFailureGroup={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ลองแปลหน้าที่ตกหล่นใหม่/i }));
    expect(onRetry).toHaveBeenCalledWith("batch-3:QUOTA_EXHAUSTED");
  });

  it("recovers cleaner without retrying pages automatically", () => {
    const onRecoverCleaner = vi.fn();
    const onRetry = vi.fn();
    const offline = group(
      "batch-4:LOCAL_SIDECAR_OFFLINE",
      DIAGNOSTIC_TAXONOMY.LOCAL_SIDECAR_OFFLINE,
      [6],
    );
    const { rerender } = render(
      <TranslationDiagnosticModal
        isOpen={true}
        onClose={vi.fn()}
        failureGroups={[offline]}
        onRecoverCleaner={onRecoverCleaner}
        onRetryFailureGroup={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /กู้คืน Cleaner/i }));
    expect(onRecoverCleaner).toHaveBeenCalledWith("batch-4:LOCAL_SIDECAR_OFFLINE");
    expect(onRetry).not.toHaveBeenCalled();

    rerender(
      <TranslationDiagnosticModal
        isOpen={true}
        onClose={vi.fn()}
        failureGroups={[offline]}
        cleanerRecoveryByGroup={{
          "batch-4:LOCAL_SIDECAR_OFFLINE": { status: "recovered" },
        }}
        onRecoverCleaner={onRecoverCleaner}
        onRetryFailureGroup={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ลองหน้ากลุ่มนี้ใหม่/i }));
    expect(onRetry).toHaveBeenCalledWith("batch-4:LOCAL_SIDECAR_OFFLINE");
  });

  it("shows manual retry after the API key was validated without retrying on validation", () => {
    const onRetry = vi.fn();
    const missingKey = group(
      "batch-5:MISSING_KEY",
      DIAGNOSTIC_TAXONOMY.MISSING_KEY,
      [1, 4],
    );

    render(
      <TranslationDiagnosticModal
        isOpen={true}
        onClose={vi.fn()}
        failureGroups={[missingKey]}
        apiKeyReadyByGroup={{ "batch-5:MISSING_KEY": true }}
        onRetryFailureGroup={onRetry}
      />,
    );

    expect(screen.getByText(/API Key พร้อมใช้งานแล้ว/)).toBeDefined();
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /ลองหน้ากลุ่มนี้ใหม่/i }));
    expect(onRetry).toHaveBeenCalledWith("batch-5:MISSING_KEY");
  });
});
