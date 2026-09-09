/**
 * SuperK — Desktop Build Script
 *
 * Produces a self-contained Windows portable bundle while keeping the package
 * materially smaller than a naive electron-builder build:
 *  1. Build Next.js standalone output.
 *  2. Stage a minimal Electron app package with no root dependencies.
 *  3. Build a relocatable CPython runtime from the local Python installation
 *     and OCR venv, pruning dev/test packages and PyTorch on Windows.
 *  4. Package the staged app + OCR runtime/models with electron-builder.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const stageDir = path.join(projectRoot, ".desktop-stage");
const portableRuntimeDir = path.join(projectRoot, ".desktop-runtime");
const ocrServiceDir = path.join(projectRoot, "ocr-service");
const venvDir = path.join(ocrServiceDir, "venv");

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function directorySize(root) {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        total += fs.statSync(full).size;
      }
    }
  }
  return total;
}

function isSecretLikeFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return name === ".env" || name.startsWith(".env.");
}

function assertNoEnvFiles(root) {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  const found = [];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && isSecretLikeFile(full)) {
        found.push(path.relative(root, full));
      }
    }
  }
  if (found.length > 0) {
    throw new Error(`Refusing to package environment files: ${found.join(", ")}`);
  }
}

function copyNextStandalone(standaloneDir) {
  const destination = path.join(stageDir, ".next", "standalone");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(standaloneDir, destination, {
    recursive: true,
    filter(source) {
      const rel = path.relative(standaloneDir, source);
      if (!rel || rel === ".") return true;
      if (isSecretLikeFile(source)) return false;

      const segments = rel.split(path.sep);
      // The OCR service is packaged separately as an Electron extraResource.
      // Excluding traced copies here avoids duplication and any accidental
      // environment-file capture from the local service directory.
      if (segments[0].toLowerCase() === "ocr-service") return false;
      return true;
    },
  });
}

function parseVenvHome() {
  const cfgPath = path.join(venvDir, "pyvenv.cfg");
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`Python venv configuration not found: ${cfgPath}`);
  }

  const cfg = fs.readFileSync(cfgPath, "utf8");
  const match = cfg.match(/^home\s*=\s*(.+)$/m);
  if (!match) {
    throw new Error(`Could not determine base Python home from ${cfgPath}`);
  }

  const pythonHome = match[1].trim();
  if (!fs.existsSync(path.join(pythonHome, "python.exe"))) {
    throw new Error(`Base Python installation is unavailable: ${pythonHome}`);
  }
  return pythonHome;
}

function shouldKeepStdlib(source, pythonHome) {
  const libRoot = path.join(pythonHome, "Lib");
  const rel = path.relative(libRoot, source);
  if (!rel || rel === ".") return true;

  const segments = rel.split(path.sep);
  const lower = segments.map((part) => part.toLowerCase());
  const first = lower[0];
  const name = path.basename(source).toLowerCase();

  if (lower.includes("__pycache__")) return false;
  if (name.endsWith(".pyc") || name.endsWith(".pyo")) return false;

  // Not required by the headless OCR API runtime.
  if (
    first === "site-packages" ||
    first === "test" ||
    first === "tests" ||
    first === "idlelib" ||
    first === "tkinter" ||
    first === "turtledemo" ||
    first === "ensurepip" ||
    first === "venv"
  ) {
    return false;
  }

  return true;
}

const PRUNED_SITE_PACKAGE_ROOTS = new Set([
  "pip",
  "_pytest",
  "pytest",
  "pytest_cov",
  "coverage",
  "ruff",
  "piptools",
  "pip_tools",
  "wheel",
  "~nnxruntime",
  // Build-only / legacy PyTorch model-export stack. Production LamaLarge uses
  // ONNX Runtime and must not carry these packages in the portable runtime.
  "torch",
  "torchgen",
  "functorch",
  "torchvision",
  "sympy",
  "networkx",
  "mpmath",
  "onnx",
  "onnxscript",
  "onnx_ir",
  "ml_dtypes",
]);

const PRUNED_DIST_INFO_PREFIXES = [
  "pip-",
  "pytest-",
  "pytest_cov-",
  "coverage-",
  "ruff-",
  "pip_tools-",
  "wheel-",
  "torch-",
  "torchvision-",
  "sympy-",
  "networkx-",
  "mpmath-",
  "onnx-",
  "onnxscript-",
  "onnx_ir-",
  "ml_dtypes-",
];

function shouldKeepSitePackage(source, sitePackagesRoot) {
  const rel = path.relative(sitePackagesRoot, source);
  if (!rel || rel === ".") return true;

  const segments = rel.split(path.sep);
  const lowerSegments = segments.map((part) => part.toLowerCase());
  const first = lowerSegments[0];
  const name = path.basename(source).toLowerCase();

  if (lowerSegments.includes("__pycache__")) return false;
  if (name.endsWith(".pyc") || name.endsWith(".pyo")) return false;
  if (PRUNED_SITE_PACKAGE_ROOTS.has(first)) return false;
  if (PRUNED_DIST_INFO_PREFIXES.some((prefix) => first.startsWith(prefix))) return false;

  // Package-internal tests are unnecessary in the shipped application.
  if (lowerSegments.includes("tests") || lowerSegments.includes("test")) return false;

  return true;
}

function ensureLamaLargeOnnxModel() {
  const venvPython = path.join(venvDir, "Scripts", "python.exe");
  const sourceModel = path.join(ocrServiceDir, "models", "anime-manga-big-lama.pt");
  const outputModel = path.join(ocrServiceDir, "models", "anime-manga-big-lama.onnx");
  const exporter = path.join(ocrServiceDir, "scripts", "export_lama_onnx.py");

  if (!fs.existsSync(venvPython)) {
    throw new Error(`Build Python was not found: ${venvPython}`);
  }
  if (!fs.existsSync(sourceModel)) {
    throw new Error(
      `LamaLarge TorchScript source model was not found: ${sourceModel}. ` +
      "Run the model installer with --include-anime-lama or --all first."
    );
  }

  execFileSync(
    venvPython,
    [
      exporter,
      "--source",
      sourceModel,
      "--output",
      outputModel,
    ],
    {
      cwd: ocrServiceDir,
      stdio: "inherit",
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
      },
    }
  );

  if (!fs.existsSync(outputModel) || fs.statSync(outputModel).size <= 1000) {
    throw new Error(`LamaLarge ONNX export did not produce a usable model: ${outputModel}`);
  }
  return outputModel;
}

function preparePortablePythonRuntime() {
  const pythonHome = parseVenvHome();
  const sitePackagesSource = path.join(venvDir, "Lib", "site-packages");
  if (!fs.existsSync(sitePackagesSource)) {
    throw new Error(`Python site-packages directory not found: ${sitePackagesSource}`);
  }

  fs.rmSync(portableRuntimeDir, { recursive: true, force: true });
  fs.mkdirSync(portableRuntimeDir, { recursive: true });

  for (const entry of fs.readdirSync(pythonHome, { withFileTypes: true })) {
    const lower = entry.name.toLowerCase();
    const source = path.join(pythonHome, entry.name);
    const destination = path.join(portableRuntimeDir, entry.name);

    if (entry.isDirectory()) {
      if (lower === "dlls") {
        fs.cpSync(source, destination, {
          recursive: true,
          filter(candidate) {
            const name = path.basename(candidate).toLowerCase();
            return !name.endsWith(".pyc") && !name.endsWith(".pyo") && name !== "__pycache__";
          },
        });
      } else if (lower === "lib") {
        fs.cpSync(source, destination, {
          recursive: true,
          filter: (candidate) => shouldKeepStdlib(candidate, pythonHome),
        });
      }
      continue;
    }

    const isPythonBinary = lower === "python.exe" || lower === "pythonw.exe";
    const isRuntimeDll = lower.startsWith("python") && lower.endsWith(".dll");
    const isVcRuntime = lower.startsWith("vcruntime") && lower.endsWith(".dll");
    const isLicense = lower === "license.txt";

    if (isPythonBinary || isRuntimeDll || isVcRuntime || isLicense) {
      fs.copyFileSync(source, destination);
    }
  }

  const sitePackagesDestination = path.join(portableRuntimeDir, "Lib", "site-packages");
  fs.mkdirSync(sitePackagesDestination, { recursive: true });
  fs.cpSync(sitePackagesSource, sitePackagesDestination, {
    recursive: true,
    filter: (candidate) => shouldKeepSitePackage(candidate, sitePackagesSource),
  });

  const pythonExe = path.join(portableRuntimeDir, "python.exe");
  if (!fs.existsSync(pythonExe)) {
    throw new Error("Portable Python runtime did not contain python.exe");
  }

  // Validate the copied runtime in-place before spending time on Electron
  // packaging. Production LamaLarge must execute through ONNX Runtime without
  // importing PyTorch; AOT remains the fallback if LamaLarge cannot initialize.
  execFileSync(
    pythonExe,
    [
      "-c",
      [
        "import numpy as np",
        "import fastapi, uvicorn, cv2, PIL, onnxruntime, huggingface_hub",
        "from app.cleaners.lama_large import LamaLargeCleaner",
        "from app.mask_refiner import MaskRegion",
        "from app.schemas import PixelRect",
        "model = 'models/anime-manga-big-lama.onnx'",
        "cleaner = LamaLargeCleaner.from_model_path(model)",
        "image = np.full((192, 192, 3), 255, dtype=np.uint8)",
        "image[70:125, 70:125] = 32",
        "mask = np.zeros((192, 192), dtype=np.uint8); mask[88:104, 88:104] = 255",
        "region = MaskRegion(id='desktop-build-probe', rect=PixelRect(x=56, y=56, width=80, height=80), component_ids=(1,), stroke_radius=1)",
        "result = cleaner.clean(image, mask, region)",
        "assert result.shape == image.shape and result.dtype == image.dtype",
        "assert np.array_equal(result[mask == 0], image[mask == 0])",
        "assert cleaner.providers",
        "print('portable-python-lamalarge-onnx-ok providers=' + ','.join(cleaner.providers))",
      ].join('; '),
    ],
    {
      cwd: ocrServiceDir,
      stdio: "inherit",
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
      },
    }
  );

  return directorySize(portableRuntimeDir);
}

console.log("=== Building SuperK Windows Desktop Application ===");

// 1. Next.js production build
console.log("\n[Step 1/4] Building Next.js production bundle...");
try {
  const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
  execFileSync(process.execPath, [nextCli, "build"], {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
  console.log("✓ Next.js build complete.");

  const standaloneDir = path.join(projectRoot, ".next", "standalone");
  const publicDir = path.join(projectRoot, "public");
  const staticDir = path.join(projectRoot, ".next", "static");

  if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
    throw new Error("Next standalone server.js was not generated. Check output: 'standalone' in next.config.ts.");
  }

  // Next standalone does not copy public/.next/static automatically. Put both
  // beside standalone/server.js so the embedded production server can serve UI assets.
  if (fs.existsSync(publicDir)) {
    fs.cpSync(publicDir, path.join(standaloneDir, "public"), { recursive: true });
  }

  if (fs.existsSync(staticDir)) {
    const standaloneNextDir = path.join(standaloneDir, ".next");
    fs.mkdirSync(standaloneNextDir, { recursive: true });
    fs.cpSync(staticDir, path.join(standaloneNextDir, "static"), { recursive: true });
  }

  console.log("✓ Standalone runtime assets prepared.");
} catch (err) {
  console.error("✗ Next.js build failed:", err.message);
  process.exit(1);
}

// 2. Minimal Electron app staging
console.log("\n[Step 2/4] Staging minimal Electron application...");
try {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  fs.cpSync(path.join(projectRoot, "electron"), path.join(stageDir, "electron"), {
    recursive: true,
    filter(source) {
      const name = path.basename(source).toLowerCase();
      return !name.endsWith(".test.js") && !name.endsWith(".test.ts");
    },
  });

  copyNextStandalone(path.join(projectRoot, ".next", "standalone"));

  const rootPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const stagedPackage = {
    name: "superk-desktop",
    version: rootPackage.version || "0.1.0",
    private: true,
    main: "electron/main.js",
    description: "SuperK Manga Translator desktop application",
    author: "SuperK",
  };
  fs.writeFileSync(
    path.join(stageDir, "package.json"),
    `${JSON.stringify(stagedPackage, null, 2)}\n`,
    "utf8"
  );

  assertNoEnvFiles(stageDir);
  console.log(`✓ Minimal app staged (${formatMb(directorySize(stageDir))}).`);
} catch (err) {
  console.error("✗ Desktop app staging failed:", err.message);
  process.exit(1);
}

// 3. Production LamaLarge ONNX model + portable Python runtime
console.log("\n[Step 3/4] Preparing LamaLarge ONNX and relocatable Python OCR runtime...");
try {
  const lamaOnnxPath = ensureLamaLargeOnnxModel();
  console.log(`✓ LamaLarge production model ready (${formatMb(fs.statSync(lamaOnnxPath).size)}).`);
  const runtimeBytes = preparePortablePythonRuntime();
  console.log(`✓ Portable Python runtime validated (${formatMb(runtimeBytes)}).`);
} catch (err) {
  console.error("✗ Portable Python runtime preparation failed:", err.message);
  process.exit(1);
}

// 4. Electron Builder
console.log("\n[Step 4/4] Running electron-builder for Windows portable target...");
try {
  const builderCli = path.join(projectRoot, "node_modules", "electron-builder", "cli.js");
  execFileSync(
    process.execPath,
    [builderCli, "--win", "portable", "--config", path.join(projectRoot, "electron-builder.yml")],
    {
      cwd: stageDir,
      stdio: "inherit",
    }
  );
  console.log("✓ Electron builder packaging complete.");
} catch (err) {
  console.error("✗ Electron builder failed:", err.message);
  process.exit(1);
}

const distDir = path.join(projectRoot, "dist", "desktop");
const portableExe = path.join(distDir, "SuperK-Windows-Portable.exe");
if (fs.existsSync(portableExe)) {
  const bytes = fs.statSync(portableExe).size;
  console.log(`\n🎉 SuperK portable bundle created: ${portableExe}`);
  console.log(`   Portable EXE size: ${formatMb(bytes)}`);
} else if (fs.existsSync(distDir)) {
  console.log(`\n✓ Desktop distribution created at: ${distDir}`);
}
