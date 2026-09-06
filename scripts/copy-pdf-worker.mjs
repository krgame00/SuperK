// Copies the pdf.js worker out of node_modules into /public so the app can
// load it locally (offline-friendly, no unpkg CDN dependency at runtime).
// Runs on every `npm install` via the postinstall script so the worker
// version always matches the installed pdfjs-dist.
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = join(root, "public", "pdf.worker.min.mjs");

try {
  copyFileSync(src, dest);
  console.log("[copy-pdf-worker] public/pdf.worker.min.mjs updated");
} catch (err) {
  console.warn("[copy-pdf-worker] skipped:", err instanceof Error ? err.message : err);
}
