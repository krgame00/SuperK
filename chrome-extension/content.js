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

  // Render bubbles using pixel positions relative to overlay
  bubbles.forEach((b, idx) => {
    if (!b.t || !b.box || b.box.length !== 4) return;
    
    let rawYmin = Math.min(b.box[0], b.box[2]);
    let rawXmin = Math.min(b.box[1], b.box[3]);
    let rawYmax = Math.max(b.box[0], b.box[2]);
    let rawXmax = Math.max(b.box[1], b.box[3]);

    // Normalize to 0-1000 range then convert to percentage of overlay size
    // Gemini returns 0-1000 coordinates
    const topPx = (rawYmin / 1000) * imgRect.height;
    const leftPx = (rawXmin / 1000) * imgRect.width;
    const widthPx = Math.max(imgRect.width * 0.08, ((rawXmax - rawXmin) / 1000) * imgRect.width);
    const heightPx = Math.max(imgRect.height * 0.03, ((rawYmax - rawYmin) / 1000) * imgRect.height);

    console.log(`[SuperK] Bubble ${idx}: box=[${b.box}] -> top=${topPx.toFixed(0)}px left=${leftPx.toFixed(0)}px w=${widthPx.toFixed(0)} h=${heightPx.toFixed(0)} text="${b.t.slice(0,30)}..."`);

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'superk-text-bubble';
    bubbleEl.style.cssText = `
      position: absolute;
      top: ${topPx}px;
      left: ${leftPx}px;
      width: ${widthPx}px;
      min-height: ${heightPx}px;
      max-width: ${imgRect.width * 0.9}px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      pointer-events: auto;
      cursor: move;
      color: #000000;
      font-weight: bold;
      font-size: clamp(11px, ${Math.max(12, imgRect.width * 0.018)}px, 24px);
      line-height: 1.3;
      padding: 4px 8px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
      border: 1.5px solid rgba(0, 0, 0, 0.12);
      text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff;
      user-select: text;
      transition: box-shadow 0.2s;
      word-break: break-word;
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
