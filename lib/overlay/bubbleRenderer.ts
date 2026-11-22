// Per-bubble canvas renderer for the overlay. The paint closure hands the
// live per-bubble state through an accessor-backed object so the drag,
// resize and keyboard handlers and this renderer keep mutating the same
// variables instead of drifting onto copies.

import { constrainSourceLayoutHeight } from "../sourceTextSpace";
import {
  calibrateOutputBodyMetric,
  resolveSourceFontSize,
  sourceRegionKey,
  SOURCE_SIZE_POLICY,
  SOURCE_SIZE_FALLBACK_LABEL,
} from "../sourceTextSize";
import { measureTextSelection, type SelectionRect } from "../textSelectionBounds";
import { resolveBubbleTextStyle } from "../colorMatching/resolveTextStyle";
import { renderWarpedText } from "../tools/TextWarpRenderer";
import { resolveCategoryTypography, type BubbleCategory } from "../typography/comicTypography";
import {
  fitTextVertically,
  isCJKLanguage,
  shouldPreferVerticalTypesetting,
  type VerticalTypesetResult,
} from "../typeset/verticalTypography";
import {
  hasBrokenThaiLineBreak,
  isStructuredMangaList,
  isStructuredSectionHeaderLine,
  type FixedFontWidthResult,
} from "../textBoxWidthLayout";
import { inspectTargetText, formatOffendingCharacters } from "../languagePolicy";
import {
  growBubbleFrameToFit,
  layoutBubbleAtFixedFont,
  measureBubbleRenderFit,
  type BubbleTextFit,
} from "./bubbleTextFit";
import { resolveBubbleFontFamily } from "./canvasFont";
import type {
  BubbleProportionalLayout,
  OverlayAdjustment,
  OverlayTextStyle,
  TranslatedBubble,
} from "./overlayTypes";

const canvasShadowColor = (color: string, opacity: number): string => {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!hex) return color;
  const value = hex[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`;
};

const LAYOUT_SNAPSHOT_MAX_LINES = 400;

const isUsableLayoutSnapshot = (
  snapshot: BubbleProportionalLayout | undefined,
  text: string,
  fontFamily: string,
): snapshot is BubbleProportionalLayout =>
  !!snapshot
  && snapshot.text === text
  && snapshot.fontFamily === fontFamily
  && Array.isArray(snapshot.lines)
  && snapshot.lines.length > 0
  && snapshot.lines.length <= LAYOUT_SNAPSHOT_MAX_LINES
  && !hasBrokenThaiLineBreak(snapshot.lines)
  && (!isStructuredMangaList(text) || snapshot.selectionHeight >= (snapshot.lines.length - 1) * snapshot.fontSizePx * 1.15 + snapshot.fontSizePx * 0.85)
  && [
    snapshot.fontSizePx,
    snapshot.lineHeightPx,
    snapshot.frameWidthPx,
    snapshot.frameHeightPx,
    snapshot.selectionX,
    snapshot.selectionY,
    snapshot.selectionWidth,
    snapshot.selectionHeight,
    snapshot.bubbleMult,
    snapshot.globalMult,
  ].every((value) => typeof value === "number" && Number.isFinite(value));

export interface WidthLayoutPreview {
  layout: FixedFontWidthResult;
  text: string;
  widthPx: number;
  fontSizePx: number;
  fontFamily: string;
  isOval: boolean;
  manualMinHeightPx: number;
  availableHeightPx: number;
  locale: string;
}

export interface BubbleRenderSharedState {
  currentBx: number;
  currentBy: number;
  currentBw: number;
  currentBh: number;
  currentRotation: number;
  currentIsItalic: boolean;
  widthSelectionPreview: boolean;
  manualMinHeightPx: number | undefined;
  adj: OverlayAdjustment | undefined;
  layoutOverflow: boolean;
  resizeDragActive: boolean;
  floorBase: { w: number; h: number } | null;
  textSelection: SelectionRect;
  textLayoutOverflow: boolean;
  renderedFontSize: number;
  scriptNotice: string;
  sourceFontLoaded: boolean;
}

export interface BubbleRendererDeps {
  bubble: TranslatedBubble;
  wrapper: HTMLElement;
  canvas: HTMLCanvasElement;
  scriptWarningBadge: HTMLElement;
  textStyle: OverlayTextStyle;
  textStyleRef?: { current?: OverlayTextStyle };
  viewMode: "single" | "scroll" | "offscreen";
  pageWidth: number;
  pageHeight: number;
  targetLocale: string;
  effectiveTarget: string;
  baseAriaLabel: string;
  realBubbles: TranslatedBubble[];
  legacyAdjustment: OverlayAdjustment | undefined;
  adjustmentScaleX: number;
  state: BubbleRenderSharedState;
  updateBubbleFrame: () => void;
}

export const renderBubbleContent = (
  deps: BubbleRendererDeps,
  availableHeight?: number,
  snapshotScale = 1,
  widthLayoutPreview?: WidthLayoutPreview,
): void => {
  const {
    bubble: b,
    wrapper,
    canvas: bCanvas,
    scriptWarningBadge,
    textStyle: ts,
    textStyleRef,
    viewMode,
    pageWidth: iw,
    pageHeight: ih,
    targetLocale: wordWrapLocale,
    effectiveTarget,
    baseAriaLabel,
    realBubbles: real,
    legacyAdjustment: legacyAdj,
    adjustmentScaleX: adjSx,
    updateBubbleFrame,
  } = deps;
  const state = deps.state;
  if (availableHeight === undefined) {
    availableHeight = Math.max(0, ih - state.currentBy);
  }
  const currentStyle = textStyleRef?.current || ts;
  const rawText = b.t || b.translated || "";
  const scriptInspection = inspectTargetText(rawText, effectiveTarget);
  const text = scriptInspection.status === "eligible" ? scriptInspection.normalizedText.trim() : scriptInspection.normalizedText;
  wrapper.dataset.scriptStatus = scriptInspection.status;
  state.scriptNotice = scriptInspection.status === "blocked"
    ? scriptInspection.reason === "excluded-script"
      ? `ซ่อนคำแปลที่ผิดอักษร: ${formatOffendingCharacters(scriptInspection.offendingCharacters)} — เปิดแก้ไขข้อความ`
      : "ยังไม่ยืนยันภาษาของหน้า — เปิดแก้ไขข้อความ"
    : scriptInspection.normalizedText !== rawText ? "แสดงตัวเลขในรูปแบบที่รองรับ โดยเก็บข้อความเดิมไว้" : "";
  if (rawText && scriptInspection.status === "blocked" && viewMode !== "offscreen") {
    scriptWarningBadge.hidden = false;
    scriptWarningBadge.textContent = scriptInspection.reason === "excluded-script"
      ? `⚠️ พบอักษรปน (${formatOffendingCharacters(scriptInspection.offendingCharacters)}) — ดับเบิลคลิกเพื่อแก้`
      : "⚠️ ยังไม่ยืนยันภาษา — ดับเบิลคลิกเพื่อแก้";
  } else {
    scriptWarningBadge.hidden = true;
    scriptWarningBadge.textContent = "";
  }
  wrapper.title = state.scriptNotice;
  wrapper.setAttribute("aria-label", [baseAriaLabel, state.scriptNotice].filter(Boolean).join("; "));
  const currentFontFam = resolveBubbleFontFamily(b, currentStyle);
  const isExplicitlyLaidOut = Boolean(
    b.layoutAdjustment?.isAutoOptimized
    || b.layoutAdjustment?.userModified
    || state.adj?.isAutoOptimized
    || state.adj?.userModified,
  );
  const autoSizing = !isExplicitlyLaidOut && b.sourceSizing?.mode === 'auto' ? b.sourceSizing : undefined;
  const discardDerivedSize = () => {
    if (b.targetFontSize === autoSizing?.baseFontSizePx) delete b.targetFontSize;
    if (state.adj && autoSizing?.baseFontSizePx !== undefined && state.adj.targetFontSize === autoSizing.baseFontSizePx) delete state.adj.targetFontSize;
    if (legacyAdj && autoSizing?.baseFontSizePx !== undefined && legacyAdj.targetFontSize === autoSizing.baseFontSizePx) delete legacyAdj.targetFontSize;
  };
  if (autoSizing) {
    const evidence = autoSizing.evidence;
    if (evidence.regionKey !== sourceRegionKey(b.box) || evidence.policyVersion !== SOURCE_SIZE_POLICY) {
      b.sourceSizing = { mode: 'auto', status: 'fallback',
        evidence: { ...evidence, quality: 'unreliable', confidence: 0, reason: 'stale-source-region-or-policy' },
        fallbackLabel: SOURCE_SIZE_FALLBACK_LABEL };
      discardDerivedSize();
    } else if (autoSizing.font?.family !== currentFontFam || autoSizing.font?.textKey !== text || !state.sourceFontLoaded) {
      const metricContext = bCanvas.getContext('2d');
      if (metricContext) {
        b.sourceSizing = { ...autoSizing, ...resolveSourceFontSize(evidence, calibrateOutputBodyMetric(metricContext, evidence, currentFontFam, text, state.sourceFontLoaded)) };
        if (b.sourceSizing.status === 'matched') b.targetFontSize = b.sourceSizing.baseFontSizePx;
        else discardDerivedSize();
      }
    }
  }
  const bubbleMult = typeof b.fontSizeMultiplier === "number" ? b.fontSizeMultiplier : 1.0;
  const globalMult = currentStyle.fontSizeMultiplier || 1.0;
  const rawLockedFs = typeof b.targetFontSize === "number" && Number.isFinite(b.targetFontSize) && b.targetFontSize > 0
    ? b.targetFontSize
    : (typeof state.adj?.targetFontSize === "number" && Number.isFinite(state.adj.targetFontSize) && state.adj.targetFontSize > 0
      ? state.adj.targetFontSize
      : undefined);
  const lockedFs = typeof rawLockedFs === "number" && adjSx !== 1
    ? Math.max(8, Math.round(rawLockedFs * adjSx))
    : rawLockedFs;
  let fixedLayout: FixedFontWidthResult | null = null;
  let legacyFit: BubbleTextFit | null = null;
  let snapshotFit: { layout: BubbleProportionalLayout; scale: number } | null = null;

  // A usable proportional snapshot replaces re-wrapping: movement,
  // rotation, Undo/Redo and reopening re-render the committed layout
  // exactly (float font size, same lines). A corner release passes an
  // explicit scale to rescale the captured layout crisply in one pass.
  // Matched-auto bubbles always keep the fresh constrained layout so
  // source-space evidence and neighbor caps govern every render.
  const isMatchedAuto = !isExplicitlyLaidOut && b.sourceSizing?.mode === "auto" && b.sourceSizing.status === "matched";
  if (text && !isMatchedAuto && isUsableLayoutSnapshot(b.layoutSnapshot, text, currentFontFam)) {
    if (snapshotScale !== 1) {
      snapshotFit = { layout: b.layoutSnapshot, scale: snapshotScale };
    } else if (
      b.layoutSnapshot.globalMult === globalMult
      && b.layoutSnapshot.bubbleMult === bubbleMult
      && Boolean(b.layoutSnapshot.isItalic) === Boolean(b.isItalic ?? b.italic ?? state.currentIsItalic)
      && Math.abs(state.currentBw - b.layoutSnapshot.frameWidthPx) < 0.5
      && Math.abs(state.currentBh - b.layoutSnapshot.frameHeightPx) < 0.5
    ) {
      snapshotFit = { layout: b.layoutSnapshot, scale: 1 };
    }
  }

  if (snapshotFit) {
    state.textLayoutOverflow = snapshotFit.layout.overflow === true;
  } else {
  if (text && typeof lockedFs === "number") {
    const matchedAuto = !isExplicitlyLaidOut && b.sourceSizing?.mode === 'auto' && b.sourceSizing.status === 'matched';
    const scaledFs = lockedFs * (currentStyle.fontSizeMultiplier || 1.0) * bubbleMult;
    const effectiveFs = matchedAuto ? scaledFs : Math.max(8, Math.round(scaledFs));
    const savedManualMinimum = state.manualMinHeightPx
      ?? state.adj?.manualMinHeightPx
      ?? (state.adj ? state.currentBh : 25);
    const canReuseWidthPreview = widthLayoutPreview
      && widthLayoutPreview.text === text
      && widthLayoutPreview.widthPx === state.currentBw
      && widthLayoutPreview.fontSizePx === effectiveFs
      && widthLayoutPreview.fontFamily === currentFontFam
      && widthLayoutPreview.isOval === !b.isInvalidBox
      && widthLayoutPreview.manualMinHeightPx === savedManualMinimum
      && widthLayoutPreview.availableHeightPx === availableHeight
      && widthLayoutPreview.locale === wordWrapLocale;
    fixedLayout = canReuseWidthPreview
      ? widthLayoutPreview.layout
      : layoutBubbleAtFixedFont(
          text,
          state.currentBw,
          effectiveFs,
          currentFontFam,
          !b.isInvalidBox,
          savedManualMinimum,
          availableHeight,
          wordWrapLocale,
          false,
          b.scanlineRatios,
        );
    if (matchedAuto) {
      const neighbors = real.filter(other => other !== b && !other.deleted).flatMap(other => {
        const layout = other.layoutAdjustment;
        if (!layout) return [];
        const sx = iw / layout.iw, sy = ih / layout.ih;
        const width = layout.bw * sx, height = layout.bh * sy;
        const radians = (layout.rotation || 0) * Math.PI / 180;
        const boundWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
        const boundHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians));
        return [{ x: layout.bx * sx + (width - boundWidth) / 2,
          y: layout.by * sy + (height - boundHeight) / 2, width: boundWidth, height: boundHeight }];
      });
      const space = b.sourceSizing?.space;
      const evidence = space && space.sourceRevision === b.sourceSizing?.evidence.sourceRevision &&
        space.regionKey === b.sourceSizing?.evidence.regionKey ? space : undefined;
      const constrained = constrainSourceLayoutHeight({x: state.currentBx, y: state.currentBy, width: state.currentBw, height: state.currentBh},
        Math.max(fixedLayout.requiredHeightPx, savedManualMinimum), evidence,
        b.userTextSpace && b.userTextSpace.imageWidth === iw && b.userTextSpace.imageHeight === ih ? b.userTextSpace.rect : undefined, neighbors);
      state.currentBh = constrained.height;
      fixedLayout = {...fixedLayout, heightPx: state.currentBh, overflow: fixedLayout.overflow || constrained.overflow};
    } else state.currentBh = fixedLayout.heightPx;
  } else {
    legacyFit = null;
  }

  // Frame floor: when the font has already reached its floor and the
  // text still cannot fit, grow the frame around its center instead of
  // letting the text overflow the bubble. Growth is anchored to the
  // last committed/fitting size (floorBase) so re-renders never
  // compound it, and it pauses entirely while a resize drag is live —
  // otherwise dragging smaller made the frame snap back and balloon.
  if (text && !state.resizeDragActive && !fixedLayout) {
    legacyFit = measureBubbleRenderFit(
      text, state.currentBw, state.currentBh, iw, currentFontFam,
      currentStyle.fontSizeMultiplier || 1.0, bubbleMult, !b.isInvalidBox,
      lockedFs,
      wordWrapLocale,
      false,
      b.scanlineRatios,
    );
    if (legacyFit.fits) {
      state.floorBase = { w: state.currentBw, h: state.currentBh };
    } else {
      if (!state.floorBase) state.floorBase = { w: state.currentBw, h: state.currentBh };
      const lockWidth = Boolean(state.adj || b.layoutAdjustment || lockedFs);
      const baseW = lockWidth ? state.currentBw : state.floorBase.w;
      const grown = growBubbleFrameToFit(
        text, baseW, state.floorBase.h, iw, ih, currentFontFam,
        currentStyle.fontSizeMultiplier || 1.0, bubbleMult, !b.isInvalidBox,
        lockWidth,
        lockedFs,
        wordWrapLocale,
        false,
        b.scanlineRatios,
      );
      state.currentBw = grown.width;
      state.currentBh = grown.height;
      state.floorBase = { w: state.currentBw, h: state.currentBh };
      if (!lockWidth) {
        const cx = state.currentBx + state.currentBw / 2;
        const cy = state.currentBy + state.currentBh / 2;
        state.currentBx = Math.max(0, Math.min(iw - state.currentBw, cx - state.currentBw / 2));
        state.currentBy = Math.max(0, Math.min(ih - state.currentBh, cy - state.currentBh / 2));
      }
      legacyFit = measureBubbleRenderFit(
        text, state.currentBw, state.currentBh, iw, currentFontFam,
        currentStyle.fontSizeMultiplier || 1.0, bubbleMult, !b.isInvalidBox,
        lockedFs, wordWrapLocale,
        false,
        b.scanlineRatios,
      );
    }
  }

  if (text && !fixedLayout && !legacyFit) {
    legacyFit = measureBubbleRenderFit(
      text, state.currentBw, state.currentBh, iw, currentFontFam,
      currentStyle.fontSizeMultiplier || 1.0, bubbleMult, !b.isInvalidBox,
      lockedFs, wordWrapLocale,
      false,
      b.scanlineRatios,
    );
  }
  state.textLayoutOverflow = fixedLayout ? fixedLayout.overflow : Boolean(text && !legacyFit?.fits);
  }
  bCanvas.width = Math.round(state.currentBw);
  bCanvas.height = Math.round(state.currentBh);
  const ctx = bCanvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, state.currentBw, state.currentBh);
  if (!text || scriptInspection.status === "blocked") {
    state.textSelection = { x: 0, y: 0, width: state.currentBw, height: state.currentBh };
    // An empty frame has no proportional layout to reuse later.
    if (!text) delete b.layoutSnapshot;
    updateBubbleFrame();
    return;
  }
  const resolvedStyle = resolveBubbleTextStyle(b, currentStyle);
  const textColor = resolvedStyle.textColor;
  const outlineColor = resolvedStyle.textOutline;
  const customOpacity = (b as { opacity?: number }).opacity;
  const opacity = typeof customOpacity === "number" ? customOpacity : (resolvedStyle.opacity ?? 1.0);
  const fit = snapshotFit
    ? {
        fontSize: snapshotFit.layout.fontSizePx * snapshotFit.scale,
        lines: snapshotFit.layout.lines,
        lineHeight: snapshotFit.layout.lineHeightPx * snapshotFit.scale,
        fits: true,
      }
    : fixedLayout
    ? {
        fontSize: fixedLayout.fontSizePx,
        lines: fixedLayout.lines,
        lineHeight: fixedLayout.fontSizePx * 1.30,
        fits: !state.layoutOverflow,
      }
    : legacyFit ?? measureBubbleRenderFit(
        text,
        state.currentBw,
        state.currentBh,
        iw,
        currentFontFam,
        currentStyle.fontSizeMultiplier || 1.0,
        bubbleMult,
        !b.isInvalidBox,
        lockedFs,
        wordWrapLocale,
        false,
        b.scanlineRatios,
      );
  const isVerticalRequested = Boolean(
    (b as { vertical?: boolean }).vertical ??
    (isCJKLanguage(wordWrapLocale) && shouldPreferVerticalTypesetting(state.currentBw, state.currentBh, wordWrapLocale))
  );
  const verticalFit: VerticalTypesetResult | null = isVerticalRequested
    ? fitTextVertically(
        text,
        {
          x: 0,
          y: 0,
          width: state.currentBw,
          height: state.currentBh,
          scanlineRatios: b.scanlineRatios ?? [],
        },
        10,
        Math.max(14, Math.round(Math.min(state.currentBh * 0.45, state.currentBw * 0.45, 96) * bubbleMult)),
      )
    : null;
  const isVerticalActive = Boolean(verticalFit && verticalFit.columns.length > 0);
  const fontSize = isVerticalActive && verticalFit ? verticalFit.fontSize : fit.fontSize;
  state.renderedFontSize = fontSize;
  const lines = fit.lines;
  const lineH = snapshotFit
    ? snapshotFit.layout.lineHeightPx * snapshotFit.scale
    : fixedLayout ? fontSize * 1.30 : Math.min(fontSize * 1.30, state.currentBh / Math.max(1, lines.length));

  const comicCategory = (b.bubbleCategory || (b as { category?: BubbleCategory }).category) as BubbleCategory | undefined;
  const categoryRules = comicCategory ? resolveCategoryTypography(comicCategory, fontSize, b.warp) : undefined;

  state.currentIsItalic = Boolean(
    b.isItalic ?? b.italic ?? (categoryRules?.fontStyle === "italic" ? true : state.currentIsItalic),
  );
  const isBoldFlag = (b as { isBold?: boolean }).isBold ?? true;
  const weightToken = categoryRules?.fontWeight ?? (isBoldFlag ? "bold" : "normal");
  const fontStylePrefix = state.currentIsItalic ? `italic ${weightToken}` : weightToken;
  ctx.globalAlpha = opacity;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${fontStylePrefix} ${fontSize}px ${currentFontFam}`;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.miterLimit = 2;
  ctx.strokeStyle = outlineColor;
  const customStrokeWidth = (b as { strokeWidth?: number }).strokeWidth;
  const baseOutlineWidth = resolvedStyle.hasOutline
    ? Math.max(
        categoryRules?.dynamicStrokeWidth ?? (resolvedStyle.outlineWidthRatio >= 0.18 ? 3.2 : 1),
        fontSize * resolvedStyle.outlineWidthRatio,
      )
    : 0;
  ctx.lineWidth =
    typeof customStrokeWidth === "number"
      ? customStrokeWidth
      : baseOutlineWidth;

  let fillPaint: string | CanvasGradient = textColor;
  const gradient = resolvedStyle.fillGradient;
  if (gradient && gradient.stops.length >= 2) {
    const angle = (gradient.angleDeg * Math.PI) / 180;
    const half = Math.max(state.currentBw, state.currentBh) / 2;
    const cx = state.currentBw / 2;
    const cy = state.currentBh / 2;
    const dx = Math.cos(angle) * half;
    const dy = Math.sin(angle) * half;
    const canvasGradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    for (const stop of gradient.stops) {
      canvasGradient.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color);
    }
    fillPaint = canvasGradient;
  }

  const visualEffect = resolvedStyle.shadow;
  if (visualEffect) {
    ctx.shadowColor = canvasShadowColor(visualEffect.color, visualEffect.opacity);
    ctx.shadowBlur = Math.max(0, fontSize * visualEffect.blurRatio);
    ctx.shadowOffsetX = fontSize * visualEffect.offsetXRatio;
    ctx.shadowOffsetY = fontSize * visualEffect.offsetYRatio;
  } else {
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  const structuredRender = isStructuredMangaList(text);
  const lineYOffsets: number[] = [];
  let seenBullet = false;
  if (structuredRender && lines.length > 0) {
    let accY = 0;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const isBulletStart = trimmed.startsWith("•") || trimmed.startsWith("-");
      const isHeader = !isBulletStart && isStructuredSectionHeaderLine(trimmed);
      if (i > 0) {
        if (isHeader) {
          accY += fontSize * (seenBullet ? 1.62 : 1.42);
        } else if (isBulletStart) {
          accY += fontSize * 1.36;
        } else {
          accY += fontSize * 1.22;
        }
      }
      if (isBulletStart) seenBullet = true;
      else if (isHeader) seenBullet = false;
      lineYOffsets.push(accY);
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      lineYOffsets.push(i * lineH);
    }
  }

  const totalH = lineYOffsets.length > 0 ? lineYOffsets[lineYOffsets.length - 1] : 0;
  const neededCanvasH = lines.length > 0 ? Math.ceil(totalH + fontSize * 1.55) : state.currentBh;
  if (structuredRender && !state.resizeDragActive && snapshotScale === 1 && state.currentBh < neededCanvasH) {
    state.currentBh = Math.min(ih, Math.max(state.currentBh, neededCanvasH));
    if (state.currentBy + state.currentBh > ih) {
      state.currentBy = Math.max(0, ih - state.currentBh);
    }
    state.textLayoutOverflow = neededCanvasH > ih;
    bCanvas.height = Math.round(state.currentBh);
    ctx.clearRect(0, 0, state.currentBw, state.currentBh);
    ctx.globalAlpha = opacity;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontStylePrefix} ${fontSize}px ${currentFontFam}`;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.miterLimit = 2;
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = resolvedStyle.hasOutline
      ? Math.max(resolvedStyle.outlineWidthRatio >= 0.18 ? 3.2 : 1, fontSize * resolvedStyle.outlineWidthRatio)
      : 0;
    if (visualEffect) {
      ctx.shadowColor = canvasShadowColor(visualEffect.color, visualEffect.opacity);
      ctx.shadowBlur = Math.max(0, fontSize * visualEffect.blurRatio);
      ctx.shadowOffsetX = fontSize * visualEffect.offsetXRatio;
      ctx.shadowOffsetY = fontSize * visualEffect.offsetYRatio;
    }
  }

  // Overflow frames anchor the first line to the top padding so the
  // leading lines stay readable instead of symmetric clipping that can
  // hide both the first and last lines behind the frame edges.
  const startY = state.textLayoutOverflow
    ? Math.max(fontSize * 0.75, lineH / 2)
    : (state.currentBh / 2) - (totalH / 2);
  let inBulletItem = false;
  const leftPad = Math.max(6, Math.round(state.currentBw * 0.04));
  const indentPad = leftPad + Math.round(fontSize * 0.85);

  const effectiveWarp =
    b.warp && b.warp.type !== "none"
      ? b.warp
      : categoryRules?.warpConfig;
  const isWarped = Boolean(
    effectiveWarp &&
    (effectiveWarp.type !== "none" ||
      (typeof effectiveWarp.horizontal === "number" && Math.abs(effectiveWarp.horizontal) >= 0.001) ||
      (typeof effectiveWarp.vertical === "number" && Math.abs(effectiveWarp.vertical) >= 0.001))
  );
  let activeCtx: CanvasRenderingContext2D = ctx;
  let warpCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  if (isWarped) {
    warpCanvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(bCanvas.width, bCanvas.height)
        : document.createElement("canvas");
    warpCanvas.width = bCanvas.width;
    warpCanvas.height = bCanvas.height;
    activeCtx = warpCanvas.getContext("2d") as CanvasRenderingContext2D;
    activeCtx.globalAlpha = opacity;
    activeCtx.textAlign = "center";
    activeCtx.textBaseline = "middle";
    activeCtx.font = `${fontStylePrefix} ${fontSize}px ${currentFontFam}`;
    activeCtx.lineJoin = "round";
    activeCtx.lineCap = "round";
    activeCtx.miterLimit = 2;
    activeCtx.strokeStyle = outlineColor;
    activeCtx.lineWidth = ctx.lineWidth;
    if (visualEffect) {
      activeCtx.shadowColor = ctx.shadowColor;
      activeCtx.shadowBlur = ctx.shadowBlur;
      activeCtx.shadowOffsetX = ctx.shadowOffsetX;
      activeCtx.shadowOffsetY = ctx.shadowOffsetY;
    }
  }

  const customBoxFill = (b as { boxFill?: string }).boxFill;
  if (typeof customBoxFill === "string" && customBoxFill.trim()) {
    activeCtx.save();
    activeCtx.fillStyle = customBoxFill;
    activeCtx.fillRect(0, 0, state.currentBw, state.currentBh);
    activeCtx.restore();
  }

  const drawLineWithOptionalSlant = (lineText: string, drawX: number, drawY: number) => {
    if (state.currentIsItalic && typeof activeCtx.save === "function" && typeof activeCtx.transform === "function" && typeof activeCtx.restore === "function") {
      activeCtx.save();
      const slant = -0.18;
      activeCtx.transform(1, 0, slant, 1, -drawY * slant, 0);
      if (resolvedStyle.hasOutline && activeCtx.lineWidth > 0) {
        activeCtx.strokeText(lineText, drawX, drawY);
      }
      activeCtx.fillStyle = fillPaint;
      activeCtx.fillText(lineText, drawX, drawY);
      activeCtx.restore();
    } else {
      if (resolvedStyle.hasOutline && activeCtx.lineWidth > 0) {
        activeCtx.strokeText(lineText, drawX, drawY);
      }
      activeCtx.fillStyle = fillPaint;
      activeCtx.fillText(lineText, drawX, drawY);
    }
  };

  if (isVerticalActive && verticalFit) {
    activeCtx.textAlign = "center";
    activeCtx.textBaseline = "middle";
    for (const col of verticalFit.columns) {
      for (const glyph of col.glyphs) {
        const drawX = col.x + (glyph.offsetX ?? 0);
        const drawY = glyph.y;
        if (glyph.rotateDeg) {
          activeCtx.save();
          activeCtx.translate(drawX, drawY);
          activeCtx.rotate((glyph.rotateDeg * Math.PI) / 180);
          drawLineWithOptionalSlant(glyph.char, 0, 0);
          activeCtx.restore();
        } else {
          drawLineWithOptionalSlant(glyph.char, drawX, drawY);
        }
      }
    }
  } else {
    lines.forEach((l, i) => {
      const yPos = startY + (lineYOffsets[i] ?? i * lineH);
      if (structuredRender) {
        const trimmed = l.trim();
        const isBulletStart = trimmed.startsWith("•") || trimmed.startsWith("-");
        const isSectionHeader = !isBulletStart && (isStructuredSectionHeaderLine(trimmed) || !inBulletItem);
        if (isBulletStart) {
          inBulletItem = true;
          activeCtx.textAlign = "left";
          drawLineWithOptionalSlant(l, leftPad, yPos);
        } else if (isSectionHeader) {
          inBulletItem = false;
          activeCtx.textAlign = "center";
          drawLineWithOptionalSlant(l, state.currentBw / 2, yPos);
        } else {
          activeCtx.textAlign = "left";
          drawLineWithOptionalSlant(l, indentPad, yPos);
        }
      } else {
        const customAlign = (b as { align?: "left" | "center" | "right" }).align || "center";
        activeCtx.textAlign = customAlign;
        const alignX =
          customAlign === "left"
            ? leftPad
            : customAlign === "right"
              ? state.currentBw - leftPad
              : state.currentBw / 2;
        drawLineWithOptionalSlant(l, alignX, yPos);
      }
    });
  }
  activeCtx.textAlign = "center";

  if (isWarped && warpCanvas && effectiveWarp) {
    ctx.clearRect(0, 0, state.currentBw, state.currentBh);
    renderWarpedText(ctx, warpCanvas, 0, 0, effectiveWarp);
  }
  // Snapshot renders keep the captured selection (scaled for a corner
  // release) so the crisp redraw, reopening, and Undo/Redo all show the
  // exact previewed geometry; its padding is additive while scaling is
  // proportional, so re-measuring would shift the anchor between the
  // previewed and committed states. Fresh renders take the measurement.
  const avgLineH = lines.length > 1 ? totalH / (lines.length - 1) : lineH;
  const baseMeasuredSelection = snapshotFit
    ? { x: snapshotFit.layout.selectionX * snapshotFit.scale,
        y: snapshotFit.layout.selectionY * snapshotFit.scale,
        width: snapshotFit.layout.selectionWidth * snapshotFit.scale,
        height: snapshotFit.layout.selectionHeight * snapshotFit.scale }
    : measureTextSelection(ctx, lines, fontSize, avgLineH, state.currentBw, state.currentBh);
  if (structuredRender && lines.length > 0) {
    const strokePad = (ctx.lineWidth > 0 ? ctx.lineWidth / 2 : 0) + 4;
    const topY = Math.max(0, Math.floor(startY - fontSize * 0.85 - strokePad));
    const botY = Math.min(state.currentBh, Math.ceil(startY + totalH + fontSize * 0.65 + strokePad));
    const minX = Math.max(0, Math.min(Math.floor(leftPad - strokePad), Math.floor(baseMeasuredSelection.x)));
    const maxX = Math.min(
      state.currentBw,
      Math.max(
        Math.ceil(state.currentBw - leftPad + strokePad),
        Math.ceil(baseMeasuredSelection.x + baseMeasuredSelection.width),
      ),
    );
    state.textSelection = {
      x: minX,
      y: topY,
      width: Math.max(20, maxX - minX),
      height: Math.max(20, botY - topY),
    };
  } else {
    state.textSelection = baseMeasuredSelection;
  }
  // Capture the bounded proportional layout of this render so corner
  // drags preview with this bitmap and later re-renders (movement,
  // rotation, Undo/Redo, reopen) reproduce it exactly.
  if (lines.length > 0 && lines.length <= LAYOUT_SNAPSHOT_MAX_LINES) {
    b.layoutSnapshot = {
      text,
      fontFamily: currentFontFam,
      fontSizePx: fontSize,
      lineHeightPx: lineH,
      lines: [...lines],
      frameWidthPx: state.currentBw,
      frameHeightPx: state.currentBh,
      selectionX: state.textSelection.x,
      selectionY: state.textSelection.y,
      selectionWidth: state.textSelection.width,
      selectionHeight: state.textSelection.height,
      bubbleMult,
      globalMult,
      isItalic: state.currentIsItalic,
      overflow: state.textLayoutOverflow,
    };
  }
  updateBubbleFrame();
};
