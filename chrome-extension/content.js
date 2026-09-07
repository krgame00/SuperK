(() => {
if (globalThis.__superKLoaded) return;
globalThis.__superKLoaded = true;

// SuperK Manga Translator - Content Script

let activeOverlays = new Map(); // Key: imgUrl or imgElement

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "TRANSLATION_START") {
    handleTranslationStart(message.imageUrl);
  } else if (message.action === "TRANSLATION_SUCCESS") {
    handleTranslationSuccess(
      message.imageUrl,
      message.bubbles,
      message.cleanMode,
      message.cleanImageBase64,
      message.textStyle
    );
  } else if (message.action === "TRANSLATION_ERROR") {
    handleTranslationError(message.imageUrl, message.error);
  } else if (message.action === "UPDATE_OVERLAY" && message.pageUrl) {
    handlePublishedUpdate(
      message.pageUrl,
      message.bubbles,
      message.cleanUrl,
      message.textStyle
    );
  }
});

// Helper: Find target image element on page by URL or context
function findImageElement(imageUrl) {
  const images = Array.from(document.querySelectorAll('img'));
  // Try exact match
  let target = images.find(img => img.src === imageUrl || img.currentSrc === imageUrl);
  if (target) return target;
  
  // Try matching filename or substring
  const urlFilename = imageUrl.split('/').pop().split('?')[0];
  if (urlFilename && urlFilename.length > 5) {
    target = images.find(img => img.src.includes(urlFilename));
    if (target) return target;
  }
  return null;
}

// 1. Handle Translation Start (Show Loading Badge)
function handleTranslationStart(imageUrl) {
  const img = findImageElement(imageUrl);
  if (!img) return;

  removeExistingBadge(img);

  const badge = document.createElement('div');
  badge.className = 'superk-status-badge superk-loading';
  badge.id = `superk-badge-${hashCode(imageUrl)}`;
  badge.innerHTML = `
    <span class="superk-spinner"></span>
    <span>SuperK กำลังแปลภาพนี้...</span>
  `;

  positionBadgeOverImage(img, badge);
}

// 2. Handle Translation Success (Render Text Overlay)
function handleTranslationSuccess(imageUrl, bubbles, cleanMode, cleanImageBase64, textStyle) {
  const img = findImageElement(imageUrl);
  if (!img) return;

  removeExistingBadge(img);

  if (!bubbles || bubbles.length === 0) {
    showErrorBadge(img, "ไม่พบข้อความในภาพนี้");
    return;
  }

  // Remove any previous overlay for this image
  const oldOverlay = document.querySelector(`.superk-overlay-container[data-superk-for="${hashCode(imageUrl)}"]`);
  if (oldOverlay) oldOverlay.remove();

  // Get actual rendered position and size of the image on screen
  const imgRect = img.getBoundingClientRect();
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  // Create overlay container that exactly matches image position using absolute positioning in the document
  const overlayContainer = document.createElement('div');
  overlayContainer.className = 'superk-overlay-container';
  overlayContainer.dataset.superkFor = hashCode(imageUrl);
  overlayContainer.style.cssText = `
    position: absolute;
    top: ${imgRect.top + scrollY}px;
    left: ${imgRect.left + scrollX}px;
    width: ${imgRect.width}px;
    height: ${imgRect.height}px;
    pointer-events: none;
    z-index: 99999;
    font-family: ${textStyle?.fontFamily || "'Itim', 'FC Subject', sans-serif"};
    overflow: hidden;
  `;

  const layer = document.createElement('div');
  layer.style.cssText = `position:absolute;top:0;left:0;width:${imgRect.width}px;height:${imgRect.height}px;transform-origin:top left;pointer-events:none`;
  overlayContainer.appendChild(layer);

  // Calculate actual rendered image dimensions in case of object-fit: contain
  const objectFit = window.getComputedStyle(img).objectFit;
  let renderW = imgRect.width;
  let renderH = imgRect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (img.naturalWidth && img.naturalHeight && (objectFit === 'contain' || objectFit === 'scale-down')) {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const boxRatio = imgRect.width / imgRect.height;
    if (imgRatio > boxRatio) {
      renderW = imgRect.width;
      renderH = imgRect.width / imgRatio;
      offsetY = (imgRect.height - renderH) / 2;
    } else {
      renderH = imgRect.height;
      renderW = imgRect.height * imgRatio;
      offsetX = (imgRect.width - renderW) / 2;
    }
  }

  // 1. Inpainting clean background or legacy white mask canvas
  if (cleanImageBase64) {
    const cleanImg = document.createElement('img');
    cleanImg.className = 'superk-clean-image';
    cleanImg.src = cleanImageBase64.startsWith('data:')
      ? cleanImageBase64
      : `data:image/png;base64,${cleanImageBase64}`;
    cleanImg.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: ${objectFit || 'fill'};
      pointer-events: none;
      z-index: 1;
    `;
    layer.appendChild(cleanImg);
  } else if (cleanMode === 'solid') {
    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.className = 'superk-clean-canvas';
    cleanCanvas.width = Math.round(imgRect.width);
    cleanCanvas.height = Math.round(imgRect.height);
    cleanCanvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    `;
    const cctx = cleanCanvas.getContext('2d');

    bubbles.forEach(b => {
      if (!b.box || b.box.length !== 4) return;
      let rawYmin = Math.min(b.box[0], b.box[2]);
      let rawXmin = Math.min(b.box[1], b.box[3]);
      let rawYmax = Math.max(b.box[0], b.box[2]);
      let rawXmax = Math.max(b.box[1], b.box[3]);

      const x = offsetX + (rawXmin / 1000) * renderW;
      const y = offsetY + (rawYmin / 1000) * renderH;
      const w = ((rawXmax - rawXmin) / 1000) * renderW;
      const h = ((rawYmax - rawYmin) / 1000) * renderH;

      const shrink = 0.95;
      const mx = x + w * (1 - shrink) / 2;
      const my = y + h * (1 - shrink) / 2;
      const mw = w * shrink;
      const mh = h * shrink;

      const radius = Math.min(8, mw / 4, mh / 4);
      cctx.fillStyle = '#ffffff';
      cctx.beginPath();
      cctx.moveTo(mx + radius, my);
      cctx.lineTo(mx + mw - radius, my);
      cctx.quadraticCurveTo(mx + mw, my, mx + mw, my + radius);
      cctx.lineTo(mx + mw, my + mh - radius);
      cctx.quadraticCurveTo(mx + mw, my + mh, mx + mw - radius, my + mh);
      cctx.lineTo(mx + radius, my + mh);
      cctx.quadraticCurveTo(mx, my + mh, mx, my + mh - radius);
      cctx.lineTo(mx, my + radius);
      cctx.quadraticCurveTo(mx, my, mx + radius, my);
      cctx.closePath();
      cctx.fill();
    });

    layer.appendChild(cleanCanvas);
  }

function wrapTextAdaptive(text, safeW, safeH, fs, fontFamily, isOval) {
  let words = [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
      words = Array.from(segmenter.segment(text)).map(s => s.segment);
    } catch {
      words = text.split(/\s+/);
    }
  } else {
    words = text.split(/\s+/);
  }

  const tempCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const tempCtx = tempCanvas ? tempCanvas.getContext('2d') : null;
  const measure = (str) => {
    if (tempCtx && typeof tempCtx.measureText === 'function') {
      tempCtx.font = `bold ${fs}px ${fontFamily}`;
      const m = tempCtx.measureText(str);
      if (m && typeof m.width === 'number') return m.width;
    }
    return str.length * (fs * 0.6);
  };

  const lineH = fs * 1.30;
  const estLines = Math.max(1, Math.round(safeH / lineH));
  const getLineMaxW = (lineIdx, totalLines) => {
    if (!isOval || totalLines <= 1) return safeW;
    const v = ((lineIdx + 0.5) / totalLines - 0.5) * 2;
    const chord = Math.sqrt(Math.max(0.2, 1 - v * v));
    return safeW * chord * 0.95;
  };

  let best = [text];
  for (let tryLines = Math.max(1, estLines - 1); tryLines <= estLines + 2; tryLines++) {
    const lines = [];
    let cur = '';
    let lIdx = 0;
    for (const w of words) {
      const allowed = getLineMaxW(lIdx, tryLines);
      const test = cur ? (cur + w) : w;
      if (measure(test) > allowed && cur) {
        lines.push(cur);
        cur = w;
        lIdx++;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    best = lines;
    if (lines.length * lineH <= safeH) break;
  }
  return best;
}

function fitTextInBubble(text, width, height, fontFamily, fontSizeMultiplier = 1.0) {
  const minFs = 12;
  const maxFs = Math.max(minFs, Math.round(Math.min(height * 0.5, width * 0.5, 48) * fontSizeMultiplier));
  let best = { fontSize: minFs, lines: [text], lineHeight: minFs * 1.3 };

  for (let fs = maxFs; fs >= minFs; fs--) {
    const lines = wrapTextAdaptive(text, width * 0.88, height * 0.88, fs, fontFamily, true);
    const lineH = fs * 1.30;
    const totalH = lines.length * lineH;
    if (totalH <= height * 0.90) {
      return { fontSize: fs, lines, lineHeight: lineH };
    }
    if (fs === minFs) {
      best = { fontSize: fs, lines, lineHeight: lineH };
    }
  }
  return best;
}

  const textColor = textStyle?.textColor || '#000000';
  const textOutline = textStyle?.textOutline || '#FFFFFF';
  const fontFamily = textStyle?.fontFamily || "'Itim', 'FC Subject', sans-serif";
  const fontSizeMultiplier = textStyle?.fontSizeMultiplier || 1.0;

  // 2. Render Thai text bubbles on top of the clean canvas
  bubbles.forEach((b) => {
    if (!b.t || !b.box || b.box.length !== 4) return;
    
    let rawYmin = Math.min(b.box[0], b.box[2]);
    let rawXmin = Math.min(b.box[1], b.box[3]);
    let rawYmax = Math.max(b.box[0], b.box[2]);
    let rawXmax = Math.max(b.box[1], b.box[3]);

    const origW = ((rawXmax - rawXmin) / 1000) * renderW;
    const origH = ((rawYmax - rawYmin) / 1000) * renderH;
    const origX = offsetX + (rawXmin / 1000) * renderW;
    const origY = offsetY + (rawYmin / 1000) * renderH;

    const fit = fitTextInBubble(b.t, origW, origH, fontFamily, fontSizeMultiplier);

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'superk-text-bubble';
    bubbleEl.style.cssText = `
      position: absolute;
      top: ${origY.toFixed(0)}px;
      left: ${origX.toFixed(0)}px;
      width: ${origW.toFixed(0)}px;
      min-height: ${origH.toFixed(0)}px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      pointer-events: auto;
      cursor: move;
      color: ${textColor};
      font-family: ${fontFamily};
      font-weight: bold;
      font-size: ${fit.fontSize}px;
      line-height: ${fit.lineHeight}px;
      padding: 0;
      background: transparent;
      border: none;
      box-shadow: none;
      text-shadow: 
        -1.5px -1.5px 0 ${textOutline}, 1.5px -1.5px 0 ${textOutline}, 
        -1.5px 1.5px 0 ${textOutline}, 1.5px 1.5px 0 ${textOutline},
        0px 1.5px 0 ${textOutline}, 0px -1.5px 0 ${textOutline},
        1.5px 0px 0 ${textOutline}, -1.5px 0px 0 ${textOutline};
      user-select: text;
      word-break: break-word;
      z-index: 2;
    `;

    bubbleEl.textContent = fit.lines.join('\n');
    bubbleEl.contentEditable = "true";

    // Enable simple drag to reposition
    makeDraggable(bubbleEl);

    layer.appendChild(bubbleEl);
  });

  // Floating Control Bar
  const controlBar = document.createElement('div');
  controlBar.className = 'superk-control-bar';
  controlBar.innerHTML = `
    <button class="superk-ctrl-btn" data-action="toggle" title="สลับดูภาพต้นฉบับ">✨ ดูต้นฉบับ</button>
    <button class="superk-ctrl-btn" data-action="open-editor" title="เปิดแก้ไขใน SuperK Editor">✏️ เปิดใน SuperK</button>
    <button class="superk-ctrl-btn" data-action="retranslate" title="แปลภาพนี้ใหม่">🔄 แปลใหม่</button>
    <button class="superk-ctrl-btn" data-action="delete" title="ลบคำแปลออกจากเครื่อง">🗑️ ลบคำแปล</button>
    <button class="superk-ctrl-btn" data-action="close" title="ปิด overlay">✕</button>
  `;

  let showingOriginal = false;

  controlBar.querySelector('[data-action="toggle"]').onclick = (e) => {
    e.stopPropagation();
    showingOriginal = !showingOriginal;
    const btn = controlBar.querySelector('[data-action="toggle"]');
    layer.style.visibility = showingOriginal ? 'hidden' : 'visible';
    if (showingOriginal) {
      btn.innerHTML = '👁️ ดูคำแปล';
    } else {
      btn.innerHTML = '✨ ดูต้นฉบับ';
    }
  };

  const openEditorBtn = controlBar.querySelector('[data-action="open-editor"]');
  if (openEditorBtn) {
    openEditorBtn.onclick = (e) => {
      e.stopPropagation();
      if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'OPEN_EDITOR',
          payload: {
            pageUrl: imageUrl,
            cleanUrl: cleanImageBase64,
            bubbles,
            originUrl: window.location.href,
          }
        });
      }
    };
  }

  const storageKey = `superk_trans_${imageUrl}`;
  controlBar.querySelector('[data-action="retranslate"]').onclick = (e) => {
    e.stopPropagation();
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: 'RETRY_TRANSLATE', imageUrl });
    }
  };

  controlBar.querySelector('[data-action="delete"]').onclick = (e) => {
    e.stopPropagation();
    if (typeof chrome !== 'undefined' && chrome?.storage?.local?.remove) {
      chrome.storage.local.remove(storageKey).catch(() => {});
    }
    cleanup();
  };

  // Persist translation overlay in extension local storage
  if (typeof chrome !== 'undefined' && chrome?.storage?.local?.set) {
    chrome.storage.local.set({
      [storageKey]: {
        imageUrl,
        bubbles,
        cleanMode,
        cleanImageBase64,
        textStyle,
        timestamp: Date.now(),
      },
    }).catch(() => {});
  }

  const baseW = imgRect.width;
  const baseH = imgRect.height;
  const updatePosition = () => {
    const newRect = img.getBoundingClientRect();
    const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    const newScrollX = win ? (win.scrollX || win.pageXOffset || 0) : 0;
    const newScrollY = win ? (win.scrollY || win.pageYOffset || 0) : 0;
    overlayContainer.style.top = `${newRect.top + newScrollY}px`;
    overlayContainer.style.left = `${newRect.left + newScrollX}px`;
    overlayContainer.style.width = `${newRect.width}px`;
    overlayContainer.style.height = `${newRect.height}px`;

    if (baseW > 0 && baseH > 0) {
      const scaleX = newRect.width / baseW;
      const scaleY = newRect.height / baseH;
      layer.style.transform = `scale(${scaleX}, ${scaleY})`;
    }
  };

  const observer = new MutationObserver(updatePosition);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });

  const cleanup = () => {
    window.removeEventListener('resize', updatePosition);
    observer.disconnect();
    overlayContainer.remove();
    activeOverlays.delete(imageUrl);
  };
  activeOverlays.set(imageUrl, cleanup);

  controlBar.querySelector('[data-action="close"]').onclick = (e) => {
    e.stopPropagation();
    cleanup();
  };

  overlayContainer.appendChild(controlBar);

  // Append to document.body (not the image wrapper) for reliable positioning
  document.body.appendChild(overlayContainer);

  window.addEventListener('resize', updatePosition);

  // Clean up after 2 minutes to prevent memory leaks
  setTimeout(() => {
    cleanup();
  }, 120000);

  // Success Toast
  showToast(img, "✨ แปลเสร็จเรียบร้อย!");
}

// 3. Handle Translation Error
function handleTranslationError(imageUrl, errorMsg) {
  const img = findImageElement(imageUrl);
  if (!img) return;

  removeExistingBadge(img);
  showErrorBadge(img, errorMsg);
}

// 4. Handle Published Update from SuperK Editor
function handlePublishedUpdate(pageUrl, bubbles, cleanUrl, textStyle) {
  const img = findImageElement(pageUrl);
  if (!img) return;

  const cleanup = activeOverlays.get(pageUrl);
  if (cleanup) cleanup();

  handleTranslationSuccess(
    pageUrl,
    bubbles,
    "inpainting",
    cleanUrl || null,
    textStyle
  );

  showToast(img, "✨ อัปเดตคำแปลจาก SuperK เรียบร้อยแล้ว!");
}

// Helper: Show Error Badge
function showErrorBadge(img, message) {
  const badge = document.createElement('div');
  badge.className = 'superk-status-badge superk-error';
  badge.id = `superk-badge-${hashCode(img.src)}`;

  const text = document.createElement('span');
  text.textContent = `❌ ${message}`;

  const actions = document.createElement('div');
  actions.className = 'superk-error-actions';
  actions.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-left:8px;';

  const retryBtn = document.createElement('button');
  retryBtn.className = 'superk-retry-btn';
  retryBtn.textContent = '🔄 ลองใหม่';
  retryBtn.setAttribute('data-action', 'retry');
  retryBtn.style.cssText = 'background:#f59e0b;color:#fff;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:12px;';
  retryBtn.addEventListener('click', () => {
    badge.remove();
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ action: 'RETRY_TRANSLATE', imageUrl: img.src });
    }
  });

  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', 'ปิดข้อความแจ้งเตือน');
  close.addEventListener('click', () => badge.remove());

  actions.append(retryBtn, close);
  badge.append(text, actions);
  positionBadgeOverImage(img, badge);
  setTimeout(() => badge.remove(), 10000);
}

// Helper: Show Toast
function showToast(img, message) {
  const toast = document.createElement('div');
  toast.className = 'superk-status-badge superk-success';
  toast.innerText = message;
  positionBadgeOverImage(img, toast);
  setTimeout(() => toast.remove(), 3000);
}

// Helper: Position Badge over target image
function positionBadgeOverImage(img, badge) {
  let parent = img.parentElement;
  if (!parent || window.getComputedStyle(parent).position === 'static') {
    parent = img.parentNode;
  }
  parent.style.position = 'relative';
  parent.appendChild(badge);
}

function removeExistingBadge(img) {
  const parent = img.parentElement;
  if (parent) {
    const existing = parent.querySelectorAll('.superk-status-badge');
    existing.forEach(el => el.remove());
  }
}

// Simple Drag logic for text bubbles
function makeDraggable(el) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  el.onmousedown = dragMouseDown;

  function dragMouseDown(e) {
    if (document.activeElement === el && el.isContentEditable) return; // allow text selection
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }

  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    el.style.top = (el.offsetTop - pos2) + "px";
    el.style.left = (el.offsetLeft - pos1) + "px";
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function restoreSavedTranslations() {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local?.get) return;
  const images = Array.from(document.querySelectorAll('img'));
  images.forEach(img => {
    const src = img.src || img.currentSrc;
    if (!src) return;
    const key = `superk_trans_${src}`;
    chrome.storage.local.get(key).then(res => {
      const saved = res?.[key];
      if (saved && saved.bubbles && !activeOverlays.has(src)) {
        handleTranslationSuccess(
          saved.imageUrl,
          saved.bubbles,
          saved.cleanMode,
          saved.cleanImageBase64,
          saved.textStyle
        );
      }
    }).catch(() => {});
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(restoreSavedTranslations, 300));
  } else {
    setTimeout(restoreSavedTranslations, 100);
  }
}

})();
