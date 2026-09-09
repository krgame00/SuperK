export type CleanerRecoveryPhase =
  | "checking"
  | "restarting"
  | "verifying"
  | "recovered"
  | "failed";

export interface CleanerRecoveryResult {
  status: "recovered" | "failed";
  restarted: boolean;
  message?: string;
}

interface SuperKDesktopBridge {
  recoverCleaner: () => Promise<CleanerRecoveryResult>;
  onCleanerRecoveryStatus?: (
    listener: (payload: { status: CleanerRecoveryPhase; message?: string }) => void,
  ) => () => void;
}

declare global {
  interface Window {
    superkDesktop?: SuperKDesktopBridge;
  }
}

export async function recoverDesktopCleaner(
  onStatus?: (status: CleanerRecoveryPhase, message?: string) => void,
): Promise<CleanerRecoveryResult> {
  if (typeof window === "undefined" || !window.superkDesktop?.recoverCleaner) {
    const result: CleanerRecoveryResult = {
      status: "failed",
      restarted: false,
      message:
        "โหมดเว็บไม่สามารถเริ่ม Cleaner ใหม่อัตโนมัติได้ กรุณาเปิด Cleaner service แล้วลองอีกครั้ง",
    };
    onStatus?.("failed", result.message);
    return result;
  }

  const unsubscribe = window.superkDesktop.onCleanerRecoveryStatus?.((payload) => {
    onStatus?.(payload.status, payload.message);
  });

  try {
    return await window.superkDesktop.recoverCleaner();
  } finally {
    unsubscribe?.();
  }
}
