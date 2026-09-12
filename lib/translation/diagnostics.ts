/**
 * Canonical Diagnostic Taxonomy & Action Matrix for Translation Failures
 * Ticket 02 & 03: Structured Translation Error Taxonomy & Diagnostic Actions
 */

export type DiagnosticErrorCode =
  | "MISSING_KEY"
  | "QUOTA_EXHAUSTED"
  | "SAFETY_BLOCKED"
  | "LOCAL_SIDECAR_OFFLINE"
  | "LOCAL_CLEANER_FAILED"
  | "IMAGE_LOAD_FAILED"
  | "NETWORK_OR_TIMEOUT"
  | "PROVIDER_RESPONSE_INVALID"
  | "CLEANING_REVIEW_REQUIRED"
  | "UNKNOWN_ERROR";

export type DiagnosticActionType =
  | "open_settings_api_key"
  | "enable_nsfw_bypass"
  | "retry_cooldown"
  | "restart_cleaner"
  | "retry_failed";

export interface DiagnosticDetail {
  code: DiagnosticErrorCode;
  title: string;
  description: string;
  recommendedAction: DiagnosticActionType;
  actionLabel: string;
  retryable: boolean;
}

export const DIAGNOSTIC_TAXONOMY: Record<DiagnosticErrorCode, DiagnosticDetail> = {
  CLEANING_REVIEW_REQUIRED: {
    code: "CLEANING_REVIEW_REQUIRED",
    title: "หน้ารอการตรวจสอบคุณภาพการลบคำพูด (Awaiting Review)",
    description:
      "ระบบลบข้อความในหน้าเหล่านี้เรียบร้อยแล้ว แต่ตรวจพบฉากหลังที่ซับซ้อนหรือเอฟเฟกต์ SFX ที่แนะนำให้ตรวจสอบ หรือสามารถกดยืนยันเพื่อดำเนินการแปลต่อทันที",
    recommendedAction: "retry_failed",
    actionLabel: "ยืนยันและดำเนินการแปลต่อ",
    retryable: true,
  },
  MISSING_KEY: {
    code: "MISSING_KEY",
    title: "ยังไม่ได้ระบุ Gemini API Key",
    description:
      "เซิร์ฟเวอร์และตัวโปรแกรมไม่พบ API Key สำหรับเชื่อมต่อแปลภาษา กรุณากรอก Gemini API Key ฟรีจาก Google AI Studio ในหน้าการตั้งค่า",
    recommendedAction: "open_settings_api_key",
    actionLabel: "เปิดหน้าตั้งค่า API Key",
    retryable: false,
  },
  QUOTA_EXHAUSTED: {
    code: "QUOTA_EXHAUSTED",
    title: "โควต้าคำขอเต็มชั่วคราว (Rate Limit 429)",
    description:
      "จำนวนคำขอแปลภาษาเกินขีดจำกัดโควต้าฟรีของ Google ชั่วคราว ระบบแนะนำให้รอคูลดาวน์ประมาณ 1 นาที หรือเพิ่ม API Key สำรองเพื่อสลับคีย์อัตโนมัติ",
    recommendedAction: "retry_cooldown",
    actionLabel: "นับถอยหลังลองใหม่อัตโนมัติ",
    retryable: true,
  },
  SAFETY_BLOCKED: {
    code: "SAFETY_BLOCKED",
    title: "ภาพติดระบบคัดกรองเนื้อหา (Safety Filter)",
    description:
      "Google Gemini ปฏิเสธการประมวลผลเนื่องจากตรวจพบลักษณะภาพสุ่มเสี่ยง/18+ สามารถแก้ไขได้โดยเปิดโหมด Comic Slicing (NSFW Bypass) เพื่อตัดแบ่งภาพก่อนส่ง",
    recommendedAction: "enable_nsfw_bypass",
    actionLabel: "เปิดโหมด NSFW Bypass แล้วลองใหม่",
    retryable: true,
  },
  LOCAL_SIDECAR_OFFLINE: {
    code: "LOCAL_SIDECAR_OFFLINE",
    title: "ระบบคลีนภาพบนเครื่องไม่ตอบสนอง",
    description:
      "ไม่สามารถเชื่อมต่อกับ Python Inpainting Service บนเครื่องได้ กรุณาตรวจสอบหรือกู้คืน Cleaner ก่อนลองหน้าที่ได้รับผลกระทบใหม่",
    recommendedAction: "restart_cleaner",
    actionLabel: "กู้คืน Cleaner",
    retryable: true,
  },
  LOCAL_CLEANER_FAILED: {
    code: "LOCAL_CLEANER_FAILED",
    title: "Cleaner หรือโมเดลประมวลผลไม่สำเร็จ",
    description:
      "บริการคลีนบนเครื่องยังตอบสนอง แต่ Cleaner หรือโมเดลที่เลือกโหลดหรือประมวลผลไม่สำเร็จ กรุณาตรวจสอบโมเดล/Runtime แล้วลองหน้ากลุ่มนี้ใหม่",
    recommendedAction: "retry_failed",
    actionLabel: "ลองหน้ากลุ่มนี้ใหม่",
    retryable: true,
  },
  IMAGE_LOAD_FAILED: {
    code: "IMAGE_LOAD_FAILED",
    title: "โหลดภาพสำหรับแปลไม่สำเร็จ",
    description:
      "ระบบไม่สามารถอ่านภาพต้นฉบับหรือภาพที่เตรียมไว้สำหรับการแปลได้ อาจเกิดจาก Blob/ไฟล์ภาพหมดอายุหรือโหลดไม่ทัน กรุณาลองหน้ากลุ่มนี้ใหม่ หากยังเกิดซ้ำให้เปิดโครงการหรือไฟล์ภาพใหม่อีกครั้ง",
    recommendedAction: "retry_failed",
    actionLabel: "ลองโหลดและแปลใหม่",
    retryable: true,
  },
  NETWORK_OR_TIMEOUT: {
    code: "NETWORK_OR_TIMEOUT",
    title: "การเชื่อมต่อหรือบริการ AI ขัดข้อง",
    description:
      "การส่งข้อมูลไปยังเซิร์ฟเวอร์หมดเวลา การเชื่อมต่ออินเทอร์เน็ตขัดข้อง หรือบริการ AI ต้นทางตอบกลับผิดพลาดชั่วคราว กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง",
    recommendedAction: "retry_failed",
    actionLabel: "ลองส่งใหม่อีกครั้ง",
    retryable: true,
  },
  PROVIDER_RESPONSE_INVALID: {
    code: "PROVIDER_RESPONSE_INVALID",
    title: "AI ตอบกลับมาในรูปแบบไม่สมบูรณ์",
    description:
      "ระบบ AI ตอบกลับมาแล้ว แต่ข้อมูล JSON หรือรายการกล่องข้อความไม่ครบตามรูปแบบที่ SuperK ต้องใช้ ปัญหานี้มักเกิดเป็นบางหน้าและสามารถลองส่งหน้านั้นใหม่ได้",
    recommendedAction: "retry_failed",
    actionLabel: "ลองหน้ากลุ่มนี้ใหม่",
    retryable: true,
  },
  UNKNOWN_ERROR: {
    code: "UNKNOWN_ERROR",
    title: "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ",
    description: "การประมวลผลไม่สำเร็จ กรุณาลองใหม่อีกครั้งหรือตรวจสอบบันทึกข้อผิดพลาด",
    recommendedAction: "retry_failed",
    actionLabel: "ลองใหม่อีกครั้ง",
    retryable: true,
  },
};

/**
 * Classifies an arbitrary error or response status into the canonical diagnostic taxonomy.
 */
export function classifyTranslationError(
  errorOrMessage: unknown,
  status?: number,
  explicitCode?: string,
): DiagnosticDetail {
  const codeStr = explicitCode ? String(explicitCode).toUpperCase() : "";
  const rawMsg =
    errorOrMessage instanceof Error
      ? errorOrMessage.message
      : typeof errorOrMessage === "string"
      ? errorOrMessage
      : "";

  const msg = rawMsg.toLowerCase();

  // 1. Explicit codes
  if (codeStr === "MISSING_KEY" || codeStr === "AUTH") {
    return DIAGNOSTIC_TAXONOMY.MISSING_KEY;
  }
  if (codeStr === "SAFETY_BLOCKED" || codeStr === "SAFETY") {
    return DIAGNOSTIC_TAXONOMY.SAFETY_BLOCKED;
  }
  if (codeStr === "QUOTA_EXHAUSTED" || codeStr === "GEMINI_QUOTA" || codeStr === "QUOTA") {
    return DIAGNOSTIC_TAXONOMY.QUOTA_EXHAUSTED;
  }
  if (codeStr === "LOCAL_SIDECAR_OFFLINE") {
    return DIAGNOSTIC_TAXONOMY.LOCAL_SIDECAR_OFFLINE;
  }
  if (codeStr === "LOCAL_CLEANER_FAILED") {
    return DIAGNOSTIC_TAXONOMY.LOCAL_CLEANER_FAILED;
  }
  if (codeStr === "IMAGE_LOAD_FAILED") {
    return DIAGNOSTIC_TAXONOMY.IMAGE_LOAD_FAILED;
  }
  if (codeStr === "NETWORK_OR_TIMEOUT" || codeStr === "GEMINI_TIMEOUT" || codeStr === "TIMEOUT") {
    return DIAGNOSTIC_TAXONOMY.NETWORK_OR_TIMEOUT;
  }
  if (codeStr === "PROVIDER_RESPONSE_INVALID" || codeStr === "MALFORMED_RESPONSE") {
    return DIAGNOSTIC_TAXONOMY.PROVIDER_RESPONSE_INVALID;
  }
  if (codeStr === "CLEANING_REVIEW_REQUIRED" || codeStr === "AWAITING_REVIEW") {
    return DIAGNOSTIC_TAXONOMY.CLEANING_REVIEW_REQUIRED;
  }

  // 2. Status codes
  if (status === 401 || status === 403) {
    return DIAGNOSTIC_TAXONOMY.MISSING_KEY;
  }
  if (status === 422) {
    return DIAGNOSTIC_TAXONOMY.CLEANING_REVIEW_REQUIRED;
  }
  if (status === 429) {
    return DIAGNOSTIC_TAXONOMY.QUOTA_EXHAUSTED;
  }
  if (status === 504) {
    return DIAGNOSTIC_TAXONOMY.NETWORK_OR_TIMEOUT;
  }

  // 3. Message heuristics
  if (
    msg.includes("api key") ||
    msg.includes("missing api key") ||
    msg.includes("api_key")
  ) {
    return DIAGNOSTIC_TAXONOMY.MISSING_KEY;
  }
  if (
    msg.includes("safety") ||
    msg.includes("คัดกรอง") ||
    msg.includes("แบนโดยระบบ safety") ||
    msg.includes("prohibited_content") ||
    msg.includes("blockreason")
  ) {
    return DIAGNOSTIC_TAXONOMY.SAFETY_BLOCKED;
  }
  if (
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("โควต้า")
  ) {
    return DIAGNOSTIC_TAXONOMY.QUOTA_EXHAUSTED;
  }
  if (
    msg.includes("8765") ||
    msg.includes("คลีนได้") ||
    msg.includes("sidecar") ||
    msg.includes("econnrefused") ||
    msg.includes("เซิร์ฟเวอร์คลีน")
  ) {
    return DIAGNOSTIC_TAXONOMY.LOCAL_SIDECAR_OFFLINE;
  }
  if (
    msg.includes("cleaner") ||
    msg.includes("model load") ||
    msg.includes("model failed") ||
    msg.includes("inference") ||
    msg.includes("onnx") ||
    msg.includes("runtime")
  ) {
    return DIAGNOSTIC_TAXONOMY.LOCAL_CLEANER_FAILED;
  }
  if (
    msg.includes("โหลดรูปภาพไม่สำเร็จ") ||
    msg.includes("ไม่สามารถโหลดรูปภาพได้") ||
    msg.includes("image constructor unavailable") ||
    msg.includes("failed to load image")
  ) {
    return DIAGNOSTIC_TAXONOMY.IMAGE_LOAD_FAILED;
  }
  if (
    msg.includes("malformed") ||
    msg.includes("invalid json") ||
    msg.includes("bubbles array missing") ||
    msg.includes("unexpected format") ||
    msg.includes("provider response invalid")
  ) {
    return DIAGNOSTIC_TAXONOMY.PROVIDER_RESPONSE_INVALID;
  }
  if (
    msg.includes("timeout") ||
    msg.includes("ช้าเกินกำหนด") ||
    msg.includes("network") ||
    msg.includes("fetch failed") ||
    msg.includes("หมดเวลา")
  ) {
    return DIAGNOSTIC_TAXONOMY.NETWORK_OR_TIMEOUT;
  }
  if (
    msg.includes("awaiting review") ||
    msg.includes("cleaning verification") ||
    msg.includes("needs_review") ||
    msg.includes("รอการตรวจสอบ")
  ) {
    return DIAGNOSTIC_TAXONOMY.CLEANING_REVIEW_REQUIRED;
  }

  // Generic provider/transport fallbacks come after specific message checks so
  // a useful cause such as "missing API key" is never hidden by a generic 5xx.
  if (
    codeStr === "NETWORK" ||
    codeStr === "UPSTREAM" ||
    codeStr === "GEMINI_UPSTREAM" ||
    codeStr === "MODEL_UNAVAILABLE"
  ) {
    return DIAGNOSTIC_TAXONOMY.NETWORK_OR_TIMEOUT;
  }
  if (status === 500 || status === 502 || status === 503) {
    return DIAGNOSTIC_TAXONOMY.NETWORK_OR_TIMEOUT;
  }

  return DIAGNOSTIC_TAXONOMY.UNKNOWN_ERROR;
}
