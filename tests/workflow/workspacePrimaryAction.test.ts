import { describe, expect, test } from "vitest";
import {
  getWorkspacePrimaryAction,
  type WorkspacePrimaryActionInput,
} from "@/lib/workspacePrimaryAction";

const ready: WorkspacePrimaryActionInput = {
  hasPage: true,
  hasCleanResult: false,
  hasTranslation: false,
  hasEnteredReview: false,
  isCleaning: false,
  isTranslating: false,
  workflowPhase: null,
  cancellable: false,
};

describe("getWorkspacePrimaryAction", () => {
  test.each([
    [{ ...ready, hasPage: false }, "disabled", "เตรียมและแปลหน้านี้", true],
    [ready, "prepare-and-translate", "เตรียมและแปลหน้านี้", false],
    [{ ...ready, hasCleanResult: true }, "translate", "แปลหน้านี้", false],
    [{ ...ready, hasTranslation: true }, "review", "ตรวจแก้คำแปล", false],
    [{ ...ready, hasTranslation: true, hasEnteredReview: true }, "export", "ส่งออก", false],
    [{ ...ready, isCleaning: true, workflowPhase: "cleaning" }, "busy", "กำลังคลีน…", true],
    [{ ...ready, isTranslating: true, workflowPhase: "translating" }, "busy", "กำลังแปล…", true],
  ] as const)("derives %#", (input, kind, label, disabled) => {
    expect(getWorkspacePrimaryAction(input)).toMatchObject({ kind, label, disabled });
  });

  test("only exposes cancel while busy and cancellation is supported", () => {
    expect(getWorkspacePrimaryAction({
      ...ready,
      isTranslating: true,
      workflowPhase: "translating",
      cancellable: true,
    }).cancellable).toBe(true);
  });
});
