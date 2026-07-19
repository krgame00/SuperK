
import { undoManager } from './undoManager';

export const downloadTranslatedImage = (viewMode: "single" | "scroll" | "offscreen", currentPage: number, defaultFilename = "translated.png", returnDataUrl = false) => {
  let container;
  if (viewMode === "offscreen") {
    container = document.getElementById("offscreen-container");
  } else if (viewMode === "scroll") {
    container = document.querySelector(`#spage-${currentPage}`);
  } else {
    container = document.getElementById("pageContainer");
  }
  if (!container) return null;

  const img = container.querySelector("img");
  if (!img) return null;

  const iw = img.offsetWidth || img.naturalWidth;
  const ih = img.offsetHeight || img.naturalHeight;

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = iw;
  exportCanvas.height = ih;
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) return null;

  // Check for inpainted background first
  const inpaintedBg = container.querySelector("#inpainted-bg") as HTMLCanvasElement;
  if (inpaintedBg) {
    ctx.drawImage(inpaintedBg, 0, 0, iw, ih);
  } else {
    ctx.drawImage(img, 0, 0, iw, ih);
  }

  const wrappers = container.querySelectorAll(".tl-canvas > div");
  wrappers.forEach((wrapper: any) => {
    const left = parseFloat(wrapper.style.left) || 0;
    const top = parseFloat(wrapper.style.top) || 0;
    const bCanvas = wrapper.querySelector("canvas");
    if (bCanvas) {
      const pLeft = parseFloat(bCanvas.style.left) || 0;
      const pTop = parseFloat(bCanvas.style.top) || 0;
      ctx.drawImage(bCanvas, left + pLeft, top + pTop);
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

export const applyTranslationOverlay = async (
  bubbles: any[],
  viewMode: "single" | "scroll" | "offscreen",
  currentPage: number,
  setTranslationResult: (msg: string | null) => void,
  onComplete?: (dataUrl: string) => void,
  textStyleRef?: React.MutableRefObject<any>
) => {
  let container;
  if (viewMode === "offscreen") {
    container = document.getElementById("offscreen-container");
  } else if (viewMode === "scroll") {
    container = document.querySelector(`#spage-${currentPage}`);
  } else {
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
    const iw = img.offsetWidth || img.naturalWidth;
    const ih = img.offsetHeight || img.naturalHeight;
    if (!iw || !ih) { setTimeout(paint, 100); return; }

    const tlContainer = document.createElement("div");
    tlContainer.className = "tl-canvas";
    tlContainer.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;`;

    let inpaintingFailed = false;

    try {
      setTranslationResult("⏳ Loading OpenCV in background...");
      
      const MAX_DIM = 4096;
      let scale = 1;
      if (iw > MAX_DIM || ih > MAX_DIM) {
        scale = Math.min(MAX_DIM / iw, MAX_DIM / ih);
      }
      const sw = Math.floor(iw * scale);
      const sh = Math.floor(ih * scale);

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = sw; maskCanvas.height = sh;
      const mctx = maskCanvas.getContext('2d')!;
      mctx.fillStyle = 'black';
      mctx.fillRect(0, 0, sw, sh);

      mctx.fillStyle = 'white';
      
      const rois: {x: number, y: number, w: number, h: number}[] = [];
      
      let fallbackY = 10;
      
      real.forEach(b => {
        let rawX = 50, rawY = 50, rawW = 22, rawH = 10;
        let isInvalidBox = b.isInvalidBox === true;

        if (Array.isArray(b.box) && b.box.length === 4) {
          const [ymin, xmin, ymax, xmax] = b.box;
          rawX = (xmin + xmax) / 2 / 10;
          rawY = (ymin + ymax) / 2 / 10;
          rawW = Math.abs(xmax - xmin) / 10;
          rawH = Math.abs(ymax - ymin) / 10;
          
          // Detect hallucinated full-screen boxes or zero-size boxes
          // A box covering >= 45% of both width and height is extremely rare for a manga bubble and is usually a hallucination.
          if ((rawW >= 45 && rawH >= 45) || (rawW === 0 && rawH === 0)) {
            isInvalidBox = true;
          }
        } else {
          isInvalidBox = true;
        }

        if (isInvalidBox) {
          rawX = 50;
          rawY = fallbackY;
          rawW = 30;
          rawH = 15;
          fallbackY = (fallbackY + 15 > 90) ? 10 : fallbackY + 15;
          b.isInvalidBox = true; // Flag for renderBubble to draw a background
        } else {
          // Normalize legacy fields if needed
          if (rawX > 100 || rawY > 100 || rawW > 100 || rawH > 100) {
            rawX = rawX / 10; rawY = rawY / 10; rawW = rawW / 10; rawH = rawH / 10;
          }
        }

        const cx = (Math.max(0, Math.min(rawX, 100)) / 100) * iw;
        const cy = (Math.max(0, Math.min(rawY, 100)) / 100) * ih;
        let bw = (Math.max(12, Math.min(rawW, 60)) / 100) * iw;
        let bh = (Math.max(6, Math.min(rawH, 45)) / 100) * ih;
        
        const pad = 4; 
        const rx = (cx - bw/2 - pad) * scale;
        const ry = (cy - bh/2 - pad) * scale;
        const rw = (bw + pad*2) * scale;
        const rh = (bh + pad*2) * scale;
        
        if (!isInvalidBox) {
          mctx.fillRect(rx, ry, rw, rh);
          rois.push({x: rx, y: ry, w: rw, h: rh});
        }
      });

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = sw; srcCanvas.height = sh;
      const sctx = srcCanvas.getContext('2d')!;
      sctx.drawImage(img, 0, 0, sw, sh);

      const srcData = sctx.getImageData(0, 0, sw, sh);
      const maskData = mctx.getImageData(0, 0, sw, sh);
      
      setTranslationResult("⏳ Cleaning original text (Inpainting in background)...");

      const worker = new Worker('/cv.worker.js');
      
      const inpaintedBuffer = await new Promise<Uint8ClampedArray>((resolve, reject) => {
         worker.onmessage = (e) => {
            if (e.data.success) {
               resolve(e.data.outData);
            } else {
               reject(new Error(e.data.error || "Worker failed"));
            }
            worker.terminate();
         };
         worker.onerror = (e) => {
            reject(new Error("Worker error: " + e.message));
            worker.terminate();
         };
         
         setTimeout(() => {
            reject(new Error("OpenCV Worker timeout"));
            worker.terminate();
         }, 30000);
         
         worker.postMessage({ srcData, maskData, sw, sh, rois });
      });

      const outImageData = new ImageData(inpaintedBuffer as any, sw, sh);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = sw;
      tempCanvas.height = sh;
      const tctx = tempCanvas.getContext('2d')!;
      tctx.putImageData(outImageData, 0, 0);
      
      const inpaintedCanvas = document.createElement('canvas');
      inpaintedCanvas.id = "inpainted-bg";
      inpaintedCanvas.className = "inpainted-bg";
      inpaintedCanvas.width = iw;
      inpaintedCanvas.height = ih;
      const ictx = inpaintedCanvas.getContext('2d')!;
      ictx.drawImage(tempCanvas, 0, 0, iw, ih);
      
      inpaintedCanvas.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;`;
      tlContainer.appendChild(inpaintedCanvas);
    } catch(err) {
      console.warn("OpenCV inpainting failed or timed out. Falling back to solid bubbles.", err);
      inpaintingFailed = true;
    }

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
        
        if ((rawW >= 45 && rawH >= 45) || (rawW === 0 && rawH === 0)) {
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
        rawX = 50;
        rawY = fallbackY2;
        rawW = 30;
        rawH = 15;
        fallbackY2 = (fallbackY2 + 15 > 90) ? 10 : fallbackY2 + 15;
        b.isInvalidBox = true;
      }

      const tx = Math.max(0, Math.min(rawX, 100));
      const ty = Math.max(0, Math.min(rawY, 100));
      let tw = rawW;
      let th = rawH;

      tw = Math.max(3, Math.min(tw, 85)); 
      th = Math.max(2, Math.min(th, 85));  

      const cx = (tx / 100) * iw;
      const cy = (ty / 100) * ih;
      const bw = (tw / 100) * iw;
      const bh = (th / 100) * ih;
      
      if (!(b.t || b.translated || "").trim()) return;

      const bx = cx - bw / 2;
      const by = cy - bh / 2;

      let currentBx = bx;
      let currentBy = by;
      let currentBw = bw;
      let currentBh = bh;

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

        const wrap = (fs: number) => {
          const tempCanvas = document.createElement("canvas");
          const tempCtx = tempCanvas.getContext("2d")!;
          tempCtx.font = `bold ${fs}px ${ts.fontFamily}`;
          let wds: string[] = [];
          if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
            wds = Array.from(segmenter.segment(text)).map(s => s.segment);
          } else {
            wds = text.split(/\s+/);
          }

          const res: string[] = [];
          let cur = "";
          for (const w of wds) {
            const test = cur + w;
            if (tempCtx.measureText(test).width > maxW && cur) { 
              res.push(cur); 
              cur = w.trimStart(); 
            }
            else cur = test;
          }
          if (cur) res.push(cur);
          
          const finalRes: string[] = [];
          for (const ln of res) {
            if (tempCtx.measureText(ln).width > maxW) {
              let c2 = "";
              for (const c of [...ln]) {
                if (tempCtx.measureText(c2 + c).width > maxW) { finalRes.push(c2); c2 = c; }
                else c2 += c;
              }
              if (c2) finalRes.push(c2);
            } else {
              finalRes.push(ln);
            }
          }
          return finalRes;
        };

        let fs = Math.max(14, Math.min(28, currentBh * 0.45)) * ts.fontSizeMultiplier;
        let lines2: string[] = [];
        for (; fs >= 14; fs--) {
          lines2 = wrap(fs);
          if (lines2.length * (fs * 1.3) <= maxH) break;
        }

        const requiredH = lines2.length * (fs * 1.3);
        if (requiredH > currentBh) {
           currentBh = requiredH; 
        }

        wrapper.style.left = `${currentBx}px`;
        wrapper.style.top = `${currentBy}px`;
        wrapper.style.width = `${currentBw}px`;
        wrapper.style.height = `${currentBh}px`;

        const pad = 6;
        const r = 8;
        const bubbleW = currentBw + pad * 2 + 6;
        const bubbleH = currentBh + pad * 2 + 6;
        
        bCanvas.width = bubbleW;
        bCanvas.height = bubbleH;
        bCanvas.style.left = `-${pad + 3}px`;
        bCanvas.style.top = `-${pad + 3}px`;
        bCanvas.style.width = `${bubbleW}px`;
        bCanvas.style.height = `${bubbleH}px`;

        const ctx = bCanvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, bubbleW, bubbleH);
        ctx.translate(pad + 3, pad + 3);

        const fgColor = ts.textColor;
        const outlineColor = ts.textOutline;
        
        if (inpaintingFailed || b.isInvalidBox) {
           ctx.save();
           ctx.beginPath();
           ctx.roundRect(-pad, -pad, currentBw + pad * 2, currentBh + pad * 2, r);
           ctx.fillStyle = b.isInvalidBox ? "rgba(255, 255, 255, 0.9)" : "white";
           ctx.fill();
           ctx.strokeStyle = "rgba(0,0,0,0.15)";
           ctx.lineWidth = 2;
           ctx.stroke();
           ctx.restore();
        }
        
        ctx.font = `bold ${fs}px ${ts.fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const lineH = fs * 1.3;
        const totalTH = lines2.length * lineH;
        const startY = currentBh / 2 - totalTH / 2 + lineH * 0.8;

        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.strokeStyle = outlineColor;
        lines2.forEach((ln, i) => ctx.strokeText(ln, currentBw/2, startY + i * lineH, maxW));

        ctx.fillStyle = fgColor;
        lines2.forEach((ln, i) => ctx.fillText(ln, currentBw/2, startY + i * lineH, maxW));
      };

      b.render = renderBubble;

      wrapper.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (wrapper.querySelector('textarea')) return;

        const oldText = (b.t || b.translated || "").trim();

        const textarea = document.createElement("textarea");
        textarea.value = (b.t || b.translated || "").trim();
        textarea.style.cssText = `
          position: absolute;
          inset: -10px;
          width: calc(100% + 20px);
          height: calc(100% + 20px);
          z-index: 30;
          resize: none;
          outline: none;
          border: 2px solid #10B981;
          border-radius: 8px;
          background: rgba(255,255,255,0.95);
          color: #111;
          font-family: Itim, sans-serif;
          font-size: 16px;
          padding: 8px;
          text-align: center;
          box-shadow: 0 4px 15px rgba(0,0,0,0.3);
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
            // Push undo for resize
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

      // Edit button (top-left, symmetric with delete button)
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
        // Trigger the same dblclick edit logic
        wrapper.dispatchEvent(new MouseEvent('dblclick', { bubbles: false }));
      };

      wrapper.appendChild(editBtn);

      renderBubble();
      tlContainer.appendChild(wrapper);
    });

    container.appendChild(tlContainer);

    if (onComplete) {
      setTimeout(() => {
        const url = downloadTranslatedImage(viewMode, currentPage, "", true);
        if (url) onComplete(url);
      }, 100);
    }
  };

  document.fonts.load('1em Itim').then(() => {
    if (img.complete && img.naturalWidth) paint();
    else img.onload = paint;
  });
};
