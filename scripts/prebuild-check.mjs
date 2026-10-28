import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const standaloneDir = path.join(projectRoot, '.next', 'standalone');

if (fs.existsSync(standaloneDir)) {
  try {
    const tmpName = path.join(projectRoot, '.next', `standalone_locktest_${Date.now()}`);
    fs.renameSync(standaloneDir, tmpName);
    fs.renameSync(tmpName, standaloneDir);
  } catch (err) {
    if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) {
      console.error('\n❌ [Prebuild Guard] Build aborted: .next/standalone is currently locked by a running process (EBUSY).');
      console.error('   Running "next build" while the server or dev server is active causes Windows to lock files, which corrupts static assets.');
      console.error('   Please stop the running server on port 3000 before running "npm run build".\n');
      process.exit(1);
    }
  }
}
