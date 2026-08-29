import { undoManager } from './undoManager';

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
      
      ctx.drawImage(bCanvas, bCanvasAbsLeft, bCanvasAbsTop, bCanvas.width, bCanvas.height);
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
  isOval: boolean = true
): string[] => {
  if (!text || !text.trim()) return [];
  
  let wds: string[] = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    const rawSegments = Array.from(segmenter.segment(text)).map(s => s.segment);
    // Combine punctuation to preceding word where practical
    for (const seg of rawSegments) {
      if (/^[.,!?:;...]+$/.test(seg) && wds.length > 0) {
        wds[wds.length - 1] += seg;
      } else {
        wds.push(seg);
      }
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
    return Math.max(fs * 2.5, maxW * chordRatio * 0.95);
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
  minFontSize = 12,
): BubbleTextFit {
  const safeW = width * 0.88;
  const safeH = height * 0.88;
  const maxFs = Math.max(minFontSize, Math.round(Math.min(height * 0.5, width * 0.45) * fontSizeMultiplier));
  
  let bestFit: BubbleTextFit = {
    fontSize: minFontSize,
    lines: wrapTextForBubble(text, safeW, safeH, minFontSize, fontFamily, isOval),
    lineHeight: minFontSize * 1.35,
    fits: false,
  };

  for (let fs = maxFs; fs >= minFontSize; fs--) {
    const lineH = fs * 1.35;
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
  minFontSize = 12,
  maxScale = 2.5,
): AdaptiveBubbleLayout {
  let curW = width;
  let curH = height;
  const maxW = width * maxScale;
  const maxH = height * maxScale;

  let fit = fitTextForBubble(text, curW, curH, fontFamily, isOval, fontSizeMultiplier, minFontSize);
  if (fit.fits) {
    return { ...fit, width: curW, height: curH };
  }

  while ((curW < maxW || curH < maxH) && !fit.fits) {
    curW = Math.min(maxW, curW * 1.2);
    curH = Math.min(maxH, curH * 1.2);
    fit = fitTextForBubble(text, curW, curH, fontFamily, isOval, fontSizeMultiplier, minFontSize);
    if (fit.fits) {
      return { ...fit, width: curW, height: curH };
    }
    if (curW >= maxW && curH >= maxH) break;
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
    tlContainer.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;`;

    setTranslationResult("✨ วางข้อความแปลเสร็จเรียบร้อย!");

    let selectedBubbleWrapper: HTMLElement | null = null;
    const setSelectedBubble = (wrapper: HTMLElement | null) => {
      if (selectedBubbleWrapper && selectedBubbleWrapper !== wrapper) {
        selectedBubbleWrapper.removeAttribute("data-selected");
        selectedBubbleWrapper.style.border = "none";
        selectedBubbleWrapper.style.outline = "none";
        selectedBubbleWrapper.querySelectorAll(".action-handle, .delete-btn, .edit-btn").forEach((h) => {
          const el = h as HTMLElement;
          el.style.opacity = "0";
          el.style.pointerEvents = "none";
        });
      }
      selectedBubbleWrapper = wrapper;
      if (wrapper) {
        wrapper.setAttribute("data-selected", "true");
        wrapper.style.border = "2px dashed rgba(59, 130, 246, 0.9)";
        wrapper.style.outline = "none";
        wrapper.querySelectorAll(".action-handle, .delete-btn, .edit-btn").forEach((h) => {
          const el = h as HTMLElement;
          el.style.opacity = "1";
          el.style.pointerEvents = "auto";
        });
      }
    };

    let fallbackY2 = 10;
    real.forEach(b => {
      let rawX = 50, rawY = 50, rawW = 22, rawH = 10;
      let isInvalidBox = b.isInvalidBox === true;

      if (Array.isArray(b.box) && b.box.length === 4) {
        const [ymin, xmin, ymax, xmax] = b.box;
        rawX = (xmin + xmax) / 2 / 10;
        rawY = (ymin + ymax) / 2 / 10;
        rawW = Math.abs(xmax - xmin) / 10;
        rawH = Math.abs(ymax - ymin) / 10;
        if ((rawW >= 85 && rawH >= 85) || (rawW === 0 && rawH === 0)) isInvalidBox = true;
      } else {
        if (typeof b.x !== "number" && typeof b.y !== "number") isInvalidBox = true;
        rawX = typeof b.x === "number" ? b.x : 50;
        rawY = typeof b.y === "number" ? b.y : 50;
        rawW = typeof b.w === "number" ? b.w : 22;
        rawH = typeof b.h === "number" ? b.h : 10;
        if (rawX > 100 || rawY > 100 || rawW > 100 || rawH > 100) {
          rawX /= 10; rawY /= 10; rawW /= 10; rawH /= 10;
        }
      }

      if (isInvalidBox) {
        rawX = 50; rawY = fallbackY2;
        fallbackY2 = (fallbackY2 + 15 > 85) ? 8 : fallbackY2 + 12;
        rawW = 30; rawH = 15;
        b.isInvalidBox = true;
      }

      const bubbleId = b.id !== undefined ? `id-${b.id}` : `text-${(b.t || b.translated || "").slice(0, 10)}-${rawX.toFixed(1)}-${rawY.toFixed(1)}`;
      const adj = savedAdj[bubbleId];

      let currentBx = adj ? adj.bx : (rawX / 100) * iw - ((rawW / 100) * iw) / 2;
      let currentBy = adj ? adj.by : (rawY / 100) * ih - ((rawH / 100) * ih) / 2;
      let currentBw = adj ? adj.bw : (rawW / 100) * iw;
      let currentBh = adj ? adj.bh : (rawH / 100) * ih;

      const saveAdjustment = () => {
        const all = readOverlayAdjustments();
        if (!all[pageKey]) all[pageKey] = {};
        all[pageKey][bubbleId] = { bx: currentBx, by: currentBy, bw: currentBw, bh: currentBh, iw, ih };
        saveOverlayAdjustments(all);
      };

      const wrapper = document.createElement("div");
      wrapper.className = "translation-bubble-wrapper";
      wrapper.style.cssText = `position:absolute; box-sizing:border-box; cursor:grab; pointer-events:auto; touch-action:none; border-radius:4px; z-index:10;`;
      
      const bCanvas = document.createElement("canvas");
      bCanvas.style.cssText = `display:block; width:100%; height:100%; pointer-events:none;`;
      wrapper.appendChild(bCanvas);

      const renderBubble = () => {
        wrapper.style.left = `${(currentBx / iw) * 100}%`;
        wrapper.style.top = `${(currentBy / ih) * 100}%`;
        wrapper.style.width = `${(currentBw / iw) * 100}%`;
        wrapper.style.height = `${(currentBh / ih) * 100}%`;
        bCanvas.width = Math.round(currentBw);
        bCanvas.height = Math.round(currentBh);
        const ctx = bCanvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, currentBw, currentBh);
        const ts = textStyleRef?.current || { fontFamily: "Itim, sans-serif", textColor: "#000000", textOutline: "#FFFFFF", fontSizeMultiplier: 1.0 };
        const text = (b.t || b.translated || "").trim();
        if (!text) return;
        const fontFam = ts.fontFamily || "Itim, sans-serif";
        const fontMult = ts.fontSizeMultiplier || 1.0;
        const textColor = ts.textColor || "#000000";
        const outlineColor = ts.textOutline || "#ffffff";
        const lines = wrapTextForBubble(text, currentBw * 0.9, currentBh * 0.9, Math.round(18 * fontMult), fontFam, !b.isInvalidBox);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${Math.round(18 * fontMult)}px ${fontFam}`;
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = 3;
        lines.forEach((l, i) => {
          ctx.strokeText(l, currentBw / 2, (currentBh / 2) - ((lines.length - 1) * 20 / 2) + i * 20);
          ctx.fillStyle = textColor;
          ctx.fillText(l, currentBw / 2, (currentBh / 2) - ((lines.length - 1) * 20 / 2) + i * 20);
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

      [
        { id: 'rotate', pos: 'nw', cursor: 'grab' },
        { id: 'scale', pos: 'ne', cursor: 'ne-resize' },
        { id: 'width', pos: 'sw', cursor: 'ew-resize' },
        { id: 'move', pos: 'se', cursor: 'move' }
      ].forEach(({ id, pos, cursor }) => {
        const handle = document.createElement("div");
        handle.className = `action-handle action-${id}`;
        handle.style.cssText = `position:absolute; width:28px; height:28px; background:white; border:2px solid #3b82f6; border-radius:50%; z-index:30; opacity:0; pointer-events:none; display:flex; align-items:center; justify-content:center; color:#3b82f6; cursor:${cursor}; box-shadow:0 2px 6px rgba(0,0,0,0.25);`;
        if (pos.includes('n')) handle.style.top = '-14px';
        if (pos.includes('s')) handle.style.bottom = '-14px';
        if (pos.includes('w')) handle.style.left = '-14px';
        if (pos.includes('e')) handle.style.right = '-14px';

        let rStartX = 0, rStartY = 0;
        let rInitBx = 0, rInitBy = 0, rInitBw = 0, rInitBh = 0;
        handle.addEventListener('pointerdown', (e) => {
          rStartX = e.clientX; rStartY = e.clientY;
          rInitBx = currentBx; rInitBy = currentBy;
          rInitBw = currentBw; rInitBh = currentBh;
          handle.setPointerCapture(e.pointerId);
          e.stopPropagation();
        });
        handle.addEventListener('pointermove', (e) => {
          if (!handle.hasPointerCapture(e.pointerId)) return;
          const dx = (e.clientX - rStartX) * (iw / tlContainer.getBoundingClientRect().width);
          const dy = (e.clientY - rStartY) * (ih / tlContainer.getBoundingClientRect().height);
          if (id === 'width') { currentBx = Math.min(rInitBx + rInitBw - 20, rInitBx + dx); currentBw = Math.max(20, rInitBw - dx); }
          else if (id === 'scale') { currentBw = Math.max(20, rInitBw + dx); currentBh = Math.max(20, rInitBh - dy); currentBy = Math.min(rInitBy + rInitBh - 20, rInitBy + dy); }
          else if (id === 'move') { currentBx = rInitBx + dx; currentBy = rInitBy + dy; }
          renderBubble();
        });
        handle.addEventListener('pointerup', (e) => { handle.releasePointerCapture(e.pointerId); saveAdjustment(); });
        wrapper.appendChild(handle);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.innerHTML = `×`;
      deleteBtn.style.cssText = `position:absolute; top:-12px; right:-12px; width:24px; height:24px; border-radius:50%; background:#ef4444; color:white; border:2px solid white; opacity:0; pointer-events:none;`;
      deleteBtn.onclick = (e) => { e.stopPropagation(); wrapper.remove(); };
      wrapper.appendChild(deleteBtn);

      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn";
      editBtn.innerHTML = `✎`;
      editBtn.style.cssText = `position:absolute; top:-12px; left:-12px; width:24px; height:24px; border-radius:50%; background:#3b82f6; color:white; border:2px solid white; opacity:0; pointer-events:none;`;
      wrapper.appendChild(editBtn);

      renderBubble();
      tlContainer.appendChild(wrapper);
    });

    const handleDocumentPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('.translation-bubble-wrapper') && !target.closest('.action-handle')) setSelectedBubble(null);
    };
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', (e) => { if (e.key === "Escape") setSelectedBubble(null); });
    (tlContainer as unknown as { _cleanupListeners: () => void })._cleanupListeners = () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
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