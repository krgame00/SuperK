export type WorkspacePrimaryActionKind =
  | "disabled"
  | "prepare-and-translate"
  | "translate"
  | "review"
  | "export"
  | "busy";

export interface WorkspacePrimaryActionState {
  kind: WorkspacePrimaryActionKind;
  label: string;
  disabled: boolean;
  cancellable: boolean;
}

export interface WorkspacePrimaryActionInput {
  hasPage: boolean;
  hasCleanResult: boolean;
  hasTranslation: boolean;
  hasEnteredReview: boolean;
  isCleaning: boolean;
  isTranslating: boolean;
  workflowPhase: "cleaning" | "translating" | null;
  cancellable: boolean;
}

export function getWorkspacePrimaryAction(
  input: WorkspacePrimaryActionInput,
): WorkspacePrimaryActionState {
  if (input.isCleaning || input.isTranslating) {
    const cleaning = input.workflowPhase === "cleaning" || input.isCleaning;
    return {
      kind: "busy",
      label: cleaning ? "กำลังคลีน…" : "กำลังแปล…",
      disabled: true,
      cancellable: input.cancellable,
    };
  }
  if (!input.hasPage) {
    return {
      kind: "disabled",
      label: "เตรียมและแปลหน้านี้",
      disabled: true,
      cancellable: false,
    };
  }
  if (input.hasTranslation) {
    return input.hasEnteredReview
      ? { kind: "export", label: "ส่งออก", disabled: false, cancellable: false }
      : { kind: "review", label: "ตรวจแก้คำแปล", disabled: false, cancellable: false };
  }
  if (input.hasCleanResult) {
    return {
      kind: "translate",
      label: "แปลหน้านี้",
      disabled: false,
      cancellable: false,
    };
  }
  return {
    kind: "prepare-and-translate",
    label: "เตรียมและแปลหน้านี้",
    disabled: false,
    cancellable: false,
  };
}
