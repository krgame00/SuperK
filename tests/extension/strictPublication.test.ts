import {describe,it,expect} from 'vitest';
import {createPageTargetIdentity} from '@/lib/extension/strictParity';
import {withReviewIdentity} from '@/lib/translation/qualityReview';
import {NextRequest} from 'next/server';
import {POST,_resetPublishedForTest} from '@/src/app/api/extension/publish-back/handler';
import {_resetPairingTokenForTest} from '@/lib/server/pairing';
import {inspectedBackgroundEvidence,TEST_CLEAN_DATA_URL} from '../helpers/extensionBackgroundEvidence';
describe('strict extension publication',()=>{
 it('rejects malformed background states and missing revisions at the public boundary',async()=>{
  _resetPublishedForTest();_resetPairingTokenForTest('g05');
  const t='ไทย';const payload={pageUrl:'https://a/state',targetIdentity:createPageTargetIdentity('th'),sourceRevision:'a'.repeat(64),bubbles:[{t,original_text:'source',box:[0,0,10,10],translationReview:withReviewIdentity({status:'ok',sourceText:'source',reviewedText:t},'th','a'.repeat(64))}]};
  for(const evidence of [{backgroundState:'garbage',backgroundRevision:'clean'},{backgroundState:{approved:true},backgroundRevision:'clean'},{backgroundState:true,backgroundRevision:'clean'},{backgroundState:'approved'},{backgroundState:'approved',backgroundRevision:' '},{backgroundState:'human-confirmed',backgroundRevision:42}]){
   const response=await POST(new NextRequest('http://localhost/api/extension/publish-back',{method:'POST',headers:{authorization:'Bearer g05','Content-Type':'application/json'},body:JSON.stringify({...payload,...evidence})}));expect(response.status).toBe(409);
  }
 });
 it('accepts fully identified publication and preserves diagnostics',async()=>{
 _resetPublishedForTest();_resetPairingTokenForTest('g05');const t='ไทย';const sourceRevision='a'.repeat(64);const payload={pageUrl:'https://a/good',targetIdentity:createPageTargetIdentity('th'),sourceRevision,...inspectedBackgroundEvidence(sourceRevision),cleanUrl:TEST_CLEAN_DATA_URL,sourceDiagnostics:{unchanged:true},bubbles:[{t,original_text:'source',box:[0,0,10,10],translationReview:withReviewIdentity({status:'ok',sourceText:'source',reviewedText:t},'th',sourceRevision)}]};
 const response=await POST(new NextRequest('http://localhost/api/extension/publish-back',{method:'POST',headers:{authorization:'Bearer g05','Content-Type':'application/json'},body:JSON.stringify(payload)}));expect(response.status).toBe(200);
 });
 it('public endpoint blocks reviewed foreign fallback with empty t and malformed source',async()=>{
 _resetPublishedForTest();_resetPairingTokenForTest('g05');
 for(const bubble of [{t:'',translated:'ABC',original_text:'source',box:[0,0,10,10],translationReview:withReviewIdentity({status:'accepted',sourceText:'source',reviewedText:'ABC'},'th','a'.repeat(64))},{t:'ไทย',original_text:42,box:[0,0,10,10]}]){
 const sourceRevision='a'.repeat(64);const response=await POST(new NextRequest('http://localhost/api/extension/publish-back',{method:'POST',headers:{authorization:'Bearer g05','Content-Type':'application/json'},body:JSON.stringify({pageUrl:'https://a/x',targetIdentity:createPageTargetIdentity('th'),sourceRevision,...inspectedBackgroundEvidence(sourceRevision),cleanUrl:TEST_CLEAN_DATA_URL,bubbles:[bubble]})}));expect(response.status).toBe(409);
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

it('rejects a clean image whose bytes differ from the inspected background revision',async()=>{
 _resetPublishedForTest();_resetPairingTokenForTest('g05');const sourceRevision='a'.repeat(64);const t='ไทย';
 const response=await POST(new NextRequest('http://localhost/api/extension/publish-back',{method:'POST',headers:{authorization:'Bearer g05','Content-Type':'application/json'},body:JSON.stringify({pageUrl:'https://a/mismatch',targetIdentity:createPageTargetIdentity('th'),sourceRevision,...inspectedBackgroundEvidence(sourceRevision),cleanUrl:'data:image/png;base64,Yg==',bubbles:[{t,original_text:'source',box:[0,0,10,10],translationReview:withReviewIdentity({status:'ok',sourceText:'source',reviewedText:t},'th',sourceRevision)}]})}));
 expect(response.status).toBe(409);
});
