/**
 * Typography Presets for Manga Dialogue Lettering
 * Domain-modeled styles for authentic speech balloon lettering
 */

import type { TextLayer } from "@/lib/editing/commands";

export type TypographyPresetId =
  | "dialogue"
  | "shout"
  | "whisper"
  | "sfx"
  | "narration";

export interface TypographyPreset {
  id: TypographyPresetId;
  name: string;
  nameTh: string;
  emoji: string;
  description: string;
  style: {
    fontFamily: string;
    isBold: boolean;
    isItalic: boolean;
    color: string;
    strokeColor: string;
    strokeWidth: number;
    align: "left" | "center" | "right";
    boxFill?: string;
    opacity?: number;
  };
}

export const TYPOGRAPHY_PRESETS: readonly TypographyPreset[] = [
  {
    id: "dialogue",
    name: "Dialogue",
    nameTh: "บทพูดปกติ",
    emoji: "💬",
    description: "บทพูดทั่วไปในบอลลูนกลม อ่านง่าย นุ่มนวล",
    style: {
      fontFamily: "Itim, sans-serif",
      isBold: true,
      isItalic: false,
      color: "#000000",
      strokeColor: "#ffffff",
      strokeWidth: 2,
      align: "center",
      boxFill: undefined,
      opacity: 1,
    },
  },
  {
    id: "shout",
    name: "Shout",
    nameTh: "เสียงตะโกน",
    emoji: "⚡",
    description: "บอลลูนหนาม คำอุทาน ตกใจ หรือเสียงทรงพลัง",
    style: {
      fontFamily: "Chakra Petch, sans-serif",
      isBold: true,
      isItalic: false,
      color: "#000000",
      strokeColor: "#ffffff",
      strokeWidth: 4,
      align: "center",
      boxFill: undefined,
      opacity: 1,
    },
  },
  {
    id: "whisper",
    name: "Whisper",
    nameTh: "เสียงกระซิบ",
    emoji: "💭",
    description: "คิดในใจ เสียงกระซิบ หรือคำพูดเบาๆ ในบอลลูนจุดไข่ปลา",
    style: {
      fontFamily: "Mali, sans-serif",
      isBold: false,
      isItalic: true,
      color: "#4b5563",
      strokeColor: "#ffffff",
      strokeWidth: 2,
      align: "center",
      boxFill: undefined,
      opacity: 1,
    },
  },
  {
    id: "sfx",
    name: "Action SFX",
    nameTh: "เอฟเฟกต์ / โชเน็น",
    emoji: "💥",
    description: "เสียงประกอบฉาก ปล่อยท่า หรือตัวอักษรพู่กันแนวแอ็กชัน",
    style: {
      fontFamily: "Sriracha, sans-serif",
      isBold: true,
      isItalic: true,
      color: "#000000",
      strokeColor: "#ffffff",
      strokeWidth: 4,
      align: "center",
      boxFill: undefined,
      opacity: 1,
    },
  },
  {
    id: "narration",
    name: "Narration",
    nameTh: "กล่องบรรยาย",
    emoji: "📜",
    description: "กล่องสี่เหลี่ยมบรรยายฉาก บอกเวลา หรือเสียงคนเล่าเรื่อง",
    style: {
      fontFamily: "Prompt, sans-serif",
      isBold: true,
      isItalic: false,
      color: "#000000",
      strokeColor: "#ffffff",
      strokeWidth: 0,
      align: "center",
      boxFill: "#ffffff",
      opacity: 0.95,
    },
  },
] as const;

export function getTypographyPreset(id: TypographyPresetId): TypographyPreset | undefined {
  return TYPOGRAPHY_PRESETS.find((p) => p.id === id);
}

export function detectActiveTypographyPreset(layer: Partial<TextLayer>): TypographyPresetId | null {
  if (!layer.fontFamily) return null;

  for (const preset of TYPOGRAPHY_PRESETS) {
    const isFontMatch =
      layer.fontFamily.includes(preset.style.fontFamily.split(",")[0]) ||
      (preset.id === "dialogue" && layer.fontFamily === "var(--font-manga)");

    const isBoldMatch = Boolean(layer.isBold) === preset.style.isBold;
    const isItalicMatch = Boolean(layer.isItalic) === preset.style.isItalic;

    if (preset.id === "narration") {
      const hasBoxFill = Boolean(layer.boxFill && layer.boxFill !== "transparent");
      if (isFontMatch && hasBoxFill) return "narration";
    } else if (isFontMatch && isBoldMatch && isItalicMatch) {
      return preset.id;
    }
  }

  return null;
}
