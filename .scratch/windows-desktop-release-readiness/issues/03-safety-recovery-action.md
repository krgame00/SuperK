# 03: Make Safety Recovery Action Work

**What to build:** When Gemini blocks pages through a safety filter, the translator can click the advertised recovery action to enable Comic Slicing in the state used by the next translation request and retry only the blocked pages. Completed pages remain unchanged.

**Blocked by:** 02: Classify Cleaner Failures

**Status:** in-review

- [x] A safety-blocked failure is grouped as `SAFETY_BLOCKED` with the affected pages attached.
- [x] Clicking the recovery action changes the Comic Slicing or NSFW bypass setting consumed by the translation request.
- [x] The action retries only the pages in that safety failure group.
- [x] The action does not retry pages that already succeeded or pages added to a later failure group.
- [x] The modal closes only after the action has been accepted and the targeted retry has been scheduled.
- [ ] The user receives accurate progress and failure feedback if the targeted retry fails again.
- [ ] Workspace workflow tests prove the setting change and targeted retry through observable behavior. *(The modal callback contract is covered; an end-to-end workspace harness is still needed.)*
