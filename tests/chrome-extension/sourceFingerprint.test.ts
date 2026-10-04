// @vitest-environment node
import {it,expect,vi} from 'vitest';
import {blobFingerprint} from '@/lib/cleaning/remnantReview';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const load=()=>{const c=vm.createContext({crypto:webcrypto,Uint8Array,atob});vm.runInContext(readFileSync('chrome-extension/policy.js','utf8'),c);return c.SuperKPolicy;};
it('original-byte hash distinguishes equal-size source replacements and ignores MIME labels',async()=>{
 const p=load();expect(typeof p.originalSourceFingerprint).toBe('function');
 const a=await p.originalSourceFingerprint(btoa('abc'));const b=await p.originalSourceFingerprint(btoa('abd'));expect(a).toMatch(/^[a-f0-9]{64}$/);expect(a).not.toBe(b);
});
it('extension base64 matches workspace original Blob SHA256 bytes',async()=>{
 const p=load();expect(typeof p.originalSourceFingerprint).toBe('function');const blob=new Blob([new Uint8Array([0,127,255])],{type:'image/png'});
 const bytes=await blob.arrayBuffer();const expected=Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');expect(await p.originalSourceFingerprint('AH//')).toBe(expected);
 vi.stubEnv('NODE_ENV','production');vi.stubGlobal('crypto',webcrypto);try{expect(await p.originalSourceFingerprint('AH//')).toBe(await blobFingerprint(blob));}finally{vi.unstubAllEnvs();vi.unstubAllGlobals();}
});
it('unavailable crypto never creates a weak source approval',async()=>{
 const c=vm.createContext({Uint8Array,atob});vm.runInContext(readFileSync('chrome-extension/policy.js','utf8'),c);expect(typeof c.SuperKPolicy.originalSourceFingerprint).toBe('function');await expect(c.SuperKPolicy.originalSourceFingerprint('AH//')).rejects.toThrow('SHA256');
});
