import { expect, it } from "vitest";
import { createPageTargetIdentity, inspectPageOutputEligibility } from "@/lib/translation/pageEligibility";
const localRequirements={contextual:false,background:false};

it("requires a recorded page target instead of guessing next-job settings", () => {
  expect(inspectPageOutputEligibility({ requirements:localRequirements, points: [{id:"1",text:"สวัสดี"}] })).toMatchObject({status:"blocked",reasons:["target-unconfirmed"]});
});
it("canonicalizes recorded identities and blocks ambiguous assignment", () => {
  expect(createPageTargetIdentity("Thai")).toMatchObject({targetId:"th"});
  expect(createPageTargetIdentity("Chinese")).toBeUndefined();
});
it("blocks only invalid active points regardless of existing approvals", () => {
  const result=inspectPageOutputEligibility({targetIdentity:createPageTargetIdentity("th"),points:[{id:"a",text:"สวัสดี"},{id:"b",text:"กAา"},{id:"c",text:"BOOM",deleted:true}],contextualState:"approved",backgroundState:"approved"});
  expect(result).toMatchObject({status:"blocked",reasons:["script-violation"],pointIssues:[{pointId:"b",offendingCharacters:["A"]}]});
});
it("binds eligibility to target, policy, text, source and background revision", () => {
  const input={requirements:localRequirements,targetIdentity:createPageTargetIdentity("en"),points:[{id:"1",text:"Hello",sourceText:"こんにちは"}],sourceRevision:"s1",backgroundRevision:"b1"};
  const first=inspectPageOutputEligibility(input);
  expect(first.status).toBe("eligible");
  for(const changed of [{...input,targetIdentity:createPageTargetIdentity("fr")},{...input,points:[{id:"1",text:"Bye",sourceText:"こんにちは"}]},{...input,sourceRevision:"s2"},{...input,backgroundRevision:"b2"}])expect(inspectPageOutputEligibility(changed).revisionKey).not.toBe(first.revisionKey);
});
it("keeps contextual unavailability distinct from local violations", () => {
  const input={requirements:localRequirements,targetIdentity:createPageTargetIdentity("en"),points:[{id:"1",text:"Hello"}]};
  expect(inspectPageOutputEligibility({...input,contextualState:"unavailable"}).reasons).toEqual(["contextual-review-required"]);
  expect(inspectPageOutputEligibility({...input,contextualState:"human-confirmed"}).status).toBe("eligible");
  expect(inspectPageOutputEligibility({...input,backgroundState:"unresolved"}).reasons).toEqual(["background-review-required"]);
});
it("requires missing contextual/background evidence by default", () => {
  const result=inspectPageOutputEligibility({targetIdentity:createPageTargetIdentity("en"),points:[{id:"1",text:"Hello"}]});
  expect(result).toMatchObject({status:"blocked",scriptStatus:"eligible",reasons:["contextual-review-required","background-review-required"]});
});
