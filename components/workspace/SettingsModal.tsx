"use client";

import { useEffect, useRef, type ReactElement } from "react";

export interface WorkspaceTextStyle {
  fontFamily: string;
  fontSizeMultiplier: number;
  textColor?: string;
  textOutline?: string;
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
  userApiKey: string;
  onUserApiKeyChange: (key: string) => void;
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
  userApiKey,
  onUserApiKeyChange,
}: SettingsModalProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      closeRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
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
      first.focus();
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
        className="fixed inset-x-4 top-16 z-[100] mx-auto max-h-[85vh] w-auto max-w-sm overflow-y-auto rounded-xl border border-surface-hover bg-surface/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200 sm:absolute sm:inset-auto sm:right-6 sm:top-14 sm:w-80"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 id="settings-title" className="font-medium text-foreground">
            Settings
          </h3>
          <button
            ref={closeRef}
            type="button"
            aria-label="ปิด Settings"
            onClick={onClose}
            className="rounded-md p-1 text-muted hover:bg-surface hover:text-foreground"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Source Language (ภาษาต้นฉบับ)
            </label>
            <select
              value={sourceLang}
              onChange={(e) => onSourceLangChange(e.target.value)}
              className="w-full appearance-none rounded-md border border-surface-hover bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="auto">Auto Detect (ตรวจจับอัตโนมัติ)</option>
              <option value="Japanese">🇯🇵 Japanese (ญี่ปุ่น)</option>
              <option value="Korean">🇰🇷 Korean (เกาหลี)</option>
              <option value="Chinese">🇨🇳 Chinese (จีน)</option>
              <option value="English">🇬🇧 English (อังกฤษ)</option>
            </select>
          </div>

          <div className="border-t border-surface-hover pt-2">
            <label className="mb-2 block text-xs font-medium text-muted">
              Text Style (รูปแบบข้อความแปล)
            </label>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Font Family</span>
                <select
                  value={textStyle.fontFamily}
                  onChange={(e) =>
                    onTextStyleChange((prev: WorkspaceTextStyle) => ({
                      ...prev,
                      fontFamily: e.target.value,
                    }))
                  }
                  className="w-32 rounded border border-surface-hover bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="Itim, cursive">Itim (การ์ตูน)</option>
                  <option value="Prompt, sans-serif">Prompt (อ่านง่าย)</option>
                  <option value="Kanit, sans-serif">Kanit (โมเดิร์น)</option>
                  <option value="Sarabun, sans-serif">Sarabun (ทางการ)</option>
                </select>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Text Color</span>
                <input
                  type="color"
                  value={textStyle.textColor || "#000000"}
                  onChange={(e) =>
                    onTextStyleChange((prev: WorkspaceTextStyle) => ({
                      ...prev,
                      textColor: e.target.value,
                    }))
                  }
                  className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Outline Color</span>
                <input
                  type="color"
                  value={textStyle.textOutline || "#ffffff"}
                  onChange={(e) =>
                    onTextStyleChange((prev: WorkspaceTextStyle) => ({
                      ...prev,
                      textOutline: e.target.value,
                    }))
                  }
                  className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm text-muted">
                  <span>Font Size Multiplier</span>
                  <span>{textStyle.fontSizeMultiplier.toFixed(1)}x</span>
                </div>
                <input
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
            </div>
          </div>

          <div className="border-t border-surface-hover pt-2">
            <label className="mb-1 block text-xs font-medium text-muted">
              Model Preference
            </label>
            <select
              value={modelPreference}
              onChange={(e) => onModelPreferenceChange(e.target.value)}
              className="w-full appearance-none rounded-md border border-surface-hover bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="auto">Auto (สลับโมเดลอัตโนมัติเมื่อโควต้าเต็ม)</option>
              <option value="gemini-3.5-flash-lite">
                Gemini 3.5 Flash Lite (แนะนำ! โควต้าเหลือเพียบ 500 RPD)
              </option>
              <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
              <option value="gemini-3-flash">Gemini 3.0 Flash</option>
              <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Gemini API Key (Optional)
            </label>
            <input
              type="password"
              value={userApiKey}
              onChange={(e) => onUserApiKeyChange(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full rounded-md border border-surface-hover bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-[10px] leading-relaxed text-muted">
              By default, the app uses a shared key with limits (5 req/min). To
              avoid &quot;Quota exceeded&quot; errors (especially in 18+ mode),
              enter your own free Gemini API key from{" "}
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
          </div>
        </div>
      </div>
    </>
  );
}
