// SuperK Manga Translator - Content Script

let activeOverlays = new Map(); // Key: imgUrl or imgElement

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "TRANSLATION_START") {
    handleTranslationStart(message.imageUrl);
  } else if (message.action === "TRANSLATION_SUCCESS") {
    handleTranslationSuccess(message.imageUrl, message.bubbles);
  } else if (message.action === "TRANSLATION_ERROR") {
    handleTranslationError(message.imageUrl, message.error);
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
function handleTranslationSuccess(imageUrl, bubbles) {
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
    font-family: 'Itim', 'FC Subject', sans-serif;
    overflow: hidden;
  `;

  // Log coordinates for debugging
  console.log('[SuperK] Image rect:', imgRect, 'Bubbles:', bubbles);

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

  // 1. Create clean mask canvas to ERASE original text completely
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

  // Fill canvas with white masks over original text areas (tight fit inside speech bubbles)
  bubbles.forEach(b => {
    if (!b.box || b.box.length !== 4) return;
    let rawYmin = Math.min(b.box[0], b.box[2]);
    let rawXmin = Math.min(b.box[1], b.box[3]);
    let rawYmax = Math.max(b.box[0], b.box[2]);
    let rawXmax = Math.max(b.box[1], b.box[3]);

    // Convert 0-1000 to true pixel coordinates accounting for object-fit
    const x = offsetX + (rawXmin / 1000) * renderW;
    const y = offsetY + (rawYmin / 1000) * renderH;
    const w = ((rawXmax - rawXmin) / 1000) * renderW;
    const h = ((rawYmax - rawYmin) / 1000) * renderH;

    // Shrink mask slightly to stay inside bubble border
    const shrink = 0.95;
    const mx = x + w * (1 - shrink) / 2;
    const my = y + h * (1 - shrink) / 2;
    const mw = w * shrink;
    const mh = h * shrink;

    // Draw rounded rectangle for text removal
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

  overlayContainer.appendChild(cleanCanvas);

  // 2. Render Thai text bubbles on top of the clean canvas
  bubbles.forEach((b, idx) => {
    if (!b.t || !b.box || b.box.length !== 4) return;
    
    let rawYmin = Math.min(b.box[0], b.box[2]);
    let rawXmin = Math.min(b.box[1], b.box[3]);
    let rawYmax = Math.max(b.box[0], b.box[2]);
    let rawXmax = Math.max(b.box[1], b.box[3]);

    const origW = ((rawXmax - rawXmin) / 1000) * renderW;
    const origH = ((rawYmax - rawYmin) / 1000) * renderH;
    const origX = offsetX + (rawXmin / 1000) * renderW;
    const origY = offsetY + (rawYmin / 1000) * renderH;

    // Just shrink inward slightly to stay inside the speech bubble
    const shrink = 0.88;
    let widthPx = origW * shrink;
    let heightPx = origH * shrink;
    const topPx = origY + origH * (1 - shrink) / 2;
    const leftPx = origX + origW * (1 - shrink) / 2;

    // Clamp to stay within image bounds
    const clampedLeft = Math.max(2, Math.min(leftPx, imgRect.width - widthPx - 2));
    const clampedTop = Math.max(2, Math.min(topPx, imgRect.height - heightPx - 2));

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'superk-text-bubble';
    bubbleEl.style.cssText = `
      position: absolute;
      top: ${clampedTop.toFixed(0)}px;
      left: ${clampedLeft.toFixed(0)}px;
      width: ${widthPx.toFixed(0)}px;
      min-height: ${heightPx.toFixed(0)}px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      pointer-events: auto;
      cursor: move;
      color: #000000;
      font-weight: 800;
      font-size: clamp(12px, ${Math.max(13, renderW * 0.016)}px, 22px);
      line-height: 1.35;
      padding: 0;
      background: transparent;
      border: none;
      box-shadow: none;
      text-shadow: 
        -2px -2px 0 #fff, 2px -2px 0 #fff, 
        -2px 2px 0 #fff, 2px 2px 0 #fff,
        0px 2px 0 #fff, 0px -2px 0 #fff,
        2px 0px 0 #fff, -2px 0px 0 #fff,
        -1px -1px 0 #fff, 1px -1px 0 #fff, 
        -1px 1px 0 #fff, 1px 1px 0 #fff;
      user-select: text;
      word-break: break-word;
      z-index: 2;
    `;

    bubbleEl.innerText = b.t;
    bubbleEl.contentEditable = "true";

    // Enable simple drag to reposition
    makeDraggable(bubbleEl);

    overlayContainer.appendChild(bubbleEl);
  });

  // Floating Control Bar
  const controlBar = document.createElement('div');
  controlBar.className = 'superk-control-bar';
  controlBar.innerHTML = `
    <button class="superk-ctrl-btn" data-action="toggle" title="สลับดูภาพต้นฉบับ">✨ ดูต้นฉบับ</button>
    <button class="superk-ctrl-btn" data-action="close" title="ปิด overlay">✕</button>
  `;

  let showingOriginal = false;

  controlBar.querySelector('[data-action="toggle"]').onclick = (e) => {
    e.stopPropagation();
    showingOriginal = !showingOriginal;
    const btn = controlBar.querySelector('[data-action="toggle"]');
    if (showingOriginal) {
      overlayContainer.querySelectorAll('.superk-text-bubble').forEach(el => el.style.display = 'none');
      btn.innerHTML = '👁️ ดูคำแปล';
    } else {
      overlayContainer.querySelectorAll('.superk-text-bubble').forEach(el => el.style.display = 'flex');
      btn.innerHTML = '✨ ดูต้นฉบับ';
    }
  };

  controlBar.querySelector('[data-action="close"]').onclick = (e) => {
    e.stopPropagation();
    overlayContainer.remove();
  };

  overlayContainer.appendChild(controlBar);

  // Append to document.body (not the image wrapper) for reliable positioning
  document.body.appendChild(overlayContainer);

  // Update position on scroll/resize so overlay stays on top of image
  const updatePosition = () => {
    const newRect = img.getBoundingClientRect();
    const newScrollX = window.scrollX || window.pageXOffset;
    const newScrollY = window.scrollY || window.pageYOffset;
    overlayContainer.style.top = `${newRect.top + newScrollY}px`;
    overlayContainer.style.left = `${newRect.left + newScrollX}px`;
    overlayContainer.style.width = `${newRect.width}px`;
    overlayContainer.style.height = `${newRect.height}px`;
  };

  window.addEventListener('resize', updatePosition);
  // Use IntersectionObserver to detect if image moves  
  const observer = new MutationObserver(updatePosition);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  // Clean up after 2 minutes to prevent memory leaks
  setTimeout(() => {
    window.removeEventListener('resize', updatePosition);
    observer.disconnect();
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

// Helper: Show Error Badge
function showErrorBadge(img, message) {
  const badge = document.createElement('div');
  badge.className = 'superk-status-badge superk-error';
  badge.id = `superk-badge-${hashCode(img.src)}`;
  badge.innerHTML = `
    <span>❌ ${message}</span>
    <button onclick="this.parentElement.remove()">✕</button>
  `;
  positionBadgeOverImage(img, badge);
  setTimeout(() => badge.remove(), 6000);
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
