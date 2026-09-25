import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const rootDir = process.cwd();
const launcherVbs = path.join(rootDir, "SuperK-Launcher.vbs");
const userProfile = process.env.USERPROFILE || "C:\\Users\\PC";
const desktopDir = path.join(userProfile, "Desktop");
const shortcutPath = path.join(desktopDir, "SuperK Manga Translator.lnk");
const staleShortcut = path.join(desktopDir, "start - Shortcut.lnk");

// Determine icon path (high-res app-icon or favicon)
let iconPath = path.join(rootDir, "public", "app-icon.ico");
if (!fs.existsSync(iconPath)) {
  iconPath = path.join(rootDir, "public", "favicon.ico");
}

console.log(`Setting up Desktop Shortcut: ${shortcutPath}`);

// Clean up stale shortcuts
if (fs.existsSync(staleShortcut)) {
  try {
    fs.unlinkSync(staleShortcut);
    console.log(`Removed stale shortcut: ${staleShortcut}`);
  } catch (err) {
    console.warn(`Could not remove ${staleShortcut}: ${err.message}`);
  }
}

// Temporary PowerShell script to create Desktop shortcut targeting wscript.exe
const tempPs1 = path.join(rootDir, ".scratch", "make-shortcut.ps1");
fs.mkdirSync(path.dirname(tempPs1), { recursive: true });

const psScript = `
$wscriptExe = (Get-Command wscript.exe).Source
$sh = New-Object -ComObject WScript.Shell
$sc = $sh.CreateShortcut('${shortcutPath}')
$sc.TargetPath = $wscriptExe
$sc.Arguments = '"${launcherVbs}"'
$sc.WorkingDirectory = '${rootDir}'
$sc.Description = 'SuperK Manga Translator - Silent Background Launcher'
if (Test-Path '${iconPath}') {
    $sc.IconLocation = '${iconPath},0'
}
$sc.Save()
`;

fs.writeFileSync(tempPs1, psScript, "utf-8");

try {
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tempPs1}"`, {
    stdio: "inherit",
  });
} finally {
  if (fs.existsSync(tempPs1)) {
    try {
      fs.unlinkSync(tempPs1);
    } catch {}
  }
}

console.log("Successfully created/updated Desktop Shortcut targeting silent launcher!");
