export type MangaFontCategory = "manga" | "dialogue" | "action" | "narration";

export interface BuiltinMangaFont {
  id: string;
  familyName: string;
  cssValue: string;
  cssVar: string;
  label: string;
  category: MangaFontCategory;
  categoryLabel: string;
  sampleText?: string;
}

export interface CustomUploadedFont {
  id: string;
  familyName: string;
  cssValue: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
  createdAt: number;
}

interface StoredCustomFontRecord extends CustomUploadedFont {
  buffer: ArrayBuffer;
}

export const MANGA_FONT_CATEGORIES: Array<{
  id: MangaFontCategory;
  label: string;
}> = [
  { id: "manga", label: "🎨 แนวมังงะ / ลายมือ (Manga & Handwritten)" },
  { id: "dialogue", label: "💬 แนวบทพูดอ่านง่าย / โมเดิร์น (Clean Dialogue)" },
  { id: "action", label: "⚡ แนวแอ็กชัน / ไซไฟ / เสียงเอฟเฟกต์ (Action & SFX)" },
  { id: "narration", label: "📖 แนวบรรยาย / ทางการ (Narration & Serif)" },
];

export const BUILTIN_MANGA_FONTS: BuiltinMangaFont[] = [
  // 🎨 แนวมังงะ / ลายมือ
  {
    id: "itim",
    familyName: "Itim",
    cssValue: "Itim, sans-serif",
    cssVar: "--font-itim",
    label: "Itim (น่ารัก / สบายๆ — ค่าเริ่มต้น)",
    category: "manga",
    categoryLabel: "🎨 แนวมังงะ / ลายมือ (Manga & Handwritten)",
  },
  {
    id: "mali",
    familyName: "Mali",
    cssValue: "Mali, sans-serif",
    cssVar: "--font-mali",
    label: "Mali (ลายมือมังงะใสๆ / โรแมนติก-คอมเมดี้)",
    category: "manga",
    categoryLabel: "🎨 แนวมังงะ / ลายมือ (Manga & Handwritten)",
  },
  {
    id: "sriracha",
    familyName: "Sriracha",
    cssValue: "Sriracha, sans-serif",
    cssVar: "--font-sriracha",
    label: "Sriracha (พู่กันโชเน็น / ตะโกนมีพลัง)",
    category: "manga",
    categoryLabel: "🎨 แนวมังงะ / ลายมือ (Manga & Handwritten)",
  },
  {
    id: "charm",
    familyName: "Charm",
    cssValue: "Charm, sans-serif",
    cssVar: "--font-charm",
    label: "Charm (พู่กันจีนโบราณ / ย้อนยุค / แฟนตาซี)",
    category: "manga",
    categoryLabel: "🎨 แนวมังงะ / ลายมือ (Manga & Handwritten)",
  },
  {
    id: "pattaya",
    familyName: "Pattaya",
    cssValue: "Pattaya, sans-serif",
    cssVar: "--font-pattaya",
    label: "Pattaya (ตัวเขียนหนา / ป้ายร้าน / ชื่อตอน)",
    category: "manga",
    categoryLabel: "🎨 แนวมังงะ / ลายมือ (Manga & Handwritten)",
  },

  // 💬 แนวบทพูดอ่านง่าย / โมเดิร์น
  {
    id: "mitr",
    familyName: "Mitr",
    cssValue: "Mitr, sans-serif",
    cssVar: "--font-mitr",
    label: "Mitr (อ่านง่าย / โมเดิร์น)",
    category: "dialogue",
    categoryLabel: "💬 แนวบทพูดอ่านง่าย / โมเดิร์น (Clean Dialogue)",
  },
  {
    id: "kodchasan",
    familyName: "Kodchasan",
    cssValue: "Kodchasan, sans-serif",
    cssVar: "--font-kodchasan",
    label: "Kodchasan (หัวกลมวัยรุ่น / อ่านสบายตา)",
    category: "dialogue",
    categoryLabel: "💬 แนวบทพูดอ่านง่าย / โมเดิร์น (Clean Dialogue)",
  },
  {
    id: "kanit",
    familyName: "Kanit",
    cssValue: "Kanit, sans-serif",
    cssVar: "--font-kanit",
    label: "Kanit (คมชัด / มาตรฐานซับไทย)",
    category: "dialogue",
    categoryLabel: "💬 แนวบทพูดอ่านง่าย / โมเดิร์น (Clean Dialogue)",
  },
  {
    id: "prompt",
    familyName: "Prompt",
    cssValue: "Prompt, sans-serif",
    cssVar: "--font-prompt",
    label: "Prompt (เรียบคม / สมดุลทุกขนาด)",
    category: "dialogue",
    categoryLabel: "💬 แนวบทพูดอ่านง่าย / โมเดิร์น (Clean Dialogue)",
  },
  {
    id: "bai-jamjuree",
    familyName: "Bai Jamjuree",
    cssValue: "Bai Jamjuree, sans-serif",
    cssVar: "--font-bai-jamjuree",
    label: "Bai Jamjuree (ตัวแคบกระชับ / จุคำได้เยอะ)",
    category: "dialogue",
    categoryLabel: "💬 แนวบทพูดอ่านง่าย / โมเดิร์น (Clean Dialogue)",
  },
  {
    id: "ibm-plex-sans-thai",
    familyName: "IBM Plex Sans Thai",
    cssValue: "IBM Plex Sans Thai, sans-serif",
    cssVar: "--font-ibm-plex-sans-thai",
    label: "IBM Plex Sans Thai (คมกริบ / อ่านง่ายแม้ตัวเล็ก)",
    category: "dialogue",
    categoryLabel: "💬 แนวบทพูดอ่านง่าย / โมเดิร์น (Clean Dialogue)",
  },

  // ⚡ แนวแอ็กชัน / ไซไฟ / เสียงเอฟเฟกต์
  {
    id: "chakra-petch",
    familyName: "Chakra Petch",
    cssValue: "Chakra Petch, sans-serif",
    cssVar: "--font-chakra-petch",
    label: "Chakra Petch (แอ็กชัน / หุ่นยนต์ / ระบบเกม)",
    category: "action",
    categoryLabel: "⚡ แนวแอ็กชัน / ไซไฟ / เสียงเอฟเฟกต์ (Action & SFX)",
  },
  {
    id: "k2d",
    familyName: "K2D",
    cssValue: "K2D, sans-serif",
    cssVar: "--font-k2d",
    label: "K2D (เรขาคณิตเท่ๆ / แฟนตาซีสมัยใหม่)",
    category: "action",
    categoryLabel: "⚡ แนวแอ็กชัน / ไซไฟ / เสียงเอฟเฟกต์ (Action & SFX)",
  },
  {
    id: "chonburi",
    familyName: "Chonburi",
    cssValue: "Chonburi, sans-serif",
    cssVar: "--font-chonburi",
    label: "Chonburi (ตัวหนาอิมแพ็คสูง / เสียงเอฟเฟกต์)",
    category: "action",
    categoryLabel: "⚡ แนวแอ็กชัน / ไซไฟ / เสียงเอฟเฟกต์ (Action & SFX)",
  },

  // 📖 แนวบรรยาย / ทางการ
  {
    id: "sarabun",
    familyName: "Sarabun",
    cssValue: "Sarabun, sans-serif",
    cssVar: "--font-sarabun",
    label: "Sarabun (ทางการ / ช่องบรรยาย)",
    category: "narration",
    categoryLabel: "📖 แนวบรรยาย / ทางการ (Narration & Serif)",
  },
  {
    id: "pridi",
    familyName: "Pridi",
    cssValue: "Pridi, serif",
    cssVar: "--font-pridi",
    label: "Pridi (มีหัวร่วมสมัย / ช่องบรรยาย-จดหมาย)",
    category: "narration",
    categoryLabel: "📖 แนวบรรยาย / ทางการ (Narration & Serif)",
  },
];

export const BUILTIN_CANVAS_FONT_VARS: Record<string, string> = Object.fromEntries(
  BUILTIN_MANGA_FONTS.map((f) => [f.familyName.toLowerCase(), f.cssVar]),
);

const DB_NAME = "superk_custom_fonts_db";
const DB_VERSION = 1;
const STORE_NAME = "custom_fonts";

const ALLOWED_FONT_EXTENSIONS = /\.(ttf|otf|woff2?)$/i;

// In-memory store serves as both fast cache and test/SSR fallback when IndexedDB is unavailable
const memoryFontStore = new Map<string, StoredCustomFontRecord>();
const activeFontBlobUrls = new Map<string, string>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

export function subscribeCustomFonts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sanitizeCustomFontFamilyName(fileName: string): string {
  const withoutExt = fileName.replace(ALLOWED_FONT_EXTENSIONS, "");
  const cleaned = withoutExt
    .replace(/[-_().[\]]+/g, " ")
    .replace(/["'\\/;{}<>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Custom Manga Font";
}

export function formatCustomFontCssValue(familyName: string): string {
  const safe = familyName.replace(/["']/g, "").trim() || "Custom Manga Font";
  return `${safe}, sans-serif`;
}

function openCustomFontsDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readFileAsArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return await file.arrayBuffer();
  }
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("ไม่สามารถอ่านไฟล์ฟอนต์ได้"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("ไม่สามารถอ่านไฟล์ฟอนต์ได้"));
    reader.readAsArrayBuffer(file);
  });
}

async function mountCustomFontIntoDocument(record: StoredCustomFontRecord): Promise<void> {
  if (typeof document === "undefined") return;

  // 1. Mount via @font-face style tag with font-weight 100..900 so both normal and bold canvas measurements resolve
  try {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      const prevUrl = activeFontBlobUrls.get(record.id);
      if (prevUrl && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(prevUrl);
      }
      const blob = new Blob([record.buffer], { type: record.mimeType || "font/ttf" });
      const blobUrl = URL.createObjectURL(blob);
      activeFontBlobUrls.set(record.id, blobUrl);

      let styleEl = document.getElementById(`custom-font-style-${record.id}`) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = `custom-font-style-${record.id}`;
        document.head.appendChild(styleEl);
      }
      const escapedFamily = record.familyName.replace(/["\\]/g, "");
      styleEl.textContent = `
        @font-face {
          font-family: "${escapedFamily}";
          src: url("${blobUrl}");
          font-weight: 100 900;
          font-style: normal;
          font-display: swap;
        }
      `;
    }
  } catch {}

  // 2. Also register via Web FontFace API when supported
  try {
    const FontFaceCtor = (globalThis as unknown as { FontFace?: typeof FontFace }).FontFace;
    if (typeof FontFaceCtor === "function" && document.fonts && typeof document.fonts.add === "function") {
      const normalFace = new FontFaceCtor(record.familyName, record.buffer.slice(0), {
        weight: "normal",
        style: "normal",
      });
      const boldFace = new FontFaceCtor(record.familyName, record.buffer.slice(0), {
        weight: "bold",
        style: "normal",
      });
      await Promise.allSettled([normalFace.load(), boldFace.load()]);
      document.fonts.add(normalFace);
      document.fonts.add(boldFace);
    }
  } catch {}
}

export async function registerCustomFontFromFile(file: File): Promise<CustomUploadedFont> {
  if (!file || !ALLOWED_FONT_EXTENSIONS.test(file.name)) {
    throw new Error("รองรับเฉพาะไฟล์ฟอนต์นามสกุล .ttf, .otf, .woff หรือ .woff2 เท่านั้น");
  }

  const buffer = await readFileAsArrayBuffer(file);
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("ไฟล์ฟอนต์ว่างเปล่าหรือไม่สามารถอ่านข้อมูลได้");
  }

  const familyName = sanitizeCustomFontFamilyName(file.name);
  const id = `custom-font-${familyName.toLowerCase().replace(/\s+/g, "-")}`;
  const cssValue = formatCustomFontCssValue(familyName);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "ttf";
  const mimeType =
    ext === "otf"
      ? "font/otf"
      : ext === "woff2"
        ? "font/woff2"
        : ext === "woff"
          ? "font/woff"
          : "font/ttf";

  const record: StoredCustomFontRecord = {
    id,
    familyName,
    cssValue,
    fileName: file.name,
    mimeType,
    byteLength: buffer.byteLength,
    createdAt: Date.now(),
    buffer,
  };

  memoryFontStore.set(id, record);
  await mountCustomFontIntoDocument(record);

  const db = await openCustomFontsDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(record);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        db.close();
        resolve();
      }
    });
  }

  notifyListeners();

  return {
    id: record.id,
    familyName: record.familyName,
    cssValue: record.cssValue,
    fileName: record.fileName,
    mimeType: record.mimeType,
    byteLength: record.byteLength,
    createdAt: record.createdAt,
  };
}

export async function listCustomFonts(): Promise<CustomUploadedFont[]> {
  const db = await openCustomFontsDb();
  if (db) {
    const records = await new Promise<StoredCustomFontRecord[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          db.close();
          resolve(Array.isArray(req.result) ? (req.result as StoredCustomFontRecord[]) : []);
        };
        req.onerror = () => {
          db.close();
          resolve([]);
        };
      } catch {
        db.close();
        resolve([]);
      }
    });

    for (const rec of records) {
      if (rec && rec.id && !memoryFontStore.has(rec.id)) {
        memoryFontStore.set(rec.id, rec);
      }
    }
  }

  return Array.from(memoryFontStore.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(({ buffer: _buffer, ...meta }) => meta);
}

export async function hydrateStoredCustomFonts(): Promise<CustomUploadedFont[]> {
  const fonts = await listCustomFonts();
  for (const meta of fonts) {
    const rec = memoryFontStore.get(meta.id);
    if (rec) {
      await mountCustomFontIntoDocument(rec);
    }
  }
  return fonts;
}

export async function removeCustomFont(id: string): Promise<void> {
  memoryFontStore.delete(id);

  if (typeof document !== "undefined") {
    const styleEl = document.getElementById(`custom-font-style-${id}`);
    styleEl?.remove();
  }
  const prevUrl = activeFontBlobUrls.get(id);
  if (prevUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    try {
      URL.revokeObjectURL(prevUrl);
    } catch {}
    activeFontBlobUrls.delete(id);
  }

  const db = await openCustomFontsDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        db.close();
        resolve();
      }
    });
  }

  notifyListeners();
}

export async function clearAllCustomFontsForTests(): Promise<void> {
  const ids = Array.from(memoryFontStore.keys());
  for (const id of ids) {
    await removeCustomFont(id);
  }
  memoryFontStore.clear();
}
