import { resolveBubbleTextStyle } from "./colorMatching/resolveTextStyle";
import { sampleBubbleRegion } from "./colorMatching/canvasSampler";
import { extractTextColors } from "./colorMatching/sampleTextColors";

const ADJ_KEY = "superk:overlay-adjustments";

/** A translated bubble produced by the LLM / manual editor.
 *  Loose by design: carries optional rendering metadata added at runtime. */
export interface TranslatedBubble {
  t?: string;
  translated?: string;
  original_text?: string;
  /** bounding box [ymin, xmin, ymax, xmax] in 0-1000 scale */
  box?: number[];
  isManual?: boolean;
  isInvalidBox?: boolean;
  /** runtime flag set once the user has manually resized a bubble */
  __resized?: boolean;
  /** runtime flag set once the user has deleted a bubble */
  deleted?: boolean;
  /** redraw callback attached to overlay bubbles */
  render?: () => void;
  styleProfile?: {
    fill?: string;
    outline?: string;
    fillConfidence?: number;
    outlineConfidence?: number;
    source?: "auto" | "manual" | "global";
  };
  [key: string]: unknown;
}

/** Style options for the translation text overlay. */
export interface OverlayTextStyle {
  fontFamily?: string;
  fontSizeMultiplier?: number;
  textColor?: string;
  textOutline?: string;
  [key: string]: unknown;
}

export interface OverlayAdjustment {
  bx: number;
  by: number;
  bw: number;
  bh: number;
  iw: number;
  ih: number;
  rotation?: number;
}

export const readOverlayAdjustments = (): Record<string, Record<string, OverlayAdjustment>> => {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    return JSON.parse(localStorage.getItem(ADJ_KEY) || "{}");
  } catch {
    return {};
  }
};

export const saveOverlayAdjustments = (adjustments: Record<string, Record<string, OverlayAdjustment>>): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(ADJ_KEY, JSON.stringify(adjustments));
  } catch {}
};

export const clearPageAdjustments = (pageIndex: number): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const all = readOverlayAdjustments();
    const pageKey = `page-${pageIndex}`;
    if (all[pageKey]) {
      delete all[pageKey];
      localStorage.setItem(ADJ_KEY, JSON.stringify(all));
    }
  } catch {}
};

export const clearAllAdjustments = (): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.removeItem(ADJ_KEY);
  } catch {}
};

export const downloadTranslatedImage = (
  viewMode: "single" | "scroll" | "offscreen",
  currentPage: number,
  defaultFilename = "translated.png",
  returnDataUrl = false,
  containerOverride?: Element,
) => {
  let container: Element | null | undefined = containerOverride;
  if (!container && viewMode === "offscreen") {
    container = document.getElementById("offscreen-container");
  } else if (!container && viewMode === "scroll") {
    container = document.querySelector(`#spage-${currentPage}`);
  } else if (!container) {
    container = document.getElementById("pageContainer");
  }
  if (!container) return null;

  const img = container.querySelector("img");
  if (!img) return null;

  const iw = img.naturalWidth || img.offsetWidth;
  const ih = img.naturalHeight || img.offsetHeight;

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = iw;
  exportCanvas.height = ih;
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, iw, ih);

  const wrappers = container.querySelectorAll(".tl-canvas > div");
  wrappers.forEach((wrapperEl) => {
    const wrapper = wrapperEl as HTMLElement;
    const leftPercent = parseFloat(wrapper.style.left) || 0;
    const topPercent = parseFloat(wrapper.style.top) || 0;
    const widthPercent = parseFloat(wrapper.style.width) || 0;
    const heightPercent = parseFloat(wrapper.style.height) || 0;
    
    const bCanvas = wrapper.querySelector("canvas");
    if (bCanvas) {
      const pLeftPercent = parseFloat(bCanvas.style.left) || 0;
      const pTopPercent = parseFloat(bCanvas.style.top) || 0;
      
      const absLeft = (leftPercent / 100) * iw;
      const absTop = (topPercent / 100) * ih;
      
      const wrapperAbsW = (widthPercent / 100) * iw;
      const wrapperAbsH = (heightPercent / 100) * ih;
      
      const bCanvasAbsLeft = absLeft + (pLeftPercent / 100) * wrapperAbsW;
      const bCanvasAbsTop = absTop + (pTopPercent / 100) * wrapperAbsH;
      
      const rotMatch = wrapper.style.transform.match(/rotate\(([-\d.]+)deg\)/);
      const rotDeg = rotMatch ? parseFloat(rotMatch[1]) : 0;
      if (rotDeg) {
        ctx.save();
        const centerX = bCanvasAbsLeft + bCanvas.width / 2;
        const centerY = bCanvasAbsTop + bCanvas.height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate((rotDeg * Math.PI) / 180);
        ctx.drawImage(bCanvas, -bCanvas.width / 2, -bCanvas.height / 2, bCanvas.width, bCanvas.height);
        ctx.restore();
      } else {
        ctx.drawImage(bCanvas, bCanvasAbsLeft, bCanvasAbsTop, bCanvas.width, bCanvas.height);
      }
    }
  });

  const dataUrl = exportCanvas.toDataURL("image/jpeg", 0.9);
  if (returnDataUrl) return dataUrl;

  const link = document.createElement("a");
  link.download = defaultFilename;
  link.href = dataUrl;
  link.click();
  return dataUrl;
};

export const getReadableMinimumFontSize = (pageWidth: number): number => {
  if (!pageWidth || pageWidth <= 0) return 14;
  return Math.max(14, Math.round(pageWidth * 0.0225));
};

export const wrapTextForBubble = (
  text: string,
  maxW: number,
  maxH: number,
  fs: number,
  fontFamily: string = "sans-serif",
  isOval: boolean = true,
  locale: string = "th",
): string[] => {
  if (!text || !text.trim()) return [];
  
  let wds: string[] = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
      const rawSegments = Array.from(segmenter.segment(text)).map(s => s.segment);
      // Combine punctuation to preceding word where practical
      for (const seg of rawSegments) {
        if (/^[.,!?:;...]+$/.test(seg) && wds.length > 0) {
          wds[wds.length - 1] += seg;
        } else {
          wds.push(seg);
        }
      }
    } catch {
      wds = text.split(/\s+/);
    }
  } else {
    wds = text.split(/\s+/);
  }

  let measureFn: (str: string) => number;
  const tempCanvas = typeof document !== 'undefined' ? document.createElement("canvas") : null;
  const tempCtx = tempCanvas ? tempCanvas.getContext("2d") : null;
  if (tempCtx) {
    tempCtx.font = `bold ${fs}px ${fontFamily}`;
    measureFn = (str: string) => tempCtx.measureText(str).width;
  } else {
    measureFn = (str: string) => str.length * (fs * 0.6);
  }

  const lineH = fs * 1.35;
  const estimatedLineCount = Math.max(1, Math.round(maxH / lineH));

  const getLineMaxW = (lineIndex: number, totalLines: number): number => {
    if (!isOval || totalLines <= 1) return maxW;
    const yCenter = (lineIndex + 0.5) / totalLines;
    const v = (yCenter - 0.5) * 2;
    const chordRatio = Math.sqrt(Math.max(0.2, 1 - v * v));
    return Math.min(maxW, Math.max(Math.min(maxW, fs * 1.5), maxW * chordRatio * 0.95));
  };

  let bestLines: string[] = [];

  for (let tryLines = Math.max(1, estimatedLineCount - 1); tryLines <= estimatedLineCount + 3; tryLines++) {
    const lines: string[] = [];
    let cur = "";
    let lineIdx = 0;

    for (const w of wds) {
      const allowedW = getLineMaxW(lineIdx, tryLines);
      const test = cur ? (cur + w) : w;
      if (measureFn(test) > allowedW && cur) {
        lines.push(cur);
        cur = w;
        lineIdx++;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);

    bestLines = lines;
    if (lines.length * lineH <= maxH * 1.15) {
      break;
    }
  }

  return bestLines.length > 0 ? bestLines : [text];
};

export interface BubbleTextFit {
  fontSize: number;
  lines: string[];
  lineHeight: number;
  fits: boolean;
}

export function fitTextForBubble(
  text: string,
  width: number,
  height: number,
  fontFamily: string = "sans-serif",
  isOval: boolean = true,
  fontSizeMultiplier = 1,
  minFontSize = 14,
): BubbleTextFit {
  const safeW = width * 0.88;
  const safeH = height * 0.88;
  const maxFs = Math.max(minFontSize, Math.round(Math.min(height * 0.55, width * 0.55, 96) * fontSizeMultiplier));
  
  let bestFit: BubbleTextFit = {
    fontSize: minFontSize,
    lines: wrapTextForBubble(text, safeW, safeH, minFontSize, fontFamily, isOval),
    lineHeight: minFontSize * 1.30,
    fits: false,
  };

  for (let fs = maxFs; fs >= minFontSize; fs--) {
    const lineH = fs * 1.30;
    const lines = wrapTextForBubble(text, safeW, safeH, fs, fontFamily, isOval);
    const totalH = lines.length * lineH;
    
    let maxWidthOk = true;
    const tempCanvas = typeof document !== 'undefined' ? document.createElement("canvas") : null;
    const tempCtx = tempCanvas ? tempCanvas.getContext("2d") : null;
    if (tempCtx) {
      tempCtx.font = `bold ${fs}px ${fontFamily}`;
      for (let i = 0; i < lines.length; i++) {
        const allowed = isOval && lines.length > 1 ? safeW * Math.sqrt(Math.max(0.2, 1 - Math.pow(((i + 0.5) / lines.length - 0.5) * 2, 2))) : safeW;
        if (tempCtx.measureText(lines[i]).width > allowed * 1.05) {
          maxWidthOk = false;
          break;
        }
      }
    } else {
      for (const l of lines) {
        if (l.length * (fs * 0.6) > safeW * 1.05) {
          maxWidthOk = false;
          break;
        }
      }
    }

    if (totalH <= safeH && maxWidthOk) {
      return {
        fontSize: fs,
        lines,
        lineHeight: lineH,
        fits: true,
      };
    }
    if (fs === minFontSize) {
      bestFit = {
        fontSize: fs,
        lines,
        lineHeight: lineH,
        fits: totalH <= safeH && maxWidthOk,
      };
    }
  }

  return bestFit;
}

export function measureTextLinesWidth(
  lines: string[],
  fontSize: number,
  fontFamily: string = "sans-serif",
): number {
  if (!lines || lines.length === 0) return 0;
  const tempCanvas = typeof document !== 'undefined' ? document.createElement("canvas") : null;
  const tempCtx = tempCanvas ? tempCanvas.getContext("2d") : null;
  if (tempCtx) {
    tempCtx.font = `bold ${fontSize}px ${fontFamily}`;
    let maxW = 0;
    for (const line of lines) {
      const w = tempCtx.measureText(line).width;
      if (w > maxW) maxW = w;
    }
    return maxW;
  }
  let maxLen = 0;
  for (const line of lines) {
    if (line.length > maxLen) maxLen = line.length;
  }
  return maxLen * (fontSize * 0.6);
}

export interface AdaptiveBubbleLayout extends BubbleTextFit {
  width: number;
  height: number;
}

export function fitTextInAdaptiveBubble(
  text: string,
  width: number,
  height: number,
  fontFamily: string = "sans-serif",
  isOval: boolean = true,
  fontSizeMultiplier = 1,
  minFontSize = 14,
  maxScale = 3.0,
): AdaptiveBubbleLayout {
  let curW = width;
  let curH = height;
  const maxW = width * maxScale;
  const maxH = height * maxScale;

  let fit = fitTextForBubble(text, curW, curH, fontFamily, isOval, fontSizeMultiplier, minFontSize);

  while ((curW < maxW || curH < maxH) && !fit.fits) {
    curW = Math.min(maxW, curW * 1.25);
    curH = Math.min(maxH, curH * 1.25);
    fit = fitTextForBubble(text, curW, curH, fontFamily, isOval, fontSizeMultiplier, minFontSize);
    if (fit.fits) break;
  }

  // Snug fit: tighten dimensions to the actual text content instead of keeping giant empty margins
  if (fit.lines.length > 0) {
    const textH = (fit.lines.length - 1) * fit.lineHeight + fit.fontSize * 1.25;
    const textW = measureTextLinesWidth(fit.lines, fit.fontSize, fontFamily);
    const snugW = Math.max(28, Math.min(curW, Math.ceil(textW * 1.22)));
    const snugH = Math.max(20, Math.min(curH, Math.ceil(textH * 1.22)));
    return {
      ...fit,
      width: snugW,
      height: snugH,
    };
  }

  return { ...fit, width: curW, height: curH };
}

export const applyTranslationOverlay = async (
  bubbles: TranslatedBubble[],
  viewMode: "single" | "scroll" | "offscreen",
  currentPage: number,
  setTranslationResult: (msg: string | null) => void,
  onComplete?: (dataUrl: string) => void,
  textStyleRef?: React.MutableRefObject<OverlayTextStyle>,
  containerOverride?: Element,
) => {
  let container: Element | null | undefined = containerOverride;
  if (!container && viewMode === "offscreen") {
    container = document.getElementById("offscreen-container");
  } else if (!container && viewMode === "scroll") {
    container = document.querySelector(`#spage-${currentPage}`);
  } else if (!container) {
    container = document.getElementById("pageContainer");
  }
  
  if (!container) return;

  container.querySelectorAll(".tl-overlay,.tl-canvas").forEach((el) => {
    if (typeof (el as unknown as { _cleanupListeners?: () => void })._cleanupListeners === "function") {
      (el as unknown as { _cleanupListeners: () => void })._cleanupListeners();
    }
    el.remove();
  });
  const img = container.querySelector("img");
  if (!img) return;
  img.ondragstart = (e) => e.preventDefault();

  const real = bubbles.filter(b => b && !b.deleted && (b.t || b.translated) && (b.t ?? b.translated ?? "").trim());
  if (real.length === 0) {
    setTranslationResult("❌ ไม่พบข้อความที่แปลได้ในหน้านี้");
    return;
  }

  const paint = async () => {
    await document.fonts.load('bold 16px Itim');
    const iw = img.naturalWidth || img.offsetWidth;
    const ih = img.naturalHeight || img.offsetHeight;
    if (!iw || !ih) { setTimeout(paint, 100); return; }

    const pageKey = `page-${currentPage}`;
    const savedAdj = readOverlayAdjustments()[pageKey] || {};

    const tlContainer = document.createElement("div");
    tlContainer.className = "tl-canvas";
    tlContainer.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:10;`;
    container.appendChild(tlContainer);

    let fallbackY2 = 10;

    setTranslationResult("✨ วางข้อความแปลเสร็จเรียบร้อย!");

    let selectedBubbleWrapper: HTMLElement | null = null;
    const setSelectedBubble = (wrapper: HTMLElement | null) => {
      if (selectedBubbleWrapper && selectedBubbleWrapper !== wrapper) {
        selectedBubbleWrapper.style.outline = "none";
        selectedBubbleWrapper.style.zIndex = "10";
        selectedBubbleWrapper.removeAttribute("data-selected");
        selectedBubbleWrapper.querySelectorAll(".action-handle, .bubble-quick-toolbar, .delete-btn, .edit-btn").forEach((h) => {
          (h as HTMLElement).style.opacity = "0";
          (h as HTMLElement).style.pointerEvents = "none";
        });
      }
      selectedBubbleWrapper = wrapper;
      if (wrapper) {
        wrapper.style.outline = "2px solid #3b82f6";
        wrapper.style.zIndex = "30";
        wrapper.setAttribute("data-selected", "true");
        wrapper.querySelectorAll(".action-handle, .bubble-quick-toolbar, .delete-btn, .edit-btn").forEach((h) => {
          (h as HTMLElement).style.opacity = "1";
          (h as HTMLElement).style.pointerEvents = "auto";
        });
      }
    };

    real.forEach((b) => {
      let rawX = 50, rawY = 50, rawW = 20, rawH = 10;
      let isInvalidBox = false;

      if (b.box && Array.isArray(b.box) && b.box.length === 4) {
        const [ymin, xmin, ymax, xmax] = b.box;
        if (typeof ymin === 'number' && typeof xmin === 'number' && typeof ymax === 'number' && typeof xmax === 'number') {
          if (xmin === 0 && ymin === 0 && xmax === 1000 && ymax === 1000) {
            isInvalidBox = true;
          } else {
            rawX = (xmin + xmax) / 2 / 10;
            rawY = (ymin + ymax) / 2 / 10;
            rawW = Math.max(4, (xmax - xmin) / 10);
            rawH = Math.max(2, (ymax - ymin) / 10);
          }
        }
      }

      if (isInvalidBox) {
        rawX = 50; rawY = fallbackY2;
        fallbackY2 = (fallbackY2 + 15 > 85) ? 8 : fallbackY2 + 12;
        rawW = 30; rawH = 15;
        b.isInvalidBox = true;
      }

      // Sample color profile on-the-fly from the rendered image if not yet analyzed
      if (!b.styleProfile && img && (img.naturalWidth > 0 || img.width > 0) && b.box && b.box.length === 4 && !b.isInvalidBox) {
        const sample = sampleBubbleRegion(img, b.box);
        if (sample) {
          b.styleProfile = extractTextColors(sample);
        }
      }

      const bubbleId = b.id !== undefined ? `id-${b.id}` : `text-${(b.t || b.translated || "").slice(0, 10)}-${rawX.toFixed(1)}-${rawY.toFixed(1)}`;
      const adj = savedAdj[bubbleId];

      let currentBx = adj ? adj.bx : (rawX / 100) * iw - ((rawW / 100) * iw) / 2;
      let currentBy = adj ? adj.by : (rawY / 100) * ih - ((rawH / 100) * ih) / 2;
      let currentBw = adj ? adj.bw : (rawW / 100) * iw;
      let currentBh = adj ? adj.bh : (rawH / 100) * ih;
      let currentRotation = adj?.rotation !== undefined ? adj.rotation : ((b.rotation as number) || 0);

      const saveAdjustment = () => {
        const all = readOverlayAdjustments();
        if (!all[pageKey]) all[pageKey] = {};
        all[pageKey][bubbleId] = {
          bx: currentBx,
          by: currentBy,
          bw: currentBw,
          bh: currentBh,
          iw,
          ih,
          rotation: currentRotation,
        };
        saveOverlayAdjustments(all);
      };

      const wrapper = document.createElement("div");
      wrapper.className = "translation-bubble-wrapper";
      wrapper.style.cssText = `position:absolute; box-sizing:border-box; cursor:grab; pointer-events:auto; touch-action:none; border-radius:4px; z-index:10; transform-origin:center center;`;
      
      const bCanvas = document.createElement("canvas");
      bCanvas.style.cssText = `display:block; width:100%; height:100%; pointer-events:none;`;
      wrapper.appendChild(bCanvas);
      const ts = textStyleRef?.current || { fontFamily: "Itim, sans-serif", textColor: "#000000", textOutline: "#FFFFFF", fontSizeMultiplier: 1.0 };
      const fontFam = ts.fontFamily || "Itim, sans-serif";
      const fontMult = ts.fontSizeMultiplier || 1.0;
      const minReadableFs = Math.max(14, getReadableMinimumFontSize(iw));

      if (!adj) {
        const text = (b.t || b.translated || "").trim();
        if (text) {
          const layout = fitTextInAdaptiveBubble(
            text,
            currentBw,
            currentBh,
            fontFam,
            !b.isInvalidBox,
            fontMult,
            minReadableFs,
            3.0
          );
          const origCx = currentBx + currentBw / 2;
          const origCy = currentBy + currentBh / 2;
          currentBw = layout.width;
          currentBh = layout.height;
          currentBx = Math.max(0, Math.min(iw - currentBw, origCx - currentBw / 2));
          currentBy = Math.max(0, Math.min(ih - currentBh, origCy - currentBh / 2));
        }
      }

      const renderBubble = () => {
        wrapper.style.left = `${(currentBx / iw) * 100}%`;
        wrapper.style.top = `${(currentBy / ih) * 100}%`;
        wrapper.style.width = `${(currentBw / iw) * 100}%`;
        wrapper.style.height = `${(currentBh / ih) * 100}%`;
        wrapper.style.transform = currentRotation ? `rotate(${currentRotation.toFixed(1)}deg)` : "";
        bCanvas.width = Math.round(currentBw);
        bCanvas.height = Math.round(currentBh);
        const ctx = bCanvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, currentBw, currentBh);
        const currentStyle = textStyleRef?.current || ts;
        const text = (b.t || b.translated || "").trim();
        if (!text) return;
        const currentFontFam = currentStyle.fontFamily || "Itim, sans-serif";
        const currentFontMult = currentStyle.fontSizeMultiplier || 1.0;
        const resolvedStyle = resolveBubbleTextStyle(b, currentStyle);
        const textColor = resolvedStyle.textColor;
        const outlineColor = resolvedStyle.textOutline;

        const targetMinFs = Math.max(14, Math.round(getReadableMinimumFontSize(iw) * 0.75));
        const fit = fitTextForBubble(
          text,
          currentBw * 0.92,
          currentBh * 0.92,
          currentFontFam,
          !b.isInvalidBox,
          currentFontMult,
          targetMinFs
        );
        const fontSize = fit.fontSize;
        const lines = fit.lines;
        const lineH = Math.min(fontSize * 1.30, currentBh / Math.max(1, lines.length));

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${fontSize}px ${currentFontFam}`;
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.16));
        
        const totalH = (lines.length - 1) * lineH;
        const startY = (currentBh / 2) - (totalH / 2);
        lines.forEach((l, i) => {
          const yPos = startY + i * lineH;
          ctx.strokeText(l, currentBw / 2, yPos);
          ctx.fillStyle = textColor;
          ctx.fillText(l, currentBw / 2, yPos);
        });
      };

      b.render = renderBubble;

      wrapper.addEventListener('mouseenter', () => { if (selectedBubbleWrapper !== wrapper) wrapper.style.outline = "1.5px dashed rgba(99,102,241,0.5)"; });
      wrapper.addEventListener('mouseleave', () => { if (selectedBubbleWrapper !== wrapper) wrapper.style.outline = "none"; });

      let isDragging = false;
      let dragStartX = 0, dragStartY = 0;
      let initialBx = 0, initialBy = 0;

      wrapper.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.action-handle') || target.closest('.delete-btn') || target.closest('.edit-btn')) return;
        setSelectedBubble(wrapper);
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialBx = currentBx;
        initialBy = currentBy;
        wrapper.setPointerCapture(e.pointerId);
      });

      wrapper.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const rect = tlContainer.getBoundingClientRect();
        currentBx = initialBx + (e.clientX - dragStartX) * (iw / rect.width);
        currentBy = initialBy + (e.clientY - dragStartY) * (ih / rect.height);
        renderBubble();
      });

      wrapper.addEventListener('pointerup', (e) => {
        if (isDragging) {
          isDragging = false;
          wrapper.releasePointerCapture(e.pointerId);
          saveAdjustment();
        }
      });

      // 1. Interactive Handles with SVG icons matching reference design (4 main handles)
      const handlesConfig = [
        {
          id: 'rotate',
          pos: 'nw',
          cursor: 'grab',
          title: 'หมุนข้อความ',
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`
        },
        {
          id: 'scale',
          pos: 'ne',
          cursor: 'nesw-resize',
          title: 'ปรับขนาดเฉียง',
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>`
        },
        {
          id: 'width',
          pos: 'e',
          cursor: 'ew-resize',
          title: 'ปรับความกว้าง',
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 8 22 12 18 16"/><polyline points="6 8 2 12 6 16"/><line x1="2" x2="22" y1="12" y2="12"/></svg>`
        },
        {
          id: 'move',
          pos: 'sw',
          cursor: 'move',
          title: 'ย้ายตำแหน่ง',
          icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/></svg>`
        }
      ];

      handlesConfig.forEach(({ id, pos, cursor, title, icon }) => {
        const handle = document.createElement("div");
        handle.className = `action-handle action-handle--${id}`;
        handle.title = title;
        handle.style.cssText = `position:absolute; width:28px; height:28px; background:#ffffff; border:2.5px solid #3b82f6; border-radius:50%; z-index:30; opacity:0; pointer-events:none; display:flex; align-items:center; justify-content:center; color:#2563eb; cursor:${cursor}; box-shadow:0 2px 8px rgba(0,0,0,0.3); transition:transform 100ms ease, opacity 150ms ease; touch-action:none;`;
        handle.innerHTML = icon;

        if (pos === 'nw') { handle.style.top = '-14px'; handle.style.left = '-14px'; }
        else if (pos === 'ne') { handle.style.top = '-14px'; handle.style.right = '-14px'; }
        else if (pos === 'e') { handle.style.top = '50%'; handle.style.right = '-14px'; handle.style.transform = 'translateY(-50%)'; }
        else if (pos === 'sw') { handle.style.bottom = '-14px'; handle.style.left = '-14px'; }

        let rStartX = 0, rStartY = 0;
        let rInitBx = 0, rInitBy = 0, rInitBw = 0, rInitBh = 0;
        let rCenterX = 0, rCenterY = 0;
        let rStartAngle = 0;
        let rInitRot = 0;

        handle.addEventListener('pointerdown', (e) => {
          rStartX = e.clientX; rStartY = e.clientY;
          rInitBx = currentBx; rInitBy = currentBy;
          rInitBw = currentBw; rInitBh = currentBh;
          rInitRot = currentRotation;

          const bRect = wrapper.getBoundingClientRect();
          rCenterX = bRect.left + bRect.width / 2;
          rCenterY = bRect.top + bRect.height / 2;
          rStartAngle = Math.atan2(e.clientY - rCenterY, e.clientX - rCenterX) * (180 / Math.PI);

          handle.setPointerCapture(e.pointerId);
          e.stopPropagation();
        });

        handle.addEventListener('pointermove', (e) => {
          if (!handle.hasPointerCapture(e.pointerId)) return;
          const rect = tlContainer.getBoundingClientRect();
          const dx = (e.clientX - rStartX) * (iw / rect.width);
          const dy = (e.clientY - rStartY) * (ih / rect.height);
          
          if (id === 'rotate') {
            const curAngle = Math.atan2(e.clientY - rCenterY, e.clientX - rCenterX) * (180 / Math.PI);
            const angleDiff = curAngle - rStartAngle;
            currentRotation = (rInitRot + angleDiff + 360) % 360;
          } else if (id === 'width') {
            currentBw = Math.max(20, rInitBw + dx);
          } else if (id === 'scale') {
            currentBw = Math.max(20, rInitBw + dx);
            const newBh = Math.max(20, rInitBh - dy);
            currentBy = rInitBy + (rInitBh - newBh);
            currentBh = newBh;
          } else if (id === 'move') {
            currentBx = rInitBx + dx;
            currentBy = rInitBy + dy;
          }
          renderBubble();
        });

        handle.addEventListener('pointerup', (e) => {
          handle.releasePointerCapture(e.pointerId);
          saveAdjustment();
        });

        wrapper.appendChild(handle);
      });

      // 2. Top Floating Quick Action Toolbar
      const toolbar = document.createElement("div");
      toolbar.className = "bubble-quick-toolbar action-handle";
      toolbar.style.cssText = `
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%) translateY(-10px);
        background: #18181b;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 9999px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        padding: 4px 8px;
        display: flex;
        align-items: center;
        gap: 4px;
        z-index: 40;
        opacity: 0;
        pointer-events: none;
        transition: opacity 150ms ease-out, transform 150ms ease-out;
        user-select: none;
      `;

      const createToolBtn = (title: string, svg: string, onClick: () => void, isDanger = false) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = title;
        btn.className = "action-handle";
        btn.innerHTML = svg;
        btn.style.cssText = `
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: transparent;
          color: ${isDanger ? '#ef4444' : '#e4e4e7'};
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
          transition: background 150ms ease, color 150ms ease;
        `;
        btn.onmouseenter = () => {
          btn.style.background = isDanger ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.12)';
          if (isDanger) btn.style.color = '#f87171';
        };
        btn.onmouseleave = () => {
          btn.style.background = 'transparent';
          btn.style.color = isDanger ? '#ef4444' : '#e4e4e7';
        };
        btn.onpointerdown = (e) => e.stopPropagation();
        btn.onclick = (e) => {
          e.stopPropagation();
          onClick();
        };
        return btn;
      };

      // Duplicate Button
      const duplicateBtn = createToolBtn(
        "ทำซ้ำกล่องข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
        () => {
          const clone = { ...b, id: `${Date.now()}` };
          real.push(clone);
          saveAdjustment();
          paint();
        }
      );

      // Copy Text Button
      const copyBtn = createToolBtn(
        "คัดลอกข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
        () => {
          navigator.clipboard.writeText(b.t || b.translated || "");
          import('react-hot-toast').then(m => m.default.success("คัดลอกข้อความแล้ว"));
        }
      );

      // Text Color / Format Button
      const colorBtn = createToolBtn(
        "เปลี่ยนสีข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4-12 12H6v-4z"/><path d="m14 6 4 4"/></svg>`,
        () => {
          const resolved = resolveBubbleTextStyle(b, textStyleRef?.current || ts);
          const newColor = prompt("ใส่รหัสสีข้อความ (เช่น #000000, #ffffff, #ef4444, #ff3399):", resolved.textColor);
          if (newColor) {
            b.styleProfile = {
              fill: newColor,
              outline: resolved.textOutline,
              fillConfidence: 1.0,
              outlineConfidence: 1.0,
              source: "manual",
            };
            renderBubble();
            saveAdjustment();
          }
        }
      );

      // Background Fill / Inpaint Button
      const fillBtn = createToolBtn(
        "เติมสีพื้นหลัง",
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>`,
        () => {
          bCanvas.style.backgroundColor = bCanvas.style.backgroundColor ? "" : "#ffffff";
        }
      );

      // Layers / Z-Index Button
      const layerBtn = createToolBtn(
        "นำมาข้างหน้าสุด",
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
        () => {
          tlContainer.appendChild(wrapper);
        }
      );

      // Edit Text (Pencil) Button
      const editBtn = createToolBtn(
        "แก้ไขข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`,
        () => {
          const currentText = b.t || b.translated || "";
          const newText = prompt("แก้ไขข้อความแปล:", currentText);
          if (newText !== null) {
            b.t = newText;
            b.translated = newText;
            renderBubble();
            saveAdjustment();
          }
        }
      );

      // Divider
      const divider = document.createElement("div");
      divider.style.cssText = `width:1px; height:18px; background:rgba(255,255,255,0.2); margin:0 2px;`;

      // Delete Button (Red Trash)
      const deleteBtn = createToolBtn(
        "ลบกล่องข้อความ",
        `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
        () => {
          b.deleted = true;
          wrapper.remove();
        },
        true
      );

      toolbar.appendChild(duplicateBtn);
      toolbar.appendChild(copyBtn);
      toolbar.appendChild(colorBtn);
      toolbar.appendChild(fillBtn);
      toolbar.appendChild(layerBtn);
      toolbar.appendChild(editBtn);
      toolbar.appendChild(divider);
      toolbar.appendChild(deleteBtn);
      wrapper.appendChild(toolbar);

      renderBubble();
      tlContainer.appendChild(wrapper);
    });

    const handleDocumentPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('.translation-bubble-wrapper') && !target.closest('.action-handle')) setSelectedBubble(null);
    };
    const handleDocumentKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedBubble(null); };
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleDocumentKeyDown);
    (tlContainer as unknown as { _cleanupListeners: () => void })._cleanupListeners = () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };

    container.appendChild(tlContainer);

    if (onComplete) {
      setTimeout(() => {
        const url = downloadTranslatedImage(viewMode, currentPage, "", true, container);
        if (url) onComplete(url);
      }, 100);
    }
  };

  document.fonts.load('1em Itim').then(() => {
    if (img.complete && img.naturalWidth) paint();
    else img.onload = paint;
  });
};