import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";

if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    readonly colorSpace = "srgb";

    constructor(data: Uint8ClampedArray, width: number, height?: number) {
      this.data = data;
      this.width = width;
      this.height = height ?? data.length / 4 / width;
    }
  }

  Object.defineProperty(globalThis, "ImageData", {
    configurable: true,
    value: ImageDataPolyfill,
  });
}

if (typeof globalThis.Blob !== "undefined" && !globalThis.Blob.prototype.stream) {
  globalThis.Blob.prototype.stream = function () {
    return new ReadableStream({
      start: (controller) => {
        if (typeof this.arrayBuffer === "function") {
          this.arrayBuffer()
            .then((buffer) => {
              controller.enqueue(new Uint8Array(buffer));
              controller.close();
            })
            .catch((err) => controller.error(err));
        } else if (typeof this.text === "function") {
          this.text()
            .then((str) => {
              controller.enqueue(new TextEncoder().encode(str));
              controller.close();
            })
            .catch((err) => controller.error(err));
        } else {
          controller.enqueue(new Uint8Array(0));
          controller.close();
        }
      },
    });
  };
}

if (typeof globalThis.FileReader !== "undefined") {
  const originalReadAsDataURL = globalThis.FileReader.prototype.readAsDataURL;
  globalThis.FileReader.prototype.readAsDataURL = function (blob: Blob) {
    if (blob && typeof blob.arrayBuffer === "function") {
      blob
        .arrayBuffer()
        .then((buffer) => {
          const base64 = Buffer.from(buffer).toString("base64");
          const mimeType = blob.type || "application/octet-stream";
          Object.defineProperty(this, "result", {
            configurable: true,
            writable: true,
            value: `data:${mimeType};base64,${base64}`,
          });
          if (typeof this.onload === "function") {
            this.onload(new ProgressEvent("load") as ProgressEvent<FileReader>);
          }
          if (typeof this.onloadend === "function") {
            this.onloadend(new ProgressEvent("loadend") as ProgressEvent<FileReader>);
          }
        })
        .catch((error) => {
          Object.defineProperty(this, "error", {
            configurable: true,
            writable: true,
            value: error,
          });
          if (typeof this.onerror === "function") {
            this.onerror(new ProgressEvent("error") as ProgressEvent<FileReader>);
          }
          if (typeof this.onloadend === "function") {
            this.onloadend(new ProgressEvent("loadend") as ProgressEvent<FileReader>);
          }
        });
      return;
    }
    return originalReadAsDataURL.call(this, blob);
  };
}

afterEach(cleanup);

// RTL's async wrappers restore the act environment to whatever it was when
// they started. A dangling waitFor from a previous test file sharing this
// worker can leave the flag false, so every test must start act-enabled or
// the first act() call logs the "testing environment is not configured"
// error and trips any console.error assertion.
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});