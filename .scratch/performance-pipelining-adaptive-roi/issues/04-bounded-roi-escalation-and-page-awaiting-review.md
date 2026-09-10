# 04: Bounded ROI Escalation & Page Awaiting Review

**What to build:** Add a bounded quality-recovery path for Adaptive cleaning scope so a page may escalate from normal/merged ROI to one expanded ROI attempt and then to one full-page LamaLarge attempt, with the existing verification/residual guard deciding each transition. If full-page verification still fails, the page must become Page awaiting review, be withheld from automatic translation, and remain isolated so unrelated pages can continue.

**Blocked by:** 03: Quality-First Adaptive ROI Cleaning.

**Status:** implemented (deterministic pipeline checks passed; pytest unavailable)

**Evidence (2026-09-10):** escalation is bounded per prepared page to normal ROI, expanded ROI, and full-page context; failed attempts restore source pixels, expanded retries keep the original authorized mask, protected pixels remain restored, and `awaiting_review` propagates through schema, API client, orchestration, manual retry, and diagnostic UI. Direct adaptive pipeline checks passed with exactly two escalation attempts and no fourth attempt.

- [ ] A page initially routed through ROI is verified using the existing quality/residual guard before it is considered prepared.
- [ ] A failed normal/merged ROI attempt may escalate once to an expanded/context-enlarged ROI attempt.
- [ ] A failed expanded ROI attempt may escalate once to full-page LamaLarge.
- [ ] A prepared-page revision performs no more than three quality attempts total and cannot enter a recursive or unbounded retry loop.
- [ ] When Adaptive cleaning scope selects full-page as the initial route, unnecessary ROI attempts are skipped rather than forced before full-page cleaning.
- [ ] Full-page verification failure ends automatic preparation for that revision and marks the page as Page awaiting review.
- [ ] A Page awaiting review is not sent to automatic Gemini translation until the user resolves or explicitly retries it through the supported workflow.
- [ ] One Page awaiting review does not stop unrelated pages in the batch from continuing.
- [ ] Failure state remains page-scoped and does not invalidate a successful previous page.
- [ ] Every escalation level preserves the authorized cleaning support and existing protected-artwork rules.
- [ ] Observability can report the route and escalation-attempt count so benchmark evidence can distinguish ROI success from fallback work.
- [ ] Production-pipeline tests prove the accepted escalation order, the three-attempt ceiling, direct full-page routing, full-page terminal failure, Page awaiting review behavior, and isolation of unrelated pages.
