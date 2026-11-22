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

  const imageLayerEls = container.querySelectorAll("[data-image-layer='true']");
  imageLayerEls.forEach((layerEl) => {
    const el = layerEl as HTMLElement;
    if (el.style.display === "none") return;
    const imgEl = el.querySelector("img");
    if (!imgEl) return;
    const lx = parseFloat(el.style.left) || 0;
    const ly = parseFloat(el.style.top) || 0;
    const lw = parseFloat(el.style.width) || imgEl.naturalWidth || 100;
    const lh = parseFloat(el.style.height) || imgEl.naturalHeight || 100;
    const opacity = parseFloat(el.style.opacity) || 1;
    const flipX = el.dataset.flipx === "true";
    const flipY = el.dataset.flipy === "true";

    ctx.save();
    ctx.globalAlpha = opacity;
    if (flipX || flipY) {
      ctx.translate(lx + lw / 2, ly + lh / 2);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.drawImage(imgEl, -lw / 2, -lh / 2, lw, lh);
    } else {
      ctx.drawImage(imgEl, lx, ly, lw, lh);
    }
    ctx.restore();
  });

  const wrappers = container.querySelectorAll(".tl-canvas > div");
  wrappers.forEach((wrapperEl) => {
    const wrapper = wrapperEl as HTMLElement;
    // A Deleted bubble stays in the DOM for undo but must never reach the export.
    if (wrapper.dataset.deleted === "true" || wrapper.style.display === "none") return;
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

  try {
    const dataUrl = exportCanvas.toDataURL("image/jpeg", 0.9);
    exportCanvas.width = 0;
    exportCanvas.height = 0;
    if (returnDataUrl) return dataUrl;

    const link = document.createElement("a");
    link.download = defaultFilename;
    link.href = dataUrl;
    link.click();
    return dataUrl;
  } catch (err) {
    console.error("downloadTranslatedImage canvas export failed", err);
    exportCanvas.width = 0;
    exportCanvas.height = 0;
    return null;
  }
};
