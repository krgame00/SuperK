"use client";

import { useState, type ReactElement } from "react";
import { BookText, Download, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import type { GlossaryEntry } from "@/lib/translation/glossary";

export interface GlossaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  glossary: GlossaryEntry[];
  onGlossaryChange: (entries: GlossaryEntry[]) => void;
  onAutoExtractGlossary?: () => void;
}

export function GlossaryModal({
  isOpen,
  onClose,
  glossary,
  onGlossaryChange,
  onAutoExtractGlossary,
}: GlossaryModalProps): ReactElement | null {
  const [sourceTerm, setSourceTerm] = useState("");
  const [targetTerm, setTargetTerm] = useState("");
  const [noteTerm, setNoteTerm] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  if (!isOpen) return null;

  const handleAddEntry = () => {
    const src = sourceTerm.trim();
    const tgt = targetTerm.trim();
    const note = noteTerm.trim();
    if (!src || !tgt) return;

    const existingIdx = glossary.findIndex(
      (item) => item.source.trim().toLowerCase() === src.toLowerCase(),
    );
    if (existingIdx >= 0) {
      const updated = [...glossary];
      updated[existingIdx] = { source: src, target: tgt, ...(note ? { note } : {}) };
      onGlossaryChange(updated);
    } else {
      onGlossaryChange([...glossary, { source: src, target: tgt, ...(note ? { note } : {}) }]);
    }
    setSourceTerm("");
    setTargetTerm("");
    setNoteTerm("");
  };

  const handleRemoveEntry = (idx: number) => {
    onGlossaryChange(glossary.filter((_, i) => i !== idx));
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(glossary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "superk_glossary.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) return;
        const merged = [...glossary];
        for (const item of parsed) {
          if (item && typeof item.source === "string" && typeof item.target === "string") {
            const src = item.source.trim();
            const tgt = item.target.trim();
            if (!src || !tgt) continue;
            const idx = merged.findIndex((m) => m.source.toLowerCase() === src.toLowerCase());
            const entry: GlossaryEntry = {
              source: src,
              target: tgt,
              ...(typeof item.note === "string" && item.note.trim() ? { note: item.note.trim() } : {}),
            };
            if (idx >= 0) merged[idx] = entry;
            else merged.push(entry);
          }
        }
        onGlossaryChange(merged);
      } catch {}
    };
    reader.readAsText(file);
  };

  const filteredEntries = glossary
    .map((entry, idx) => ({ entry, idx }))
    .filter(({ entry }) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return (
        entry.source.toLowerCase().includes(q) ||
        entry.target.toLowerCase().includes(q) ||
        (entry.note ?? "").toLowerCase().includes(q)
      );
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="คลังคำศัพท์เฉพาะเรื่อง (Glossary)"
    >
      <div className="w-full max-w-2xl bg-surface border border-border rounded-2xl shadow-2xl flex flex-col max-h-[86vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-background/60">
          <div className="flex items-center gap-2.5">
            <BookText className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-sm sm:text-base font-bold text-foreground">
                คลังคำศัพท์เฉพาะเรื่อง & ล็อกชื่อตัวละคร (Glossary)
              </h2>
              <p className="text-[11px] text-muted">
                กำหนดคำแปลชื่อตัวละคร ท่าไม้ตาย หรือคำทับศัพท์ให้ AI ใช้ตรงกันทุกหน้า ({glossary.length} รายการ)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่างคลังคำศัพท์"
            className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 border-b border-border/60 bg-background/30">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={sourceTerm}
              onChange={(e) => setSourceTerm(e.target.value)}
              placeholder="คำต้นฉบับ (เช่น 田中 / 성진우)"
              aria-label="คำศัพท์ต้นฉบับ"
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
            />
            <input
              type="text"
              value={targetTerm}
              onChange={(e) => setTargetTerm(e.target.value)}
              placeholder="คำแปลที่ล็อก (เช่น ทานากะ / ซองจินอู)"
              aria-label="คำแปลที่ต้องการล็อก"
              className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
            />
            <div className="flex gap-1.5">
              <input
                type="text"
                value={noteTerm}
                onChange={(e) => setNoteTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddEntry();
                }}
                placeholder="หมายเหตุ (เช่น พระเอก)"
                aria-label="หมายเหตุคำศัพท์"
                className="flex-1 min-w-0 bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={handleAddEntry}
                disabled={!sourceTerm.trim() || !targetTerm.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-primary-content text-xs font-semibold flex items-center gap-1 disabled:opacity-40 cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>เพิ่ม</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาคำศัพท์ในคลัง..."
              className="bg-background border border-border rounded-lg px-3 py-1 text-xs text-foreground w-48 sm:w-64 focus:outline-none focus:border-primary"
            />
            <div className="flex items-center gap-1.5">
              {onAutoExtractGlossary && (
                <button
                  type="button"
                  onClick={onAutoExtractGlossary}
                  className="px-2.5 py-1 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="สกัดชื่อตัวละครและคำเฉพาะจากคำแปลในเล่มอัตโนมัติ"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>สกัดคำศัพท์จากเรื่องอัตโนมัติ</span>
                </button>
              )}
              <label className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-hover border border-border text-xs text-foreground flex items-center gap-1 cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-muted" />
                <span>นำเข้า JSON</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleImportJson}
                  className="sr-only"
                />
              </label>
              <button
                type="button"
                onClick={handleExportJson}
                disabled={glossary.length === 0}
                className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-hover border border-border text-xs text-foreground flex items-center gap-1 disabled:opacity-40 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-muted" />
                <span>ส่งออก JSON</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-1.5">
          {filteredEntries.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted">
              ยังไม่มีรายการคำศัพท์ในคลัง สามารถพิมพ์เพิ่มด้านบน หรือกด &ldquo;สกัดคำศัพท์จากเรื่องอัตโนมัติ&rdquo;
            </div>
          ) : (
            filteredEntries.map(({ entry, idx }) => (
              <div
                key={`${entry.source}-${idx}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-background/70 border border-border/60 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="font-mono font-semibold text-foreground truncate max-w-[160px]">
                    {entry.source}
                  </span>
                  <span className="text-muted">→</span>
                  <span className="font-semibold text-primary truncate max-w-[180px]">
                    {entry.target}
                  </span>
                  {entry.note && (
                    <span className="text-[11px] text-muted truncate">
                      ({entry.note})
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveEntry(idx)}
                  aria-label={`ลบคำศัพท์ ${entry.source}`}
                  className="p-1 rounded hover:bg-red-500/20 text-muted hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
