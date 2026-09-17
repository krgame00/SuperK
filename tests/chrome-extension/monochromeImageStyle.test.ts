// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = readFileSync('chrome-extension/server.js', 'utf8');

function loadServer() {
  const context = vm.createContext({
    console,
    URL,
    Blob,
    Uint8Array,
    Uint8ClampedArray,
    btoa,
    atob,
    fetch: async () => Response.json({}),
    Response,
    AbortSignal,
  });
  vm.runInContext(script, context);
  return context.SuperKServer as {
    sampleBubbleLuminance: (
      ctx: { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } },
      bubbles: Array<{ box: number[] }>,
      width: number,
      height: number,
    ) => {
      mean: Record<number, number>;
      samples: Record<number, number[]>;
    };
  };
}

function rgbaPixels(values: number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((v, index) => {
    const offset = index * 4;
    data[offset] = v;
    data[offset + 1] = v;
    data[offset + 2] = v;
    data[offset + 3] = 255;
  });
  return data;
}

describe('Chrome Extension monochrome region evidence', () => {
  it('returns both average luminance and spread samples for mixed grayscale regions', () => {
    const server = loadServer();
    const ctx = {
      getImageData: () => ({
        data: rgbaPixels([20, 25, 230, 235, 30, 225, 40, 220]),
      }),
    };

    const result = server.sampleBubbleLuminance(
      ctx,
      [{ box: [0, 0, 1000, 1000] }],
      8,
      1,
    );

    expect(result.mean[0]).toBeGreaterThan(100);
    expect(result.mean[0]).toBeLessThan(160);
    expect(result.samples[0].length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...result.samples[0]) - Math.min(...result.samples[0])).toBeGreaterThanOrEqual(90);
  });
});
