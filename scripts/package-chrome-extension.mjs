import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const source = new URL('../chrome-extension/', import.meta.url);
const zip = new JSZip();
// Explicit allowlist: never include app environment files or local credentials.
const files = ['manifest.json', 'background.js', 'server.js', 'content.js', 'content.css', 'popup.html', 'popup.js', 'README.md'];
for (const icon of await readdir(new URL('icons/', source))) {
  if (icon.endsWith('.png')) files.push(`icons/${icon}`);
}
for (const file of files) zip.file(file, await readFile(new URL(file, source)));
const output = new URL('../dist/superk-chrome-extension.zip', import.meta.url);
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(fileURLToPath(output));
