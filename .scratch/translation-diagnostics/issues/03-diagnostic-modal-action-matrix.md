# 03: Translation Diagnostic Modal & Action Matrix

**What to build:** When batch translation completes with one or more failed pages, a clear diagnostic modal appears instead of an unhelpful generic warning toast. The modal groups failed pages by root cause, clearly explains what went wrong in natural Thai, and provides one-click action buttons that directly resolve the issue (e.g. opening the Settings modal focused on the API Key input, enabling NSFW Bypass, or initiating a retry).

**Blocked by:** 02: Structured Translation Error Taxonomy & API Contract

**Status:** ready-for-agent

- [ ] A new `TranslationDiagnosticModal` opens automatically when batch translation completes with one or more failures
- [ ] Failures are clustered by error code with human-friendly Thai explanations and affected page numbers
- [ ] For `MISSING_KEY`: Provides an action button that opens Settings and automatically focuses the Gemini API Key input field
- [ ] For `SAFETY_BLOCKED`: Provides an action button that toggles NSFW / Comic Slicing Bypass mode and offers to re-translate the blocked pages
- [ ] For `QUOTA_EXHAUSTED`: Shows a friendly countdown timer for quota reset and suggests adding backup keys
- [ ] For `LOCAL_SIDECAR_OFFLINE`: Offers a troubleshooting guide and button to retry sidecar health checks
- [ ] Translators can dismiss the modal at any time or trigger targeted actions directly from it
- [ ] React component tests verify rendering and user interactions for each diagnostic category
