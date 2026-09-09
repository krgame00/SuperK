# 02: Classify Cleaner Failures

**What to build:** When a page cannot be prepared or cleaned because the local Python sidecar is unavailable, the translator sees a Translation failure diagnostic identifying the local cleaner problem and can perform the recovery operation offered by the prompt. The same failure remains associated with the affected pages during retry.

**Blocked by:** None (can start immediately)

**Status:** in-review

- [ ] Sidecar connection refusal, health failure, and local cleaning timeout are classified as `LOCAL_SIDECAR_OFFLINE`. *(The common request path and failed-job path are covered; a full workspace timeout harness remains.)*
- [x] Cleaning-stage failures reach the same diagnostic grouping used for translation-stage failures.
- [x] A local cleaner failure is not grouped as `UNKNOWN_ERROR` solely because translation was never attempted.
- [x] The diagnostic view identifies the affected page numbers and preserves their failure group for a targeted retry.
- [ ] The cleaner recovery action checks or restarts the managed sidecar when the desktop environment supports that operation.
- [ ] If automatic restart is unavailable, the prompt gives truthful manual guidance and does not claim that a restart occurred. *(The current retry-probe label needs a dedicated health/restart action.)*
- [ ] Workspace workflow tests verify the observable classification, grouping, action result, and retry scope. *(Classifier and modal contract tests are present; full workspace coverage remains.)*
