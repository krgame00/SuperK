import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
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

afterEach(cleanup);