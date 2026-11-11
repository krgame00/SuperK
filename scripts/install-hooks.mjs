import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('scripts', 'hooks', 'pre-push');
const dest = path.resolve('.git', 'hooks', 'pre-push');

if (fs.existsSync(src) && fs.existsSync(path.resolve('.git', 'hooks'))) {
  fs.copyFileSync(src, dest);
  try {
    fs.chmodSync(dest, 0o755);
  } catch {}
  console.log('✓ SuperK Git pre-push hook installed successfully.');
}
