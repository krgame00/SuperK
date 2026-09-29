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

  const serverJsPath = path.join(standaloneDir, 'server.js');
  if (fs.existsSync(serverJsPath)) {
    for (const envFile of ['.env', '.env.local']) {
      const srcEnv = path.join(projectRoot, envFile);
      const destEnv = path.join(standaloneDir, envFile);
      if (fs.existsSync(srcEnv)) {
        fs.copyFileSync(srcEnv, destEnv);
        console.log(`[Env] Synced ${envFile} -> .next/standalone/${envFile}`);
      }
    }
    let serverContent = fs.readFileSync(serverJsPath, 'utf8');
    if (!serverContent.includes('loadEnvConfig')) {
      const envInject = "\nconst { loadEnvConfig } = require('@next/env');\ntry { loadEnvConfig(__dirname); } catch (e) { console.error('Failed to load env:', e); }\n";
      serverContent = serverContent.replace("const path = require('path')", "const path = require('path')" + envInject);
      fs.writeFileSync(serverJsPath, serverContent, 'utf8');
      console.log('[Env] Injected loadEnvConfig into .next/standalone/server.js');
    }
  }
}


