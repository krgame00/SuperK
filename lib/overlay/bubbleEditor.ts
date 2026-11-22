// Owns the inline bubble editor and its quality-review panel. The paint
// closure hands the live per-bubble state in through deps; this module never
// reaches into the overlay's shared scope.

import { undoManager } from "../undoManager";
import {
  guardQualityReview,
  invalidateQualityReview,
  isReviewCurrent,
  unavailableReview,
} from "../translation/qualityReview";
import type { TranslationReview } from "../translation/qualityReview";
import {
  LANGUAGE_POLICY_VERSION,
  inspectTargetText,
  repairExcludedScriptText,
  saveCustomAllowedThaiTokens,
} from "../languagePolicy";
import { requestTranslationReview, type ReviewApiKeyProvider } from "./qualityReviewActions";
import type { TranslatedBubble } from "./overlayTypes";

export interface BubbleEditorDeps {
  bubble: TranslatedBubble;
  wrapper: HTMLElement;
  tlContainer: HTMLElement;
  chromeRoot: HTMLElement | null | undefined;
  chromeControls?: { setVisible: (visible: boolean) => void };
  pageWidth: number;
  pageHeight: number;
  getCurrentRect: () => { x: number; y: number; w: number; h: number };
  effectiveTarget: string;
  reviewApiKeyProvider: ReviewApiKeyProvider;
  onBubblesMutated?: () => void;
  renderBubble: () => void;
  saveAdjustment: () => void;
  setActiveEditorPosition: (position: (() => void) | null) => void;
}

export const openBubbleLiveEditor = (deps: BubbleEditorDeps): void => {
  const { bubble: b, wrapper, effectiveTarget, reviewApiKeyProvider, renderBubble, saveAdjustment, onBubblesMutated } = deps;
  deps.chromeControls?.setVisible(false);
  const editorHost = deps.chromeRoot ?? deps.tlContainer;
  editorHost.querySelectorAll("[data-translation-editor]").forEach((el) => el.remove());

  const openingText = b.t || b.translated || "";
  const openingReview = b.translationReview ? { ...b.translationReview } : undefined;
  const restoreReview = (review: TranslationReview | undefined) => {
    if (review) b.translationReview = { ...review };
    else delete b.translationReview;
  };
  const editor = document.createElement("div");
  editor.setAttribute("data-translation-editor", "true");
  editor.setAttribute("data-translation-chrome", "true");
  editor.className = "translation-editor-bubble";
  editor.style.cssText = `position:absolute; z-index:60; pointer-events:auto; display:grid; gap:7px; box-sizing:border-box; background:rgba(24,24,27,0.98); backdrop-filter:blur(14px); border:1px solid rgba(255,255,255,0.22); border-radius:11px; padding:7px; box-shadow:0 12px 32px rgba(0,0,0,0.55);`;

  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.value = openingText;
  textarea.setAttribute("aria-label", "แก้ไขข้อความแปล");
  textarea.className = "translation-editor-input";
  textarea.style.cssText = `display:block; width:100%; min-width:320px; min-height:48px; max-height:160px; box-sizing:border-box; resize:none; overflow-y:auto; background:#27272a; color:#f4f4f5; border:1px solid #52525b; border-radius:9px; padding:10px 12px; font-size:16px; line-height:1.45; font-family:inherit; outline:none;`;

  editor.appendChild(textarea);

  const editorActions = document.createElement("div");
  editorActions.style.cssText = `display:flex; justify-content:flex-end; align-items:center; gap:6px;`;
  editor.appendChild(editorActions);

  const positionEditor = () => {
    const hostRect = editorHost.getBoundingClientRect();
    const stageRect = deps.tlContainer.getBoundingClientRect();
    const hostScale = deps.chromeRoot
      ? 1
      : (stageRect.width > 0 ? Math.max(0.01, stageRect.width / deps.pageWidth) : 1);
    const viewportWidth = (hostRect.width || deps.pageWidth * hostScale) / hostScale;
    const viewportHeight = (hostRect.height || deps.pageHeight * hostScale) / hostScale;
    const editorWidth = Math.max(220, Math.min(320, viewportWidth - 16));
    const bubbleRect = wrapper.getBoundingClientRect();
    const currentRect = deps.getCurrentRect();
    const bubbleLeft = bubbleRect.width > 0
      ? (bubbleRect.left - hostRect.left) / hostScale
      : currentRect.x;
    const bubbleTop = bubbleRect.height > 0
      ? (bubbleRect.top - hostRect.top) / hostScale
      : currentRect.y;
    const bubbleWidth = bubbleRect.width > 0 ? bubbleRect.width / hostScale : currentRect.w;
    const bubbleHeight = bubbleRect.height > 0 ? bubbleRect.height / hostScale : currentRect.h;
    const editorHeight = (editor.offsetHeight || 108) / (deps.chromeRoot ? 1 : hostScale);
    const aboveTop = bubbleTop - editorHeight - 10;
    const belowTop = bubbleTop + bubbleHeight + 10;
    const top = aboveTop >= 8
      ? aboveTop
      : Math.max(8, Math.min(viewportHeight - editorHeight - 8, belowTop));
    const preferredLeft = bubbleLeft + bubbleWidth / 2 - editorWidth / 2;
    const left = Math.max(8, Math.min(viewportWidth - editorWidth - 8, preferredLeft));

    editor.style.width = `${editorWidth}px`;
    editor.style.maxWidth = "calc(100% - 16px)";
    textarea.style.minWidth = `${Math.min(300, editorWidth)}px`;
    editor.style.left = `${left}px`;
    editor.style.top = `${top}px`;
  };
  deps.setActiveEditorPosition(positionEditor);

  let isCommitted = false;

  const commit = (restoreFocus = true) => {
    if (isCommitted) return;
    isCommitted = true;
    const finalVal = textarea.value.trim();
    b.t = finalVal;
    b.translated = finalVal;
    invalidateQualityReview(b);
    const finalReview = b.translationReview ? { ...b.translationReview } : undefined;
    renderBubble();
    saveAdjustment();
    if (finalVal !== openingText || JSON.stringify(finalReview) !== JSON.stringify(openingReview)) {
      onBubblesMutated?.();
      undoManager.push({
        label: "แก้ไขข้อความ",
        undo: () => {
          b.t = openingText;
          b.translated = openingText;
          restoreReview(openingReview);
          renderBubble();
          saveAdjustment();
          onBubblesMutated?.();
        },
        redo: () => {
          b.t = finalVal;
          b.translated = finalVal;
          restoreReview(finalReview);
          renderBubble();
          saveAdjustment();
          onBubblesMutated?.();
        },
      });
    }
    deps.setActiveEditorPosition(null);
    editor.remove();
    if (restoreFocus) wrapper.focus();
  };

  const cancel = () => {
    if (isCommitted) return;
    isCommitted = true;
    const discardedDraft = (b.t || b.translated || "") !== openingText ||
      JSON.stringify(b.translationReview) !== JSON.stringify(openingReview);
    b.t = openingText;
    b.translated = openingText;
    restoreReview(openingReview);
    renderBubble();
    if (discardedDraft) {
      saveAdjustment();
    }
    deps.setActiveEditorPosition(null);
    editor.remove();
    wrapper.focus();
  };

  const createEditorAction = (label: string, glyph: string, onClick: () => void, primary = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = glyph;
    button.style.cssText = `width:40px; height:36px; display:flex; align-items:center; justify-content:center; border-radius:8px; border:1px solid ${primary ? "#3b82f6" : "#52525b"}; background:${primary ? "#2563eb" : "#27272a"}; color:#fff; font-size:18px; font-weight:700; cursor:pointer;`;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  };

  editorActions.appendChild(createEditorAction("ยกเลิกการแก้ไข", "×", cancel));
  editorActions.appendChild(createEditorAction("บันทึกข้อความ", "✓", commit, true));

  const reviewPanel = document.createElement("div");
  reviewPanel.style.cssText = "display:grid; gap:6px; color:#e4e4e7; font-size:13px; line-height:1.45; overflow-wrap:anywhere; max-height:240px; overflow-y:auto;";
  editor.insertBefore(reviewPanel, textarea);
  const source = document.createElement("div");
  source.setAttribute("data-review-source", "true");
  const reviewStatus = document.createElement("div");
  reviewStatus.setAttribute("role", "status");
  const suggestion = document.createElement("div");
  const reviewActions = document.createElement("div");
  reviewActions.style.cssText = "display:flex; flex-wrap:wrap; gap:6px;";
  reviewPanel.append(source, reviewStatus, suggestion, reviewActions);
  const reviewLabels: Record<TranslationReview["status"], string> = {
    ok: "ตรวจแล้ว", suggested: "มีคำแปลที่แนะนำ", needs_review: "ควรตรวจสอบคำแปล",
    accepted: "ใช้คำแปลที่แนะนำแล้ว", dismissed: "เก็บคำแปลปัจจุบันแล้ว",
    unavailable: "ยังตรวจสอบคำแปลไม่ได้", stale: "ข้อความเปลี่ยนแล้ว ต้องตรวจสอบใหม่",
  };
  const reviewAction = (name: string, label: string, onClick: () => void) => {
    const button = createEditorAction(label, label, onClick);
    button.setAttribute("data-review-action", name);
    button.style.width = "auto";
    button.style.padding = "0 8px";
    button.style.fontSize = "12px";
    reviewActions.appendChild(button);
    return button;
  };
  const displayedReview = () => {
    const text = b.t || b.translated || "";
    if (inspectTargetText(text, effectiveTarget).status === "blocked") {
      return guardQualityReview(unavailableReview({id:"",sourceText:b.original_text ?? "",translatedText:text}), effectiveTarget);
    }
    if (b.translationReview && isReviewCurrent(b)) return guardQualityReview(b.translationReview, effectiveTarget);
    return b.translationReview;
  };
  let isRequestingAiSuggestion = false;
  const updateReviewPanel = () => {
    const review = displayedReview();
    const currentText = b.t || b.translated || "";
    const inspection = inspectTargetText(currentText, effectiveTarget);
    const isExcludedScript = inspection.reason === "excluded-script";
    const autoRepairedPreview = isExcludedScript ? repairExcludedScriptText(currentText, effectiveTarget) : "";
    const effectiveSuggestion = review?.suggestion || (b.translationReview?.suggestion && inspectTargetText(b.translationReview.suggestion, effectiveTarget).status === "eligible" ? b.translationReview.suggestion : "") || (autoRepairedPreview && autoRepairedPreview !== currentText.trim() ? autoRepairedPreview : "");
    reviewPanel.hidden = !review && !b.original_text;
    reviewPanel.style.display = reviewPanel.hidden ? "none" : "grid";
    source.textContent = b.original_text ? `ต้นฉบับ: ${b.original_text}` : "ไม่มีข้อความต้นฉบับ";
    reviewStatus.textContent = review ? `${reviewLabels[review.status]}${review.reason ? `: ${review.reason}` : ""}` : "";
    suggestion.textContent = effectiveSuggestion ? `💡 คำแปลที่แนะนำ: ${effectiveSuggestion}` : "";
    const current = isReviewCurrent(b) && review?.status !== "stale";
    const latinTokens = currentText.match(/[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*/g) || [];
    const offendingSet = new Set(inspection.offendingCharacters);
    const tokensToWhitelist = latinTokens.filter(t => Array.from(t).some(ch => offendingSet.has(ch)));
    const finalTokensToWhitelist = tokensToWhitelist.length > 0
      ? tokensToWhitelist
      : inspection.offendingCharacters;
    cleanScript.hidden = !isExcludedScript;
    cleanScript.disabled = !isExcludedScript;
    whitelistToken.hidden = !isExcludedScript || finalTokensToWhitelist.length === 0;
    whitelistToken.disabled = !isExcludedScript || finalTokensToWhitelist.length === 0;
    if (finalTokensToWhitelist.length > 0) {
      whitelistToken.textContent = `➕ อนุญาต "${finalTokensToWhitelist.slice(0, 2).join(", ")}"`;
    }
    askAiReview.hidden = !b.original_text;
    askAiReview.disabled = isRequestingAiSuggestion || !b.original_text;
    askAiReview.textContent = isRequestingAiSuggestion ? "⏳ กำลังขอคำแนะนำ AI..." : "✨ ขอคำแนะนำจาก AI";
    acceptReview.hidden = !review?.suggestion;
    acceptReview.disabled = !current || review?.status !== "suggested";
    dismissReview.hidden = !review;
    dismissReview.disabled = !current || !["suggested", "needs_review", "unavailable"].includes(review?.status ?? "");
    restoreOriginal.hidden = review?.status !== "accepted" || review.originalTranslation === undefined;
    restoreOriginal.disabled = !current;
    for (const button of [cleanScript, whitelistToken, askAiReview, acceptReview, dismissReview, restoreOriginal]) {
      button.style.display = button.hidden ? "none" : "flex";
      button.style.opacity = button.disabled ? "0.5" : "1";
      button.style.cursor = button.disabled ? "default" : "pointer";
    }
  };
  const checkReviewSnapshot = () => {
    invalidateQualityReview(b);
    updateReviewPanel();
    return isReviewCurrent(b) && b.translationReview?.status !== "stale";
  };
  const updateReviewText = (value: string) => {
    textarea.value = value;
    b.t = value;
    b.translated = value;
    renderBubble();
    updateReviewPanel();
    autoGrowEditor();
  };
  const applyCleanScript = (nextStatus: "accepted" | "dismissed" = "accepted") => {
    const currentText = b.t || b.translated || textarea.value || "";
    const cleaned = repairExcludedScriptText(currentText, effectiveTarget);
    if (!cleaned) return;
    const baseReview = b.translationReview ?? displayedReview();
    if (baseReview) {
      b.translationReview = {
        ...baseReview,
        status: nextStatus,
        reviewedText: cleaned,
        reason: undefined,
        originalTranslation: baseReview.originalTranslation ?? currentText,
      };
    }
    updateReviewText(cleaned);
  };
  const cleanScript = reviewAction("clean-script", "ลบ/แก้อักษรที่ปนอัตโนมัติ", () => {
    applyCleanScript("accepted");
  });
  cleanScript.style.background = "#d97706";
  cleanScript.style.borderColor = "#f59e0b";
  const whitelistToken = reviewAction("whitelist-token", "➕ อนุญาตคำนี้", () => {
    const currentText = b.t || b.translated || textarea.value || "";
    const inspection = inspectTargetText(currentText, effectiveTarget);
    const latinTokens = currentText.match(/[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*/g) || [];
    const offendingSet = new Set(inspection.offendingCharacters);
    const tokensToWhitelist = latinTokens.filter(t => Array.from(t).some(ch => offendingSet.has(ch)));
    const finalTokensToWhitelist = tokensToWhitelist.length > 0
      ? tokensToWhitelist
      : inspection.offendingCharacters;
    if (finalTokensToWhitelist.length > 0) {
      saveCustomAllowedThaiTokens(finalTokensToWhitelist);
      const baseReview = b.translationReview ?? displayedReview();
      if (baseReview) {
        b.translationReview = {
          ...baseReview,
          status: "dismissed",
          reviewedText: currentText,
          reason: undefined,
        };
      }
      renderBubble();
      updateReviewPanel();
      saveAdjustment();
    }
  });
  whitelistToken.style.background = "#059669";
  whitelistToken.style.borderColor = "#10b981";
  const askAiReview = reviewAction("ask-ai", "✨ ขอคำแนะนำจาก AI", async () => {
    if (isRequestingAiSuggestion || !b.original_text) return;
    isRequestingAiSuggestion = true;
    updateReviewPanel();
    try {
      const currentText = b.t || b.translated || textarea.value || "";
      const isBlocked = inspectTargetText(currentText, effectiveTarget).status === "blocked";
      const row = await requestTranslationReview(
        b.original_text,
        currentText,
        effectiveTarget,
        reviewApiKeyProvider,
        isBlocked,
      );
      if (row?.suggestion && typeof row.suggestion === "string" && row.suggestion.trim()) {
        const prevText = currentText;
        b.translationReview = {
          ...(b.translationReview ?? {
            policyVersion: LANGUAGE_POLICY_VERSION,
            sourceText: b.original_text ?? "",
            reviewedText: prevText,
          }),
          status: "accepted",
          suggestion: row.suggestion.trim(),
          reviewedText: row.suggestion.trim(),
          originalTranslation: b.translationReview?.originalTranslation ?? prevText,
          reason: row.reason || "เกลาคำแปลด้วย AI แล้ว",
        };
        updateReviewText(row.suggestion.trim());
      } else if (row?.status === "ok") {
        b.translationReview = {
          ...(b.translationReview ?? {
            policyVersion: LANGUAGE_POLICY_VERSION,
            sourceText: b.original_text ?? "",
          }),
          status: "ok",
          reviewedText: currentText,
          reason: row.reason || "คำแปลปัจจุบันถูกต้องและเหมาะสมแล้ว",
        };
      } else if (row?.status === "needs_review") {
        b.translationReview = {
          ...(b.translationReview ?? {
            policyVersion: LANGUAGE_POLICY_VERSION,
            sourceText: b.original_text ?? "",
          }),
          status: "needs_review",
          reviewedText: currentText,
          reason: row.reason || "ควรตรวจสอบเทียบกับภาพต้นฉบับ",
        };
      }
    } catch {
      // Fall back to local smart repair if offline/error
    } finally {
      isRequestingAiSuggestion = false;
      updateReviewPanel();
    }
  });
  askAiReview.style.background = "#4f46e5";
  askAiReview.style.borderColor = "#6366f1";
  const acceptReview = reviewAction("accept", "ใช้คำแปลที่แนะนำ", () => {
    if (!checkReviewSnapshot()) return;
    const review = displayedReview();
    const targetSuggestion = review?.suggestion || (b.translationReview?.suggestion && inspectTargetText(b.translationReview.suggestion, effectiveTarget).status === "eligible" ? b.translationReview.suggestion : "");
    if (!targetSuggestion) return;
    const baseReview = review ?? b.translationReview ?? {
      policyVersion: LANGUAGE_POLICY_VERSION,
      sourceText: b.original_text ?? "",
      reviewedText: b.t || b.translated || "",
      originalTranslation: undefined as string | undefined,
    };
    b.translationReview = {
      ...baseReview,
      status: "accepted",
      reviewedText: targetSuggestion,
      originalTranslation: baseReview.originalTranslation ?? (b.t || b.translated || ""),
    };
    updateReviewText(targetSuggestion);
  });
  const dismissReview = reviewAction("dismiss", "เก็บคำแปลปัจจุบัน", () => {
    const currentText = b.t || b.translated || textarea.value || "";
    const baseReview = b.translationReview ?? displayedReview();
    b.translationReview = {
      ...(baseReview ?? {
        policyVersion: LANGUAGE_POLICY_VERSION,
        sourceText: b.original_text ?? "",
        reviewedText: currentText,
      }),
      status: "dismissed",
      reviewedText: currentText,
    };
    updateReviewPanel();
    renderBubble();
    saveAdjustment();
  });
  const restoreOriginal = reviewAction("restore", "คืนคำแปลก่อนหน้า", () => {
    if (!checkReviewSnapshot()) return;
    const review = b.translationReview;
    if (review?.status !== "accepted" || review.originalTranslation === undefined) return;
    b.translationReview = { ...review, status: "suggested", reviewedText: review.originalTranslation };
    updateReviewText(review.originalTranslation);
  });
  invalidateQualityReview(b);
  updateReviewPanel();

  const autoGrowEditor = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(160, Math.max(48, textarea.scrollHeight || 48))}px`;
    positionEditor();
  };

  textarea.addEventListener("input", () => {
    b.t = textarea.value;
    b.translated = textarea.value;
    invalidateQualityReview(b);
    updateReviewPanel();
    renderBubble();
    autoGrowEditor();
  });

  textarea.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  });

  editor.addEventListener("focusout", () => {
    queueMicrotask(() => {
      if (!isCommitted && !editor.contains(document.activeElement)) commit(false);
    });
  });

  editorHost.appendChild(editor);
  positionEditor();
  autoGrowEditor();
  textarea.focus();
  textarea.select();
};
