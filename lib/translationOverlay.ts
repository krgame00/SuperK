import { undoManager } from './undoManager';

const ADJ_KEY = "superk:overlay-adjustments";

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
  wrappers.forEach((wrapper: any) => {
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

export const wrapTextForBubble = (
  text: string,
  maxW: number,
  maxH: number,
  fs: number,
  fontFamily: string,
  isOval: boolean = true
): string[] => {
  if (!text || !text.trim()) return [];
  
  let wds: string[] = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    wds = Array.from(segmenter.segment(text)).map(s => s.segment);
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

  const lineH = fs * 1.45;
  const estimatedLineCount = Math.max(1, Math.round(maxH / lineH));

  const getLineMaxW = (lineIndex: number, totalLines: number): number => {
    if (!isOval || totalLines <= 1) return maxW;
    const yCenter = (lineIndex + 0.5) / totalLines;
    const v = (yCenter - 0.5) * 2;
    const chordRatio = Math.sqrt(Math.max(0.2, 1 - v * v));
    return Math.max(fs * 2.5, maxW * chordRatio * 0.95);
  };

  let bestLines: string[] = [];

  for (let tryLines = Math.max(1, estimatedLineCount - 1); tryLines <= estimatedLineCount + 2; tryLines++) {
    const lines: string[] = [];
    let cur = "";
    let lineIdx = 0;

    for (const w of wds) {
      const allowedW = getLineMaxW(lineIdx, tryLines);
      const test = cur ? (cur + w) : w;
      if (measureFn(test) > allowedW && cur) {
        lines.push(cur);
        cur = w.trimStart();
        lineIdx++;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);

    const splitLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const allowedW = getLineMaxW(i, lines.length);
      if (measureFn(ln) > allowedW) {
        let c2 = "";
        for (const c of [...ln]) {
          if (measureFn(c2 + c) > allowedW && c2) {
            splitLines.push(c2);
            c2 = c;
          } else {
            c2 += c;
          }
        }
        if (c2) splitLines.push(c2);
      } else {
        splitLines.push(ln);
      }
    }

    bestLines = splitLines;
    if (splitLines.length * lineH <= maxH * 1.15) {
      break;
    }
  }

  return bestLines;
};

export const applyTranslationOverlay = async (
  bubbles: any[],
  viewMode: "single" | "scroll" | "offscreen",
  currentPage: number,
  setTranslationResult: (msg: string | null) => void,
  onComplete?: (dataUrl: string) => void,
  textStyleRef?: React.MutableRefObject<any>,
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

  container.querySelectorAll(".tl-overlay,.tl-canvas").forEach((el) => el.remove());
  const img = container.querySelector("img");
  if (!img) return;

  const real = bubbles.filter(b => b && !b.deleted && (b.t || b.translated) && (b.t || b.translated).trim());
  if (real.length === 0) {
    setTranslationResult("❌ ไม่พบข้อความที่แปลได้ในหน้านี้");
    return;
  }

  const paint = async () => {
    await document.fonts.load('bold 16px Itim');
    const iw = img.naturalWidth || img.offsetWidth;
    const ih = img.naturalHeight || img.offsetHeight;
    if (!iw || !ih) { setTimeout(paint, 100); return; }

    // Load saved adjustments for this page
    const pageKey = `page-${currentPage}`;
    const savedAdj = readOverlayAdjustments()[pageKey] || {};

    const tlContainer = document.createElement("div");
    tlContainer.className = "tl-canvas";
    tlContainer.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;`;

    setTranslationResult("✨ วางข้อความแปลเสร็จเรียบร้อย!");

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
      
        if ((rawW >= 85 && rawH >= 85) || (rawW === 0 && rawH === 0)) {
          isInvalidBox = true;
        }
      } else {
        if (typeof b.x !== "number" && typeof b.y !== "number") {
          isInvalidBox = true;
        }
        rawX = typeof b.x === "number" ? b.x : 50;
        rawY = typeof b.y === "number" ? b.y : 50;
        rawW = typeof b.w === "number" ? b.w : 22;
        rawH = typeof b.h === "number" ? b.h : 10;
        if (rawX > 100 || rawY > 100 || rawW > 100 || rawH > 100) {
          rawX = rawX / 10;
          rawY = rawY / 10;
          rawW = rawW / 10;
          rawH = rawH / 10;
        }
      }

      if (isInvalidBox) {
        if (Array.isArray(b.box) && b.box.length === 4 && (b.box[1] !== 0 || b.box[3] !== 1000)) {
          rawX = (b.box[1] + b.box[3]) / 2 / 10;
          rawY = (b.box[0] + b.box[2]) / 2 / 10;
        } else {
          rawX = 50;
          rawY = fallbackY2;
          fallbackY2 = (fallbackY2 + 15 > 85) ? 8 : fallbackY2 + 12;
        }
        rawW = 30;
        rawH = 15;
        b.isInvalidBox = true;
      }

      if (!(b.t || b.translated || "").trim()) return;

      // Unique identifier for this bubble
      const boxKey = b.id !== undefined
        ? `id-${b.id}`
        : Array.isArray(b.box) && b.box.length === 4 
          ? b.box.map(Math.round).join(",") 
          : `text-${(b.t || b.translated || "").slice(0, 20)}-${rawX.toFixed(1)}-${rawY.toFixed(1)}`;

      const adj = savedAdj[boxKey];

      let currentBx: number;
      let currentBy: number;
      let currentBw: number;
      let currentBh: number;

      if (adj && typeof adj.bx === "number" && typeof adj.by === "number") {
        const baseIw = adj.iw || iw;
        const baseIh = adj.ih || ih;
        currentBx = (adj.bx / baseIw) * iw;
        currentBy = (adj.by / baseIh) * ih;
        currentBw = (adj.bw / baseIw) * iw;
        currentBh = (adj.bh / baseIh) * ih;
        b.__resized = true;
      } else {
        const cx = (rawX / 100) * iw;
        const cy = (rawY / 100) * ih;
        const bw = (rawW / 100) * iw;
        const bh = (rawH / 100) * ih;
        currentBx = cx - bw / 2;
        currentBy = cy - bh / 2;
        currentBw = bw;
        currentBh = bh;
      }

      // Save current position/size to localStorage
      const saveAdjustment = () => {
        const all = readOverlayAdjustments();
        if (!all[pageKey]) all[pageKey] = {};
        all[pageKey][boxKey] = {
          bx: currentBx,
          by: currentBy,
          bw: currentBw,
          bh: currentBh,
          iw,
          ih,
        };
        saveOverlayAdjustments(all);
      };

      const wrapper = document.createElement("div");
      wrapper.style.cssText = `position:absolute; left:${currentBx}px; top:${currentBy}px; width:${currentBw}px; height:${currentBh}px; pointer-events:auto; cursor:move; transition: opacity 0.2s; z-index:10;`;
      
      let isDragging = false;
      wrapper.onmouseenter = () => { if (!isDragging && bCanvas) bCanvas.style.opacity = "0.15"; };
      wrapper.onmouseleave = () => { if (bCanvas) bCanvas.style.opacity = "1"; };

      const bCanvas = document.createElement("canvas");
      bCanvas.style.cssText = `position:absolute; pointer-events:none;`;
      wrapper.appendChild(bCanvas);

      const renderBubble = () => {
        const ts = textStyleRef?.current || {
          fontFamily: "Itim, sans-serif",
          textColor: "#000000",
          textOutline: "#FFFFFF",
          fontSizeMultiplier: 1.0
        };

        const text = (b.t || b.translated || "").trim();
        let maxW = currentBw;
        let maxH = currentBh;
        const hasUserSize = b.__resized === true;
        const isOvalBubble = !b.isInvalidBox;

        const wrap = (fontSize: number) => {
          return wrapTextForBubble(text, maxW, maxH, fontSize, ts.fontFamily, isOvalBubble);
        };

        let fs = Math.max(14, Math.min(48, Math.round(currentBh * 0.35 * (ts.fontSizeMultiplier || 1.0))));
        let lines2: string[] = [];
        let requiredH = 0;

        for (let size = fs; size >= 12; size -= 2) {
          fs = size;
          lines2 = wrap(fs);
          requiredH = lines2.length * (fs * 1.45);
          if (requiredH <= maxH) break;
        }

        if (requiredH > currentBh && !hasUserSize) {
           currentBh = requiredH;
        }

        if (fs <= 20 && requiredH > maxH && !hasUserSize) {
          for (let expand = 1; expand <= 5; expand++) {
            currentBw *= 1.25;
            maxW = currentBw;
            lines2 = wrap(fs);
            const newRequiredH = lines2.length * (fs * 1.45);
            if (newRequiredH <= maxH || currentBw >= (rawW / 100 * iw) * 3) {
              currentBh = newRequiredH;
              break;
            }
            currentBh = newRequiredH;
          }
        }

        const maxTop = (ih - currentBh);
        if (currentBy > maxTop) {
          currentBy = Math.max(0, maxTop);
        }
        const maxLeft = (iw - currentBw);
        if (currentBx > maxLeft) {
          currentBx = Math.max(0, maxLeft);
        }

        wrapper.style.left = `${(currentBx / iw) * 100}%`;
        wrapper.style.top = `${(currentBy / ih) * 100}%`;
        wrapper.style.width = `${(currentBw / iw) * 100}%`;
        wrapper.style.height = `${(currentBh / ih) * 100}%`;

        const pad = Math.max(6, Math.round((iw / 800) * 8));
        const r = Math.max(8, Math.round((iw / 800) * 10));
        const bubbleW = currentBw + pad * 2 + r;
        const bubbleH = currentBh + pad * 2 + r;
        
        bCanvas.width = bubbleW;
        bCanvas.height = bubbleH;
        bCanvas.style.left = `${-((pad + r/2) / currentBw) * 100}%`;
        bCanvas.style.top = `${-((pad + r/2) / currentBh) * 100}%`;
        bCanvas.style.width = `${(bubbleW / currentBw) * 100}%`;
        bCanvas.style.height = `${(bubbleH / currentBh) * 100}%`;

        const ctx = bCanvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, bubbleW, bubbleH);
        ctx.translate(pad + r/2, pad + r/2);

        const fgColor = ts.textColor;
        const outlineColor = ts.textOutline;
        
        if (b.isInvalidBox) {
           ctx.save();
           ctx.beginPath();
           ctx.roundRect(-pad, -pad, currentBw + pad * 2, currentBh + pad * 2, r);
           ctx.fillStyle = b.isInvalidBox ? "rgba(255, 255, 255, 0.75)" : "white";
           ctx.fill();
           ctx.strokeStyle = "rgba(0,0,0,0.15)";
           ctx.lineWidth = 2;
           ctx.stroke();
           ctx.restore();
        }
        
        ctx.font = `bold ${fs}px ${ts.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const lineH = fs * 1.45;
        const totalTH = lines2.length * lineH;
        const startY = currentBh / 2 - totalTH / 2 + lineH * 0.8;

        ctx.lineWidth = Math.max(4, Math.round(fs * 0.22));
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.strokeStyle = outlineColor;
        lines2.forEach((ln, i) => ctx.strokeText(ln, currentBw/2, startY + i * lineH, maxW));

        ctx.fillStyle = fgColor;
        lines2.forEach((ln, i) => ctx.fillText(ln, currentBw/2, startY + i * lineH, maxW));
      };

      b.render = renderBubble;

      wrapper.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const existing = wrapper.querySelector('textarea');
        if (existing) return;

        const oldText = (b.t || b.translated || "").trim();
        const textarea = document.createElement("textarea");
        textarea.value = oldText;
        textarea.style.cssText = `
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          background: rgba(255, 255, 255, 0.95);
          color: #000;
          border: 2px solid #3b82f6;
          border-radius: 6px;
          padding: 4px 6px;
          font-family: inherit;
          font-size: 13px;
          line-height: 1.3;
          resize: none;
          z-index: 50;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          outline: none;
        `;

        wrapper.appendChild(textarea);
        textarea.focus();
        textarea.select();

        const finishEditing = () => {
          if (!textarea.parentNode) return;
          const newText = textarea.value.trim();
          if (newText && newText !== oldText) {
            const oldText2 = oldText;
            b.t = newText;
            undoManager.push({
              label: 'แก้ข้อความ',
              undo: () => { b.t = oldText2; renderBubble(); },
              redo: () => { b.t = newText; renderBubble(); },
            });
          }
          textarea.remove();
          renderBubble();
        };

        textarea.addEventListener('blur', finishEditing);
        textarea.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter' && !ke.shiftKey) {
            ke.preventDefault();
            finishEditing();
          }
        });
      });

      let dragStartX = 0, dragStartY = 0;
      let initialBx = 0, initialBy = 0;

      wrapper.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('resize-handle') || target.closest('.delete-btn') || target.closest('.edit-btn')) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialBx = currentBx;
        initialBy = currentBy;
        wrapper.setPointerCapture(e.pointerId);
        wrapper.style.opacity = "1";
        wrapper.style.zIndex = "11";
      });

      wrapper.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const rect = tlContainer.getBoundingClientRect();
        const scaleX = iw / rect.width;
        const scaleY = ih / rect.height;
        currentBx = initialBx + (e.clientX - dragStartX) * scaleX;
        currentBy = initialBy + (e.clientY - dragStartY) * scaleY;
        renderBubble();
      });

      wrapper.addEventListener('pointerup', (e) => {
        if (isDragging) {
          isDragging = false;
          wrapper.releasePointerCapture(e.pointerId);
          wrapper.style.zIndex = "10";
          const oldX = initialBx, oldY = initialBy;
          const newX = currentBx, newY = currentBy;
          if (Math.abs(oldX - newX) > 1 || Math.abs(oldY - newY) > 1) {
            undoManager.push({
              label: 'ย้ายกล่อง',
              undo: () => { currentBx = oldX; currentBy = oldY; renderBubble(); },
              redo: () => { currentBx = newX; currentBy = newY; renderBubble(); },
            });
          }
          saveAdjustment();
        }
      });

      const handles = ['nw', 'ne', 'sw', 'se'];
      handles.forEach(pos => {
        const handle = document.createElement("div");
        handle.className = 'resize-handle';
        handle.style.cssText = `position:absolute; width:16px; height:16px; background:white; border:2px solid #007bff; border-radius:50%; z-index:20; opacity:0; transition:opacity 0.2s;`;
        
        if (pos.includes('n')) handle.style.top = '-8px';
        if (pos.includes('s')) handle.style.bottom = '-8px';
        if (pos.includes('w')) handle.style.left = '-8px';
        if (pos.includes('e')) handle.style.right = '-8px';
        
        handle.style.cursor = `${pos}-resize`;

        wrapper.addEventListener('mouseenter', () => handle.style.opacity = "1");
        wrapper.addEventListener('mouseleave', () => { if (!isResizing) handle.style.opacity = "0"; });

        let isResizing = false;
        let rStartX = 0, rStartY = 0;
        let rInitBx = 0, rInitBy = 0, rInitBw = 0, rInitBh = 0;

        handle.addEventListener('pointerdown', (e) => {
          isResizing = true;
          rStartX = e.clientX;
          rStartY = e.clientY;
          rInitBx = currentBx; rInitBy = currentBy;
          rInitBw = currentBw; rInitBh = currentBh;
          handle.setPointerCapture(e.pointerId);
          e.stopPropagation();
          wrapper.style.zIndex = "11";
        });

        handle.addEventListener('pointermove', (e) => {
          if (!isResizing) return;
          const rect = tlContainer.getBoundingClientRect();
          const scaleX = iw / rect.width;
          const scaleY = ih / rect.height;

          const dx = (e.clientX - rStartX) * scaleX;
          const dy = (e.clientY - rStartY) * scaleY;

          if (pos.includes('w')) {
            currentBx = Math.min(rInitBx + rInitBw - 20, rInitBx + dx);
            currentBw = Math.max(20, rInitBw - dx);
          }
          if (pos.includes('e')) {
            currentBw = Math.max(20, rInitBw + dx);
          }
          if (pos.includes('n')) {
            currentBy = Math.min(rInitBy + rInitBh - 20, rInitBy + dy);
            currentBh = Math.max(20, rInitBh - dy);
          }
          if (pos.includes('s')) {
            currentBh = Math.max(20, rInitBh + dy);
          }

          renderBubble();
          e.stopPropagation();
        });

        handle.addEventListener('pointerup', (e) => {
          if (isResizing) {
            isResizing = false;
            handle.releasePointerCapture(e.pointerId);
            handle.style.opacity = "0";
            wrapper.style.zIndex = "10";
            b.__resized = true;
            saveAdjustment();
            const oX = rInitBx, oY = rInitBy, oW = rInitBw, oH = rInitBh;
            const nX = currentBx, nY = currentBy, nW = currentBw, nH = currentBh;
            if (Math.abs(oW - nW) > 1 || Math.abs(oH - nH) > 1) {
              undoManager.push({
                label: 'ปรับขนาดกล่อง',
                undo: () => { currentBx = oX; currentBy = oY; currentBw = oW; currentBh = oH; renderBubble(); },
                redo: () => { currentBx = nX; currentBy = nY; currentBw = nW; currentBh = nH; renderBubble(); },
              });
            }
          }
          e.stopPropagation();
        });

        wrapper.appendChild(handle);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      deleteBtn.style.cssText = `
        position: absolute;
        top: -12px;
        right: -12px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #ef4444;
        color: white;
        border: 2px solid white;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 40;
        opacity: 0;
        transition: opacity 0.2s, transform 0.1s;
        pointer-events: auto;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      `;

      deleteBtn.onmouseenter = () => { deleteBtn.style.transform = "scale(1.1)"; };
      deleteBtn.onmouseleave = () => { deleteBtn.style.transform = "scale(1)"; };
      deleteBtn.onpointerdown = (e) => { e.stopPropagation(); };
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        b.deleted = true;
        wrapper.remove();
        undoManager.push({
          label: 'ลบกล่อง',
          undo: () => { b.deleted = false; tlContainer.appendChild(wrapper); },
          redo: () => { b.deleted = true; wrapper.remove(); },
        });
      };

      wrapper.addEventListener('mouseenter', () => { 
        if (!isDragging) {
          deleteBtn.style.opacity = "1";
          editBtn.style.opacity = "1";
        }
      });
      wrapper.addEventListener('mouseleave', () => { 
        deleteBtn.style.opacity = "0"; 
        editBtn.style.opacity = "0";
      });

      wrapper.appendChild(deleteBtn);

      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn";
      editBtn.title = "ดับเบิลคลิกเพื่อแก้ไข";
      editBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path>
          <path d="m15 5 4 4"></path>
        </svg>
      `;
      editBtn.style.cssText = `
        position: absolute;
        top: -12px;
        left: -12px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #3b82f6;
        color: white;
        border: 2px solid white;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 40;
        opacity: 0;
        transition: opacity 0.2s, transform 0.1s;
        pointer-events: auto;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      `;

      editBtn.onmouseenter = () => { editBtn.style.transform = "scale(1.1)"; };
      editBtn.onmouseleave = () => { editBtn.style.transform = "scale(1)"; };
      editBtn.onpointerdown = (e) => { e.stopPropagation(); };
      editBtn.onclick = (e) => {
        e.stopPropagation();
        wrapper.dispatchEvent(new MouseEvent('dblclick', { bubbles: false }));
      };

      wrapper.appendChild(editBtn);

      renderBubble();
      tlContainer.appendChild(wrapper);
    });

    container.appendChild(tlContainer);

    if (onComplete) {
      setTimeout(() => {
        const url = downloadTranslatedImage(
          viewMode,
          currentPage,
          "",
          true,
          container,
        );
        if (url) onComplete(url);
      }, 100);
    }
  };

  document.fonts.load('1em Itim').then(() => {
    if (img.complete && img.naturalWidth) paint();
    else img.onload = paint;
  });
};