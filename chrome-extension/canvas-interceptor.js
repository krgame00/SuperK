// SuperK Manga Translator - Main World Canvas Interceptor
// Implements Blueprint Section 1.2: Hooking CanvasRenderingContext2D.prototype.drawImage
(function () {
  if (typeof window === "undefined" || window.__superKCanvasHookInstalled) return;
  window.__superKCanvasHookInstalled = true;

  const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;

  CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
    if (args.length === 8) {
      // 9-argument signature: drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
      const canvas = this.canvas;
      const cw = canvas ? canvas.width : 0;
      const ch = canvas ? canvas.height : 0;

      // Only notify for substantial manga canvas renderings (>= 500px in either dimension)
      if (cw >= 500 || ch >= 500 || (args[6] >= 400 && args[7] >= 400)) {
        try {
          window.postMessage(
            {
              type: "SUPERK_CANVAS_RENDER_FRAME",
              payload: {
                canvasWidth: cw,
                canvasHeight: ch,
                sourceCoords: { sx: args[0], sy: args[1], sw: args[2], sh: args[3] },
                destCoords: { dx: args[4], dy: args[5], dw: args[6], dh: args[7] },
              },
            },
            "*",
          );
        } catch {
          // Ignore message posting errors
        }
      }
    }
    return originalDrawImage.apply(this, [image, ...args]);
  };
})();
