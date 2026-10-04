import {describe,it,expect} from 'vitest';
import {createPageTargetIdentity} from '@/lib/extension/strictParity';
import {withReviewIdentity} from '@/lib/translation/qualityReview';
import {NextRequest} from 'next/server';
import {POST,_resetPublishedForTest} from '@/src/app/api/extension/publish-back/route';
import {_resetPairingTokenForTest} from '@/lib/server/pairing';
describe('strict extension publication',()=>{
 it('accepts fully identified publication and preserves diagnostics',async()=>{
 _resetPublishedForTest();_resetPairingTokenForTest('g05');const t='ไทย';const payload={pageUrl:'https://a/good',targetIdentity:createPageTargetIdentity('th'),sourceRevision:'pixels',backgroundState:'approved',backgroundRevision:'clean',sourceDiagnostics:{unchanged:true},bubbles:[{t,original_text:'source',box:[0,0,10,10],translationReview:withReviewIdentity({status:'ok',sourceText:'source',reviewedText:t},'th','pixels')}]};
 const response=await POST(new NextRequest('http://localhost/api/extension/publish-back',{method:'POST',headers:{authorization:'Bearer g05','Content-Type':'application/json'},body:JSON.stringify(payload)}));expect(response.status).toBe(200);
 });
 it('public endpoint blocks reviewed foreign fallback with empty t and malformed source',async()=>{
 _resetPublishedForTest();_resetPairingTokenForTest('g05');
 for(const bubble of [{t:'',translated:'ABC',original_text:'source',box:[0,0,10,10],translationReview:withReviewIdentity({status:'accepted',sourceText:'source',reviewedText:'ABC'},'th','pixels')},{t:'ไทย',original_text:42,box:[0,0,10,10]}]){
 const response=await POST(new NextRequest('http://localhost/api/extension/publish-back',{method:'POST',headers:{authorization:'Bearer g05','Content-Type':'application/json'},body:JSON.stringify({pageUrl:'https://a/x',targetIdentity:createPageTargetIdentity('th'),sourceRevision:'pixels',backgroundState:'approved',bubbles:[bubble]})}));expect(response.status).toBe(409);
 }
 });
 it('rejects legacy raster and accepted contaminated lettering',async()=>{
 _resetPublishedForTest();_resetPairingTokenForTest('g05');
 for(const t of ['ไทย','ไทย𐐀']){
 const response=await POST(new NextRequest('http://localhost/api/extension/publish-back',{method:'POST',headers:{authorization:'Bearer g05','Content-Type':'application/json'},body:JSON.stringify({pageUrl:'https://a/x',bubbles:[{t,box:[0,0,10,10],translationReview:{status:'accepted'}}],cleanUrl:'data:image/png;base64,old'})}));
 expect(response.status).toBe(409);
 }
 });
});
