import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
console.log('Starting dense-page Vite harness');
const diagnostic = process.argv.includes('--diagnostic');
const nameIndex = process.argv.indexOf('--name');
const name = nameIndex === -1 ? '' : process.argv[nameIndex + 1];
if (nameIndex !== -1 && (!name || !/^[a-z0-9-]+$/i.test(name))) throw new Error('--name requires a letters/numbers/hyphens run label');
const prefix = name ? `P01-${name}` : 'P01';
const output = resolve('.superpowers/sdd/oct04-four-spec', `${prefix}-${diagnostic ? 'diagnostic' : 'baseline'}.json`);
mkdirSync(resolve('.superpowers/sdd/oct04-four-spec'), { recursive: true });
const server = await createServer({ configFile: false, root: process.cwd(),
  server: { host: '127.0.0.1', port: 4178, strictPort: true }, resolve: { alias: { '@': process.cwd() } } });
await server.listen();
console.log('Dense-page Vite ready');
try {
  const child = spawn(require('electron'), [resolve('tests/browser/dense-page-baseline-electron.cjs'),
    `http://127.0.0.1:4178/tests/browser/dense-page-baseline.html?diagnostic=${diagnostic ? 1 : 0}`],
    { stdio: 'inherit', windowsHide: true, env: { ...process.env, DENSE_OUTPUT: output, DENSE_TRACE: diagnostic ? '1' : '0' } });
  process.exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Dense-page baseline timed out')); }, 240000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); resolve(code ?? 1); });
  });
} finally { await server.close(); }
