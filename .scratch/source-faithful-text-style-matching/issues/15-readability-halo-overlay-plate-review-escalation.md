# 15: Readability Halo, Overlay Plate & Review Escalation

**What to build:** Complete the Adaptive Readable escalation path for regions that still fail after safe Fill + Outline selection. The system must escalate conservatively from thicker outline to a controlled readability halo/shadow, then allow a background plate only for Overlay Subtitle as a final automatic rescue. Other categories must remain visually conservative and expose review-required state instead of painting new plates into the manga.

**Blocked by:** 14: Mixed-Background Readability Scoring & Outline Escalation.

**Status:** closed

- [x] Controlled shadow/halo is introduced only after ordinary Fill + Outline candidates, including stronger outline, still fail the Readability gate.
- [x] Readability halo/shadow is represented separately from recovered decorative source glow/shadow so fallback safety is not mislabeled as source styling.
- [x] Halo/shadow remains restrained and readability-oriented rather than becoming a decorative effect by default.
- [x] Overlay Subtitle may escalate to a background plate only after outlined and halo/shadow candidates still fail.
- [x] Automatic background plates are not created for Dialogue.
- [x] Automatic background plates are not created for Narration / Panel Caption.
- [x] When Dialogue or Narration / Panel Caption still cannot satisfy readability after non-plate escalation, the system retains the strongest non-plate candidate and marks the region review-required.
- [x] Overlay Subtitle plate state carries enough resolved metadata for persistence, workspace rendering, and export to reproduce the same result.
- [x] Review-required state is explicit and non-fatal; translation continues normally.
- [x] Manual style is never given automatic halo, shadow, or plate escalation.
- [x] Auto remains Auto while recording the escalation/fallback reason and resolved safety level.
- [x] Regression coverage proves category restrictions and escalation order through the Style Resolution + Readability/Fallback Policy and Overlay/UI/Export Behavior seams.
