import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const server = await createServer({ configFile: false, root: process.cwd(),
  server: { host: '127.0.0.1', port: 4177, strictPort: true },
  resolve: { alias: { '@': process.cwd() } } });
await server.listen();
try {
  const child = spawn(require('electron'), ['tests/browser/tight-selection-electron.cjs',
    'http://127.0.0.1:4177/tests/browser/tight-selection.html'], { stdio: 'inherit', windowsHide: true });
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Browser verification timed out')); }, 45000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); resolve(code ?? 1); });
  });
  process.exitCode = exitCode;
} finally { await server.close(); }
