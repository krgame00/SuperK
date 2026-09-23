// Runs the actual image API with a local manga image; never prints credentials or translated text.
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const imagePath = process.argv[2];
const baseUrl = process.argv[3] ?? "http://127.0.0.1:3017";
const timeoutMs = Number(process.argv[4] ?? 70_000);
const modelPreference = process.argv[5] ?? "auto";
if (!imagePath) {
  console.error("Usage: node live-verify.mjs <image-path> [base-url] [timeout-ms] [model]");
  process.exit(2);
}

const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const mimeType = mimeTypes[extname(imagePath).toLowerCase()];
if (!mimeType) throw new Error("Choose a PNG, JPEG, or WebP manga image.");
const imageBase64 = (await readFile(imagePath)).toString("base64");
const startedAt = Date.now();
const response = await fetch(new URL("/api/translate", baseUrl), {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/x-ndjson",
  },
  body: JSON.stringify({
    imageBase64,
    mimeType,
    targetLang: "Thai",
    sourceLang: "auto",
    modelPreference,
  }),
  signal: AbortSignal.timeout(timeoutMs),
});
const switches = [];
let final;
const decoder = new TextDecoder();
let pending = "";
for await (const chunk of response.body) {
  pending += decoder.decode(chunk, { stream: true });
  let newline = pending.indexOf("\n");
  while (newline >= 0) {
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    if (line.trim()) {
      const event = JSON.parse(line);
      if (event.type === "model-switch") {
        switches.push({ model: event.model, fallbackCount: event.fallbackCount });
      } else if (event.type === "result") {
        final = event;
      }
    }
    newline = pending.indexOf("\n");
  }
}
if (pending.trim()) {
  const event = JSON.parse(pending);
  if (event.type === "result") final = event;
}
const body = final?.data ?? {};
let bubbleCount;
let hasBubblesArray = false;
if (typeof body.text === "string") {
  try {
    const bubbles = JSON.parse(body.text).bubbles;
    hasBubblesArray = Array.isArray(bubbles);
    bubbleCount = hasBubblesArray ? bubbles.length : undefined;
  } catch { /* report shape only */ }
}
const summary = {
  image: imagePath,
  status: final?.status ?? response.status,
  code: body.code,
  model: body.meta?.model,
  fallbackCount: body.meta?.fallbackCount,
  attemptCount: body.meta?.attemptCount,
  bubbleCount,
  errorType: typeof body.error === "string"
    ? body.error.toLowerCase().includes("not found")
      ? "model-not-found"
      : body.error.toLowerCase().includes("safety")
        ? "safety"
        : body.error.toLowerCase().includes("quota")
          ? "quota"
          : "other"
    : undefined,
  switches,
  elapsedMs: Date.now() - startedAt,
};
console.log(JSON.stringify(summary));
if (!final || final.status < 200 || final.status >= 300 || !hasBubblesArray) {
  process.exitCode = 1;
}
