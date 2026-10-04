import {expect,test} from 'vitest';
import {isReviewCurrent,withReviewIdentity,type TranslationReview} from '@/lib/translation/qualityReview';
const sha='a'.repeat(64),box=[100,200,300,400];
const review=withReviewIdentity({status:'accepted',sourceText:'',reviewedText:'สวัสดี',sourceEvidenceKind:'image',humanVerified:true,sourceBox:box},'th',sha);
test('explicit image human review is exact source box evidence; raw text/source/box changes invalidate',()=>{
  const bubble={t:'สวัสดี',box,translationReview:review};
  expect(isReviewCurrent(bubble,'th',sha)).toBe(true);
  expect(isReviewCurrent({...bubble,box:[100,200,301,400]},'th',sha)).toBe(false);
  expect(isReviewCurrent({...bubble,t:'สวัสดี '},'th',sha)).toBe(false);
  expect(isReviewCurrent(bubble,'th','b'.repeat(64))).toBe(false);
});
test.each([{humanVerified:false},{sourceRevision:'old-url'},{status:'ok'},{sourceBox:[0,0,0,0]}])('image approval rejects nonhuman/invalid identity/invalid box %j',patch=>{
  expect(isReviewCurrent({t:'สวัสดี',box,translationReview:{...review,...patch} as TranslationReview},'th',sha)).toBe(false);
});
