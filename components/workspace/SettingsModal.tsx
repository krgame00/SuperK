"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { type GlossaryEntry } from "@/lib/translation/glossary";
import { Plus, Trash2, BookText, Flame, X, ChevronDown, Download, Folder, Search, Check } from "lucide-react";
import {
  getAskExportDirectory,
  setAskExportDirectory,
  getRememberedDirectoryName,
  pickAndRememberExportDirectory,
  clearRememberedDirectory,
  openRememberedDesktopDirectory,
  isDesktopMode,
} from "@/lib/export/saveLocation";

export interface WorkspaceTextStyle {
  fontFamily: string;
  fontSizeMultiplier: number;
  textColor: string;
  textOutline: string;
}

interface GeminiCatalogModelView {
  id: string;
  displayName: string;
  description?: string;
  releaseChannel: "stable" | "preview" | "experimental";
  availabilityCount: number;
  totalKeys: number;
  cooldownKeys: number;
  status: "ready" | "partial_quota" | "quota_cooldown" | "high_demand" | "recovery";
  overloadUntil?: number;
  nextRetryAt?: number;
  recoveryInFlight: boolean;
  compatibility: {
    text: "unverified" | "compatible" | "incompatible";
    image: "unverified" | "compatible" | "incompatible";
  };
}

interface GeminiCatalogView {
  owner: "user" | "server" | "mixed";
  source: "live" | "cache" | "bootstrap";
  stale: boolean;
  totalKeys: number;
  maxKeys: number;
  validKeys: number;
  keys: Array<{
    slot: number;
    owner: "user" | "server";
    valid: boolean;
    modelCount: number;
    errorCode?: string;
  }>;
  models: GeminiCatalogModelView[];
}

function splitApiKeySlots(raw: string, limit = 10): string[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const values = raw
    .split(/[,;\n]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, safeLimit);
  return Array.from({ length: safeLimit }, (_, index) => values[index] ?? "");
}

function joinApiKeySlots(values: string[], limit = 10): string {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, Math.floor(limit)))
    .join(",");
}

const UNSTABLE_IMAGE_MODEL_IDS = new Set(["gemini-3.6-flash"]);

function isUnstableImageModel(modelId: string): boolean {
  return UNSTABLE_IMAGE_MODEL_IDS.has(modelId);
}

function catalogModelMeta(model: GeminiCatalogModelView): string {
  const tags = [`${model.availabilityCount}/${model.totalKeys} Keys`];
  const healthLabel: Record<GeminiCatalogModelView["status"], string> = {
    ready: "Ready",
    partial_quota: "Quota limited",
    quota_cooldown: "Quota cooldown",
    high_demand: "High demand",
    recovery: "Recovery",
  };
  tags.push(healthLabel[model.status]);
  if (model.releaseChannel !== "stable") tags.push(model.releaseChannel === "preview" ? "Preview" : "Experimental");
  if (isUnstableImageModel(model.id)) tags.push("Experimental / Unstable");
  if (model.compatibility.image === "compatible") tags.push("Compatible");
  else if (model.compatibility.image === "incompatible") tags.push("Incompatible");
  else tags.push("Unverified");
  return tags.join(" · ");
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceLang: string;
  onSourceLangChange: (lang: string) => void;
  textStyle: WorkspaceTextStyle;
  onTextStyleChange: (style: WorkspaceTextStyle | ((prev: WorkspaceTextStyle) => WorkspaceTextStyle)) => void;
  modelPreference: string;
  onModelPreferenceChange: (model: string) => void;
  allowPreviewModels?: boolean;
  onAllowPreviewModelsChange?: (enabled: boolean) => void;
  userApiKey: string;
  onUserApiKeyChange: (key: string) => void;
  focusApiKey?: boolean;
  onValidateApiKey?: (key: string) => Promise<{ ok: boolean; message?: string }>;
  onApiKeyValidated?: () => void;
  glossary?: GlossaryEntry[];
  onGlossaryChange?: (glossary: GlossaryEntry[]) => void;
  nsfwBypassMode?: boolean;
  onNsfwBypassModeChange?: (enabled: boolean) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  sourceLang,
  onSourceLangChange,
  textStyle,
  onTextStyleChange,
  modelPreference,
  onModelPreferenceChange,
  allowPreviewModels = false,
  onAllowPreviewModelsChange,
  userApiKey,
  onUserApiKeyChange,
  focusApiKey = false,
  onValidateApiKey,
  onApiKeyValidated,
  glossary = [],
  onGlossaryChange,
  nsfwBypassMode = false,
  onNsfwBypassModeChange,
}: SettingsModalProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const [apiKeyValidation, setApiKeyValidation] = useState<{
    status: "idle" | "checking" | "valid" | "invalid";
    message?: string;
  }>({ status: "idle" });
  const [geminiCatalog, setGeminiCatalog] = useState<GeminiCatalogView | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<"idle" | "loading" | "error">("idle");
  const apiKeyLimit = geminiCatalog?.maxKeys ?? 10;
  const apiKeySlots = splitApiKeySlots(userApiKey, apiKeyLimit);
  const [newSource, setNewSource] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [draftTextColor, setDraftTextColor] = useState(textStyle.textColor || "#000000");
  const [draftTextOutline, setDraftTextOutline] = useState(textStyle.textOutline || "#ffffff");
  const colorCommitTimersRef = useRef<Record<"textColor" | "textOutline", number | null>>({
    textColor: null,
    textOutline: null,
  });
  const [isPurging, setIsPurging] = useState(false);
  const isPurgingBrowserRef = useRef(false);
  const [askExportDirectory, setAskExportDirectoryState] = useState(
    () => getAskExportDirectory(),
  );
  const [rememberedDirName, setRememberedDirName] = useState(
    () => getRememberedDirectoryName(),
  );

  const loadGeminiCatalog = useCallback(async (force: boolean) => {
    setCatalogStatus("loading");
    try {
      const response = await fetch("/api/translate/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: userApiKey, force }),
      });
      if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
      const nextCatalog = (await response.json()) as GeminiCatalogView;
      setGeminiCatalog(nextCatalog);
      setCatalogStatus("idle");
    } catch {
      setCatalogStatus("error");
    }
  }, [userApiKey]);

  const [pairingToken, setPairingToken] = useState<string>("");
  const [isCopiedToken, setIsCopiedToken] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const refreshFrame = window.requestAnimationFrame(() => {
      setRememberedDirName(getRememberedDirectoryName());
      setAskExportDirectoryState(getAskExportDirectory());
      setDraftTextColor(textStyle.textColor || "#000000");
      setDraftTextOutline(textStyle.textOutline || "#ffffff");
    });
    void fetch("/api/extension/pair")
      .then((res) => res.json())
      .then((data) => {
        if (data.pairingToken) setPairingToken(data.pairingToken);
      })
      .catch(() => {});
    const timer = window.setTimeout(() => {
      void loadGeminiCatalog(false);
    }, 150);

    return () => {
      window.cancelAnimationFrame(refreshFrame);
      window.clearTimeout(timer);
    };
  }, [isOpen, loadGeminiCatalog, textStyle.textColor, textStyle.textOutline]);

  useEffect(() => {
    const timers = colorCommitTimersRef.current;
    return () => {
      Object.values(timers).forEach((timerId) => {
        if (timerId !== null) window.clearTimeout(timerId);
      });
    };
  }, []);

  const commitColor = useCallback((key: "textColor" | "textOutline", value: string) => {
    const timerId = colorCommitTimersRef.current[key];
    if (timerId !== null) {
      window.clearTimeout(timerId);
      colorCommitTimersRef.current[key] = null;
    }
    onTextStyleChange((prev: WorkspaceTextStyle) => ({ ...prev, [key]: value }));
  }, [onTextStyleChange]);

  const queueColorCommit = useCallback((key: "textColor" | "textOutline", value: string) => {
    const timerId = colorCommitTimersRef.current[key];
    if (timerId !== null) {
      window.clearTimeout(timerId);
    }
    colorCommitTimersRef.current[key] = window.setTimeout(() => {
      colorCommitTimersRef.current[key] = null;
      onTextStyleChange((prev: WorkspaceTextStyle) => ({ ...prev, [key]: value }));
    }, 180);
  }, [onTextStyleChange]);

  const handlePurgeServerCache = async () => {
    if (isPurging) return;
    setIsPurging(true);
    const toast = (await import("react-hot-toast")).default;
    try {
      const res = await fetch("/api/clean/v1/jobs/purge", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { deleted?: number };
      if (res.ok) {
        toast.success(`ล้างภาพค้างบนเซิร์ฟเวอร์แล้ว ${data.deleted ?? 0} งาน`);
      } else {
        toast.error("ล้างแคชเซิร์ฟเวอร์ไม่สำเร็จ (เซิร์ฟเวอร์คลีนอาจไม่ได้เปิด)");
      }
    } catch {
      toast.error("ล้างแคชเซิร์ฟเวอร์ไม่สำเร็จ (เซิร์ฟเวอร์คลีนอาจไม่ได้เปิด)");
    } finally {
      setIsPurging(false);
    }
  };

  const handlePurgeBrowserCache = async () => {
    if (isPurgingBrowserRef.current) return;
    isPurgingBrowserRef.current = true;
    const toast = (await import("react-hot-toast")).default;
    try {
      const { purgeOrphanAssets } = await import("@/lib/projectStore");
      const removed = await purgeOrphanAssets();
      toast.success(
        removed > 0
          ? `ลบภาพแปลที่ไม่ถูกใช้แล้ว ${removed} ไฟล์ในเบราว์เซอร์`
          : "ไม่พบไฟล์แคชที่ไม่ถูกใช้ — พื้นที่สะอาดอยู่แล้ว",
      );
    } catch {
      toast.error("ล้างแคชเบราว์เซอร์ไม่สำเร็จ");
    } finally {
      isPurgingBrowserRef.current = false;
    }
  };

  useEffect(() => {
    if (isOpen) {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
      if (focusApiKey) {
        const focusFrame = window.requestAnimationFrame(() => {
          setApiKeyValidation({ status: "idle" });
          apiKeyInputRef.current?.focus();
          apiKeyInputRef.current?.select();
        });
        return () => window.cancelAnimationFrame(focusFrame);
      }

      closeRef.current?.focus();
      const resetFrame = window.requestAnimationFrame(() => {
        setApiKeyValidation({ status: "idle" });
      });
      return () => window.cancelAnimationFrame(resetFrame);
    }

    if (previousActiveElementRef.current) {
      previousActiveElementRef.current.focus?.();
      previousActiveElementRef.current = null;
    }
  }, [isOpen, focusApiKey]);

  const handleValidateApiKey = async () => {
    if (!onValidateApiKey) return;
    if (!userApiKey.trim()) {
      setApiKeyValidation({
        status: "invalid",
        message: "กรุณากรอก Gemini API Key ก่อนตรวจสอบ",
      });
      apiKeyInputRef.current?.focus();
      return;
    }

    setApiKeyValidation({ status: "checking" });
    const result = await onValidateApiKey(userApiKey.trim());
    if (result.ok) {
      setApiKeyValidation({
        status: "valid",
        message: result.message || "API Key พร้อมใช้งาน",
      });
      void loadGeminiCatalog(true);
      onApiKeyValidated?.();
    } else {
      setApiKeyValidation({
        status: "invalid",
        message: result.message || "API Key ใช้งานไม่ได้ กรุณาตรวจสอบอีกครั้ง",
      });
      apiKeyInputRef.current?.focus();
      apiKeyInputRef.current?.select();
    }
  };

  const handleAddGlossary = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSource.trim() || !newTarget.trim()) return;
    const updated = [
      ...glossary,
      { source: newSource.trim(), target: newTarget.trim() },
    ];
    onGlossaryChange?.(updated);
    setNewSource("");
    setNewTarget("");
  };

  const handleRemoveGlossary = (index: number) => {
    const updated = glossary.filter((_, i) => i !== index);
    onGlossaryChange?.(updated);
  };

  const usableModels = (geminiCatalog?.models ?? []).filter(
    (model) => model.availabilityCount > 0 && model.compatibility.image !== "incompatible",
  );
  const selectedCatalogModel = usableModels.find((model) => model.id === modelPreference);
  const selectedModelNeedsAutoRecovery =
    modelPreference !== "auto" &&
    (
      !selectedCatalogModel ||
      selectedCatalogModel.status === "high_demand" ||
      selectedCatalogModel.status === "quota_cooldown" ||
      selectedCatalogModel.status === "recovery"
    );
  const selectedModelRecoveryMessage = !selectedCatalogModel
    ? "โมเดลที่บันทึกไว้ใช้งานไม่ได้ในตอนนี้"
    : selectedCatalogModel.status === "high_demand"
      ? "โมเดลที่เลือกกำลังมีโหลดสูง"
      : selectedCatalogModel.status === "quota_cooldown"
        ? "คีย์ของโมเดลที่เลือกกำลังอยู่ในช่วงคูลดาวน์"
        : "โมเดลที่เลือกกำลังทดสอบการกู้คืน";
  const normalizedModelSearch = modelSearch.trim().toLowerCase();
  const visibleUsableModels = usableModels.filter((model) => {
    if (!normalizedModelSearch) return true;
    return [
      model.id,
      model.displayName,
      catalogModelMeta(model),
      model.releaseChannel,
    ].some((value) => value.toLowerCase().includes(normalizedModelSearch));
  });
  const autoMatchesSearch =
    !normalizedModelSearch ||
    "auto automatic อัตโนมัติ".includes(normalizedModelSearch);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (modelPickerOpen) {
        setModelPickerOpen(false);
        setModelSearch("");
        return;
      }
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      last.focus();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        id="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onKeyDown={handleKeyDown}
        className="fixed inset-x-4 top-16 z-[100] mx-auto max-h-[85vh] w-auto max-w-lg overflow-y-auto rounded-2xl border border-surface-hover bg-surface/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 sm:absolute sm:inset-auto sm:right-6 sm:top-14 sm:w-[30rem]"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 id="settings-title" className="text-base font-semibold text-foreground">
              ตั้งค่า
            </h3>
            <p className="mt-0.5 text-[11px] text-muted">
              ภาษา รูปแบบข้อความ AI และการจัดเก็บ
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="ปิด Settings"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-surface hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <label htmlFor="settings-source-lang" className="mb-1 block text-xs font-medium text-muted">
              Source Language (ภาษาต้นฉบับ)
            </label>
            <div className="relative">
              <select
                id="settings-source-lang"
                aria-label="Source Language (ภาษาต้นฉบับ)"
                value={sourceLang}
                onChange={(e) => onSourceLangChange(e.target.value)}
                className="w-full appearance-none rounded-md border border-surface-hover bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="auto">Auto Detect (ตรวจจับอัตโนมัติ)</option>
                <option value="Japanese">Japanese (日本語)</option>
                <option value="Korean">Korean (한국어)</option>
                <option value="Chinese">Chinese (中文)</option>
                <option value="English">English</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <span className="mb-2 block text-xs font-medium text-muted">
              Typography (รูปแบบข้อความ)
            </span>
            <div className="space-y-3">
              <div>
                <label htmlFor="settings-font-family" className="mb-1 block text-xs text-muted">
                  Font Family (แบบอักษร)
                </label>
                <div className="relative">
                  <select
                    id="settings-font-family"
                    aria-label="Font Family (แบบอักษร)"
                    value={textStyle.fontFamily}
                    onChange={(e) =>
                      onTextStyleChange((prev: WorkspaceTextStyle) => ({
                        ...prev,
                        fontFamily: e.target.value,
                      }))
                    }
                    className="w-full appearance-none rounded-md border border-surface-hover bg-background px-3 py-2 pr-8 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="Itim, sans-serif">Itim (น่ารัก / สบายๆ)</option>
                    <option value="Mitr, sans-serif">Mitr (อ่านง่าย / โมเดิร์น)</option>
                    <option value="Chakra Petch, sans-serif">
                      Chakra Petch (แอ็กชัน / หุ่นยนต์)
                    </option>
                    <option value="Sarabun, sans-serif">Sarabun (ทางการ / บรรยาย)</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label htmlFor="settings-text-color" className="text-sm text-muted cursor-pointer">
                  Text Color (สีข้อความ)
                </label>
                <input
                  id="settings-text-color"
                  aria-label="Text Color (สีข้อความ)"
                  type="color"
                  value={draftTextColor}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDraftTextColor(next);
                    queueColorCommit("textColor", next);
                  }}
                  onBlur={() => commitColor("textColor", draftTextColor)}
                  className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </div>

              <div className="flex items-center justify-between">
                <label htmlFor="settings-text-outline" className="text-sm text-muted cursor-pointer">
                  Outline Color (สีขอบตัวอักษร)
                </label>
                <input
                  id="settings-text-outline"
                  aria-label="Outline Color (สีขอบตัวอักษร)"
                  type="color"
                  value={draftTextOutline}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDraftTextOutline(next);
                    queueColorCommit("textOutline", next);
                  }}
                  onBlur={() => commitColor("textOutline", draftTextOutline)}
                  className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="settings-font-size" className="flex items-center justify-between text-sm text-muted cursor-pointer">
                  <span>Font Size Multiplier (ขนาดตัวอักษร)</span>
                  <span className="font-semibold text-foreground">{textStyle.fontSizeMultiplier.toFixed(1)}x</span>
                </label>
                <input
                  id="settings-font-size"
                  aria-label="Font Size Multiplier (ขนาดตัวอักษร)"
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={textStyle.fontSizeMultiplier}
                  onChange={(e) =>
                    onTextStyleChange((prev: WorkspaceTextStyle) => ({
                      ...prev,
                      fontSizeMultiplier: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-primary"
                />
              </div>

              <div
                aria-label="ตัวอย่างรูปแบบข้อความ"
                className="rounded-lg border border-border/70 bg-surface/70 px-4 py-3 text-center"
              >
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">
                  Live Preview
                </span>
                <span
                  className="inline-block"
                  style={{
                    fontFamily: textStyle.fontFamily,
                    fontSize: `${Math.round(18 * textStyle.fontSizeMultiplier)}px`,
                    color: draftTextColor,
                    WebkitTextStroke: `1px ${draftTextOutline}`,
                    paintOrder: "stroke fill",
                  }}
                >
                  ตัวอย่างข้อความแปล
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                <BookText className="h-3.5 w-3.5 text-primary" />
                <span>Glossary & ล็อกชื่อตัวละคร</span>
              </span>
              <span className="text-[10px] text-muted">
                {glossary.length} คำ
              </span>
            </div>

            {glossary.length > 0 && (
              <div className="mb-2 max-h-28 space-y-1 overflow-y-auto rounded-md border border-surface-hover bg-background/50 p-1.5 text-xs">
                {glossary.map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded bg-surface px-2 py-1 text-foreground"
                  >
                    <div className="truncate">
                      <span className="font-medium text-primary">{entry.source}</span>
                      <span className="mx-1 text-muted">➔</span>
                      <span>{entry.target}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveGlossary(idx)}
                      className="ml-1 text-muted hover:text-red-400"
                      title="ลบคำศัพท์"
                      aria-label={`ลบคำศัพท์ ${entry.source}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleAddGlossary} className="flex gap-1.5" aria-label="เพิ่มคำศัพท์ใหม่">
              <input
                id="settings-glossary-source"
                aria-label="คำต้นฉบับ เช่น Luffy"
                type="text"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                placeholder="ชื่อต้นฉบับ (Luffy)"
                className="w-1/2 rounded border border-surface-hover bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                id="settings-glossary-target"
                aria-label="คำแปลที่ต้องการ เช่น ลูฟี่"
                type="text"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                placeholder="คำแปล (ลูฟี่)"
                className="w-1/2 rounded border border-surface-hover bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="submit"
                className="flex items-center justify-center rounded bg-primary px-2 py-1 text-primary-content hover:bg-primary-hover"
                title="เพิ่มคำศัพท์"
                aria-label="เพิ่มคำศัพท์ลงใน Glossary"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor="settings-model-preference" className="block text-xs font-medium text-muted">
                Model Preference (โมเดล Gemini)
              </label>
              <button
                type="button"
                aria-label="รีเฟรชรายการโมเดล"
                onClick={() => void loadGeminiCatalog(true)}
                disabled={catalogStatus === "loading"}
                className="rounded px-2 py-1 text-[10px] font-medium text-primary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-60"
              >
                {catalogStatus === "loading" ? "กำลังรีเฟรช..." : "รีเฟรช"}
              </button>
            </div>

            <div className="w-full max-w-full">
              <button
                id="settings-model-preference"
                type="button"
                aria-label="Model Preference (โมเดล Gemini)"
                aria-haspopup="listbox"
                aria-expanded={modelPickerOpen}
                aria-controls="settings-model-listbox"
                onClick={() => {
                  setModelPickerOpen((open) => !open);
                  setModelSearch("");
                }}
                className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md border border-surface-hover bg-background px-3 py-2 text-left text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {modelPreference === "auto"
                      ? "Auto"
                      : selectedCatalogModel?.displayName ?? modelPreference}
                  </span>
                  <span className="block truncate text-[10px] font-normal text-muted">
                    {modelPreference === "auto"
                      ? "ใช้โมเดลและ Key ที่พร้อมใช้อัตโนมัติ"
                      : selectedCatalogModel
                        ? catalogModelMeta(selectedCatalogModel)
                        : "Unavailable · ไม่สามารถเลือกซ้ำได้"}
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted transition-transform ${modelPickerOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>

              {modelPickerOpen && (
                <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
                  <div className="border-b border-border/70 p-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden="true" />
                      <input
                        type="search"
                        role="searchbox"
                        aria-label="ค้นหาโมเดล"
                        autoFocus
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                        placeholder="ค้นหาโมเดล..."
                        className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-xs text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div
                    id="settings-model-listbox"
                    role="listbox"
                    aria-label="รายการโมเดล Gemini"
                    className="max-h-64 overflow-y-auto p-1.5 [scrollbar-width:thin]"
                  >
                    {autoMatchesSearch && (
                      <button
                        type="button"
                        role="option"
                        aria-selected={modelPreference === "auto"}
                        onClick={() => {
                          onModelPreferenceChange("auto");
                          setModelPickerOpen(false);
                          setModelSearch("");
                        }}
                        className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                          modelPreference === "auto"
                            ? "bg-primary/15 text-primary"
                            : "text-foreground hover:bg-surface-hover"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold">Auto</span>
                          <span className="block text-[10px] text-muted">
                            เลือกโมเดลและ Key ที่พร้อมใช้อัตโนมัติ
                          </span>
                        </span>
                        {modelPreference === "auto" && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                      </button>
                    )}

                    {visibleUsableModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        role="option"
                        aria-selected={modelPreference === model.id}
                        aria-label={`${model.displayName} ${catalogModelMeta(model)}`}
                        onClick={() => {
                          onModelPreferenceChange(model.id);
                          setModelPickerOpen(false);
                          setModelSearch("");
                        }}
                        className={`flex w-full min-w-0 items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                          modelPreference === model.id
                            ? "bg-primary/15 text-primary"
                            : "text-foreground hover:bg-surface-hover"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="block truncate text-xs font-semibold">{model.displayName}</span>
                            {isUnstableImageModel(model.id) && (
                              <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                                Experimental / Unstable
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-[10px] text-muted">{catalogModelMeta(model)}</span>
                          {isUnstableImageModel(model.id) && (
                            <span className="mt-0.5 block text-[10px] leading-tight text-amber-300">
                              ยังไม่ยืนยันเสถียรกับงานแปลภาพ
                            </span>
                          )}
                        </span>
                        {modelPreference === model.id && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                      </button>
                    ))}

                    {!autoMatchesSearch && visibleUsableModels.length === 0 && (
                      <div className="px-3 py-5 text-center text-xs text-muted">
                        ไม่พบโมเดลที่ใช้งานได้ตรงกับคำค้น
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {selectedModelNeedsAutoRecovery && (
              <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-amber-400/30 bg-amber-400/5 px-2 py-1.5">
                <p className="text-[10px] leading-relaxed text-amber-400">
                  {selectedModelRecoveryMessage}
                </p>
                <button
                  type="button"
                  onClick={() => onModelPreferenceChange("auto")}
                  className="shrink-0 rounded border border-amber-400/40 px-2 py-1 text-[10px] font-medium text-amber-300 hover:bg-amber-400/10"
                >
                  เปลี่ยนเป็น Auto
                </button>
              </div>
            )}

            <div className="mt-1.5 flex items-start justify-between gap-3 text-[10px] leading-relaxed text-muted">
              <span>
                {catalogStatus === "loading" && !geminiCatalog
                  ? "กำลังโหลดโมเดลจาก Gemini..."
                  : catalogStatus === "error"
                    ? "โหลดรายการโมเดลไม่ได้ ระบบจะใช้ข้อมูลแคชหรือโหมดกู้คืนเมื่อแปล"
                    : geminiCatalog
                      ? `Credentials ${geminiCatalog.validKeys}/${geminiCatalog.totalKeys} valid · ${usableModels.length} ใช้ได้ จาก ${geminiCatalog.models.length} โมเดล${geminiCatalog.stale ? " · ข้อมูลแคช" : ""}`
                      : "รายการโมเดลจะถูกค้นหาจาก Gemini API Key ที่ใช้งานจริง"}
              </span>
            </div>
            {geminiCatalog && (
              <details className="mt-2 rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-[10px] text-muted">
                <summary className="cursor-pointer font-medium text-foreground">
                  รายละเอียดสถานะ Gemini
                </summary>
                <div className="mt-2 space-y-1.5">
                  {geminiCatalog.models.map((model) => (
                    <div key={model.id} className="flex items-start justify-between gap-2">
                      <span className="truncate text-foreground">{model.displayName}</span>
                      <span className="shrink-0 text-right">{catalogModelMeta(model)}</span>
                    </div>
                  ))}
                  <div className="border-t border-border/60 pt-1.5">
                    {geminiCatalog.keys.map((key) => (
                      <div key={key.slot} className="flex justify-between gap-2">
                        <span>Key {key.slot} · {key.owner}</span>
                        <span>{key.valid ? `Valid · ${key.modelCount} models` : key.errorCode ?? "Invalid"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            )}
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                aria-label="อนุญาต Preview models ใน Auto"
                checked={allowPreviewModels}
                onChange={(event) => onAllowPreviewModelsChange?.(event.target.checked)}
                className="accent-primary"
              />
              ใช้ Preview / Experimental models ใน Auto
            </label>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="block text-xs font-medium text-muted">
                Gemini API Keys
              </span>
              <span className="rounded-full border border-border/70 bg-surface px-2 py-0.5 text-[10px] font-medium text-muted">
                เชื่อมต่อ {apiKeySlots.filter(Boolean).length}/{apiKeyLimit} Keys
              </span>
            </div>
            <div className="space-y-1.5">
              {apiKeySlots.map((value, index) => {
                const slot = index + 1;
                const isPrimary = index === 0;
                return (
                  <input
                    key={slot}
                    ref={isPrimary ? apiKeyInputRef : undefined}
                    id={isPrimary ? "settings-api-key" : `settings-api-key-${slot}`}
                    aria-label={isPrimary ? "Gemini API Key" : `API Key ${slot}`}
                    aria-describedby={isPrimary && apiKeyValidation.status === "invalid" ? "settings-api-key-error" : undefined}
                    aria-invalid={isPrimary ? apiKeyValidation.status === "invalid" : undefined}
                    type="password"
                    value={value}
                    onChange={(event) => {
                      const next = [...apiKeySlots];
                      next[index] = event.target.value;
                      onUserApiKeyChange(joinApiKeySlots(next, apiKeyLimit));
                      if (apiKeyValidation.status !== "idle") {
                        setApiKeyValidation({ status: "idle" });
                      }
                    }}
                    placeholder={`API Key ${slot}${isPrimary ? " (หลัก)" : ""}`}
                    className="w-full rounded-md border border-surface-hover bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                );
              })}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted">
              ใส่ได้สูงสุด {apiKeyLimit} Keys ระบบจะตรวจแยก Credential validity ออกจากสถานะโมเดล และใช้ Key ผู้ใช้ก่อน Server fallback โดยไม่เปิดเผยค่า Key หากไม่ใส่จะใช้ Key จาก{" "}
              <code className="text-foreground">.env.local</code>. สร้าง Key ได้ที่{" "}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Google AI Studio
              </a>
              .
            </p>
            {focusApiKey && onValidateApiKey && (
              <div className="mt-2 space-y-1.5">
                <button
                  type="button"
                  onClick={() => void handleValidateApiKey()}
                  disabled={apiKeyValidation.status === "checking"}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-wait disabled:opacity-60"
                >
                  {apiKeyValidation.status === "checking"
                    ? "กำลังตรวจสอบ API Key..."
                    : "บันทึกและตรวจสอบ API Key"}
                </button>
                {apiKeyValidation.status === "invalid" && (
                  <p id="settings-api-key-error" role="alert" className="text-xs text-red-400">
                    {apiKeyValidation.message}
                  </p>
                )}
                {apiKeyValidation.status === "valid" && (
                  <p role="status" className="text-xs text-emerald-400">
                    {apiKeyValidation.message}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <span className="mb-1 block text-xs font-medium text-muted">
              Maintenance (ล้างข้อมูลค้าง)
            </span>
            <p className="mb-2 text-[10px] leading-relaxed text-muted">
              ลบภาพที่เซิร์ฟเวอร์คลีนเก็บค้างไว้หลังประมวลผล
              (ระบบล้างอัตโนมัติเมื่อของเก่าเกิน 24 ชั่วโมง)
            </p>
            <button
              type="button"
              onClick={() => void handlePurgeServerCache()}
              disabled={isPurging}
              aria-label="ล้างภาพค้างบนเซิร์ฟเวอร์คลีน"
              className="w-full rounded-md border border-surface-hover bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              {isPurging ? "กำลังล้าง..." : "🧹 ล้างภาพค้างบนเซิร์ฟเวอร์"}
            </button>
            <button
              type="button"
              onClick={() => void handlePurgeBrowserCache()}
              aria-label="ล้างภาพแปลค้างในพื้นที่เก็บข้อมูลเบราว์เซอร์"
              className="mt-1.5 w-full rounded-md border border-surface-hover bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
            >
              🗃️ ล้างแคชเบราว์เซอร์ (ภาพที่ไม่ถูกใช้)
            </button>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Flame className="h-3.5 w-3.5 text-red-400" />
                  <span>โหมด 18+ (NSFW Bypass)</span>
                </label>
                <p className="mt-0.5 text-[10px] text-muted">
                  หั่นภาพหลบการตรวจจับเนื้อหา 18+ ของ Gemini
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={nsfwBypassMode}
                aria-label="เปิด/ปิดโหมด 18+ หั่นภาพหลบเซนเซอร์"
                onClick={() => onNsfwBypassModeChange?.(!nsfwBypassMode)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  nsfwBypassMode ? "bg-red-500" : "bg-surface-hover"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    nsfwBypassMode ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Download className="h-3.5 w-3.5 text-primary" />
                  <span>บันทึกลงโฟลเดอร์ที่กำหนด (จำตำแหน่งโฟลเดอร์)</span>
                </label>
                <p className="mt-0.5 text-[10px] text-muted">
                  {isDesktopMode()
                    ? "บันทึกไฟล์ Export ลงโฟลเดอร์ที่จำไว้โดยอัตโนมัติ ไม่ต้องเลือกโฟลเดอร์ซ้ำ"
                    : "เลือกโฟลเดอร์ปลายทางเพียงครั้งเดียว ไม่ต้องเลือกซ้ำทุกรอบ (รองรับ Chrome/Edge)"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={askExportDirectory}
                aria-label="เปิด/ปิดการบันทึกลงโฟลเดอร์ที่กำหนด"
                onClick={() => {
                  const next = !askExportDirectory;
                  setAskExportDirectory(next);
                  setAskExportDirectoryState(next);
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  askExportDirectory ? "bg-primary" : "bg-surface-hover"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    askExportDirectory ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {askExportDirectory && (
              <div className="mt-2.5 flex items-center justify-between rounded-lg bg-surface border border-surface-hover px-3 py-2 text-xs">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <Folder className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 truncate">
                    <span className="text-[10px] text-muted block">โฟลเดอร์ที่จำไว้:</span>
                    <span
                      className="font-medium text-foreground truncate block font-mono text-[11px]"
                      title={rememberedDirName}
                    >
                      {rememberedDirName || "ยังไม่ได้เลือก (จะถามครั้งแรกตอน Export หรือกดเลือกตอนนี้ได้เลย)"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isDesktopMode() && rememberedDirName && (
                    <button
                      type="button"
                      onClick={async () => {
                        await openRememberedDesktopDirectory();
                      }}
                      className="rounded bg-surface-hover hover:bg-surface-active px-2.5 py-1 text-[11px] font-medium text-foreground hover:text-primary transition-colors cursor-pointer"
                      title="เปิดโฟลเดอร์นี้ใน File Explorer"
                    >
                      เปิดโฟลเดอร์
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      const handle = await pickAndRememberExportDirectory();
                      if (handle) {
                        setRememberedDirName(handle.name || "โฟลเดอร์ที่เลือก");
                      }
                    }}
                    className="rounded bg-surface-hover hover:bg-surface-active px-2.5 py-1 text-[11px] font-medium text-foreground hover:text-primary transition-colors cursor-pointer"
                  >
                    {rememberedDirName ? "เปลี่ยนโฟลเดอร์" : "เลือกโฟลเดอร์"}
                  </button>
                  {rememberedDirName && (
                    <button
                      type="button"
                      onClick={async () => {
                        await clearRememberedDirectory();
                        setRememberedDirName("");
                      }}
                      className="rounded hover:bg-surface-hover px-2 py-1 text-[11px] text-muted hover:text-red-400 transition-colors cursor-pointer"
                      title="ล้างตำแหน่งโฟลเดอร์ที่จำไว้"
                    >
                      ล้างค่า
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/70 bg-background/45 p-3">
            <span className="mb-1 block text-xs font-medium text-muted">
              Chrome Extension Pairing (จับคู่ส่วนเสริม)
            </span>
            <div className="rounded-lg bg-surface border border-surface-hover p-2.5 space-y-2">
              <p className="text-[11px] text-muted leading-relaxed">
                คัดลอกรหัส Pairing Token นี้ไปใส่ในเมนูตั้งค่าของ SuperK Extension เพื่อเชื่อมต่อระบบอย่างปลอดภัย
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  readOnly
                  aria-label="Pairing Token สำหรับ Chrome Extension"
                  value={pairingToken || "กำลังโหลด..."}
                  className="w-full rounded bg-background px-2.5 py-1 text-xs font-mono text-muted select-all border border-surface-hover focus:outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (pairingToken) {
                      await navigator.clipboard.writeText(pairingToken);
                      setIsCopiedToken(true);
                      setTimeout(() => setIsCopiedToken(false), 2000);
                    }
                  }}
                  className="shrink-0 rounded bg-primary/20 hover:bg-primary/30 text-primary px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
                >
                  {isCopiedToken ? "คัดลอกแล้ว!" : "คัดลอก"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
