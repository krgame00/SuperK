/**
 * Generates a lightweight, downscaled JPEG thumbnail (~160px height) from an image URL.
 * Drastically reduces memory usage when loading dozens of high-res manga pages in the filmstrip.
 */
export const generateThumbnail = (
  sourceUrl: string,
  targetHeight: number = 160,
): Promise<string> => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(sourceUrl);
  }
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve(sourceUrl), 1000);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      clearTimeout(timer);
      try {
        const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
        const targetWidth = Math.max(1, Math.round(targetHeight * aspect));
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(sourceUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        const thumb = canvas.toDataURL("image/jpeg", 0.7);
        resolve(thumb);
      } catch {
        resolve(sourceUrl);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(sourceUrl);
    };
    img.src = sourceUrl;
  });
};
