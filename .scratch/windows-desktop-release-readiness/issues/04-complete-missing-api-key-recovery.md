# 04: Complete Missing API Key Recovery

**What to build:** From a `MISSING_KEY` diagnostic, the translator can go directly to the Gemini API key control, edit and save the credential, receive validation feedback, and then explicitly retry the original failed group without an automatic translation request being sent on save.

**Blocked by:** 01: Establish Stable Failure Groups

**Status:** closed

- [x] The missing-key action opens Settings directly at the Gemini API key control.
- [x] Keyboard focus moves to the API key input and the existing value is selected when appropriate for immediate replacement.
- [x] Saving from the missing-key recovery path validates the configured key before the diagnostic is considered resolved.
- [x] A valid key leaves the original failure group intact and marks it eligible for a user-initiated retry.
- [x] Saving or validating a key does not automatically send translation requests.
- [x] An invalid key keeps Settings open and presents an actionable validation error at the API key control.
- [x] The retry after successful validation targets only the pages captured by the original missing-key failure group.
- [x] A later unrelated failure cannot replace the failure group being recovered while Settings is open.
- [x] Workspace-level tests prove focus, validation success/failure, no automatic retry, and targeted retry through observable behavior.
