/**
 * SuperK — Desktop Build Script (Ticket 07)
 *
 * Automates the packaging of SuperK into a self-contained Windows portable application:
 *  1. Compiles Next.js production build (`next build`)
 *  2. Bundles Electron shell via `electron-builder --win portable`
 *  3. Verifies expected distribution outputs
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

console.log("=== Building SuperK Windows Desktop Application ===");

// 1. Next.js Build
console.log("\n[Step 1/2] Building Next.js production bundle...");
try {
  execSync("npx next build", {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
  console.log("✓ Next.js build complete.");
} catch (err) {
  console.error("✗ Next.js build failed:", err.message);
  process.exit(1);
}

// 2. Electron Builder
console.log("\n[Step 2/2] Running electron-builder for Windows portable target...");
try {
  execSync("npx electron-builder --win portable --config electron-builder.yml", {
    cwd: projectRoot,
    stdio: "inherit",
  });
  console.log("✓ Electron builder packaging complete.");
} catch (err) {
  console.error("✗ Electron builder failed:", err.message);
  process.exit(1);
}

const distDir = path.join(projectRoot, "dist", "desktop");
if (fs.existsSync(distDir)) {
  console.log(`\n🎉 SuperK desktop bundle created at: ${distDir}`);
}
