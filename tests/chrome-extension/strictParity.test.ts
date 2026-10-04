import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
describe('extension source-backed review adapter',()=>{
 it('server adapter preserves identity payload and authorization',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({reviews:[]})});const c=vm.createContext({fetch,URL,AbortSignal,globalThis:null});c.globalThis=c;vm.runInContext(readFileSync('chrome-extension/server.js','utf8'),c);
 expect(typeof c.SuperKServer.reviewRequest).toBe('function');
 await c.SuperKServer.reviewRequest('/api/translation-review',{body:'{"items":[]}',signal:undefined},{serverUrl:'http://localhost:3000',pairingToken:'token'});
 expect(fetch.mock.calls[0][0]).toBe('http://localhost:3000/api/translation-review');expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
 });
 it('offline direct review uses source prompt and returns parsed review rows',async()=>{
 const fetch=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ok:true,json:async()=>({steps:[{type:'model_output',content:[{type:'text',text:'{"reviews":[{"id":"0","status":"ok"}]}'}]}]})});
 const c=vm.createContext({fetch,URL,AbortSignal,Response,globalThis:null,SuperKPolicy:{buildQualityReviewPrompt:()=> 'SOURCE PROMPT'}});c.globalThis=c;vm.runInContext(readFileSync('chrome-extension/server.js','utf8'),c);c.SuperKServer.discoverGeminiRoutes=async()=>[{model:'gemini-3.8-flash',apiKey:'mock'}];
 const response=await c.SuperKServer.reviewRequest('/api/translation-review',{body:'{"items":[],"targetLang":"th"}'},{translationMode:'direct',apiKey:'mock',serverUrl:'http://localhost'});
 expect((await response.json()).reviews[0].id).toBe('0');expect(fetch.mock.calls[1][0]).toContain('/interactions');expect(JSON.parse(fetch.mock.calls[1][1].body).input).toBe('SOURCE PROMPT');
 });
 it('reader consumes resolved float snapshot and does not expose unreviewed inline edits',()=>{
 const s=readFileSync('chrome-extension/content.js','utf8');expect(s).toContain('b.layoutSnapshot');expect(s).toContain('snapshot.fontSizePx * scale');expect(s).toContain('bubbleEl.contentEditable = "false"');
 });
 it('blocked results offer actionable source-backed editor review without lettering',()=>{
 expect(readFileSync('chrome-extension/background.js','utf8')).toContain('TRANSLATION_REVIEW_REQUIRED');expect(readFileSync('chrome-extension/content.js','utf8')).toContain('ตรวจจากต้นฉบับใน SuperK');
 });
 it('content boundary passes persisted identity before rendering cached lettering',()=>{
 const s=readFileSync('chrome-extension/content.js','utf8');expect(s).toContain('SuperKPolicy.inspectExtensionOutput');expect(s).toContain('saved.pageStyle, saved');
 });
});
