import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {TARGET_LANGUAGES} from '@/lib/languagePolicy';
it('packaged generated policy uses exact canonical catalog',()=>{
 const c=vm.createContext({});vm.runInContext(readFileSync('chrome-extension/policy.js','utf8'),c);expect(JSON.parse(JSON.stringify(c.SuperKPolicy.TARGET_LANGUAGES))).toEqual(TARGET_LANGUAGES);
 expect(readFileSync('scripts/package-chrome-extension.mjs','utf8')).toContain("'policy.js'");expect(readFileSync('chrome-extension/manifest.json','utf8')).toContain('"policy.js"');
});
