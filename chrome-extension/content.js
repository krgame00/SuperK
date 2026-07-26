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

  // Build overlay container over target image
  const rect = img.getBoundingClientRect();
  const naturalW = img.naturalWidth || rect.width;
  const naturalH = img.naturalHeight || rect.height;

  // Ensure parent is positioned relative or wrap image
  let wrapper = img.parentElement;
  if (!wrapper || window.getComputedStyle(wrapper).position === 'static') {
    const parent = img.parentNode;
    wrapper = document.createElement('div');
    wrapper.className = 'superk-img-wrapper';
    wrapper.style.cssText = `position: relative; display: inline-block; max-width: 100%;`;
    parent.insertBefore(wrapper, img);
    wrapper.appendChild(img);
  }

  // Remove previous overlay if exists
  const oldOverlay = wrapper.querySelector('.superk-overlay-container');
  if (oldOverlay) oldOverlay.remove();

  const overlayContainer = document.createElement('div');
  overlayContainer.className = 'superk-overlay-container';
  overlayContainer.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 9999;
    font-family: 'Itim', 'FC Subject', sans-serif;
  `;

  // Render bubbles
  bubbles.forEach((b, idx) => {
    if (!b.t || !b.box || b.box.length !== 4) return;
    const [ymin, xmin, ymax, xmax] = b.box;

    const topPct = (ymin / 10).toFixed(2);
    const leftPct = (xmin / 10).toFixed(2);
    const widthPct = Math.max(8, ((xmax - xmin) / 10)).toFixed(2);
    const heightPct = Math.max(4, ((ymax - ymin) / 10)).toFixed(2);

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'superk-text-bubble';
    bubbleEl.style.cssText = `
      position: absolute;
      top: ${topPct}%;
      left: ${leftPct}%;
      width: ${widthPct}%;
      min-height: ${heightPct}%;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      pointer-events: auto;
      cursor: move;
      color: #000000;
      font-weight: bold;
      font-size: clamp(12px, 1.4vw, 22px);
      line-height: 1.3;
      padding: 4px 6px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(0, 0, 0, 0.15);
      text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff;
      user-select: text;
      transition: box-shadow 0.2s;
    `;

    bubbleEl.innerText = b.t;
    bubbleEl.contentEditable = "true";

    // Enable simple drag to reposition
    makeDraggable(bubbleEl);

    overlayContainer.appendChild(bubbleEl);
  });

  // Floating Toggle Control (Show Original / Show Translation)
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'superk-toggle-btn';
  toggleBtn.innerHTML = '✨ ดูต้นฉบับ';
  let showingOriginal = false;

  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    showingOriginal = !showingOriginal;
    if (showingOriginal) {
      overlayContainer.style.display = 'none';
      toggleBtn.innerHTML = '👁️ ดูคำแปล';
    } else {
      overlayContainer.style.display = 'block';
      toggleBtn.innerHTML = '✨ ดูต้นฉบับ';
    }
  };

  overlayContainer.appendChild(toggleBtn);
  wrapper.appendChild(overlayContainer);

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
