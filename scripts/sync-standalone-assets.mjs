import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const standaloneDir = path.join(projectRoot, '.next', 'standalone');
if (fs.existsSync(standaloneDir)) {
  const publicSrc = path.join(projectRoot, 'public');
  const publicDest = path.join(standaloneDir, 'public');
  if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, publicDest, { recursive: true });
    console.log('[Assets] Synced public -> .next/standalone/public');
  }

  const staticSrc = path.join(projectRoot, '.next', 'static');
  const staticDest = path.join(standaloneDir, '.next', 'static');
  if (fs.existsSync(staticSrc)) {
    fs.mkdirSync(path.dirname(staticDest), { recursive: true });
    fs.cpSync(staticSrc, staticDest, { recursive: true });
    console.log('[Assets] Synced .next/static -> .next/standalone/.next/static');
  }
}
