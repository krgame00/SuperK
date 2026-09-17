/**
 * Utility to convert Blob to base64 Data URL reliably across browser and Node.js/jsdom environments.
 */
export async function blobToDataUrl(
  blob: Blob | unknown,
  mimeType?: string,
): Promise<string> {
  if (!blob) {
    throw new Error("Cannot convert null or undefined blob to Data URL");
  }

  const type = (blob as { type?: string })?.type || mimeType || "image/png";

  // 1. ArrayBuffer fast path (Node/modern browsers/jsdom with buffer support)
  if (typeof (blob as Blob).arrayBuffer === "function") {
    try {
      const buffer = await (blob as Blob).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
        const base64 = Buffer.from(bytes).toString("base64");
        return `data:${type};base64,${base64}`;
      }
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.byteLength; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      return `data:${type};base64,${base64}`;
    } catch {
      // Fall through to FileReader if arrayBuffer fails
    }
  }

  // 2. Browser FileReader path
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
          } else {
            reject(new Error("FileReader result is not a string"));
          }
        };
        reader.onerror = () => reject(reader.error || new Error("Failed to read Blob"));
        reader.onabort = () => reject(new Error("FileReader was aborted"));
        reader.readAsDataURL(blob as Blob);
      } catch (err) {
        reject(err);
      }
    });
  }

  throw new Error("No supported Blob reading mechanism available in current environment");
}
