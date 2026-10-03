# Match original letter size and preserve smooth transform previews

The user chose visible original letter size over fitting the full original text block or enforcing the existing readable-size floor. Reliable small originals keep their matched size with readability warnings; longer translations wrap within reliable text-space boundaries and report overflow rather than silently shrinking or expanding over artwork. New translations default to source matching, saved work requires an explicit action, and manual size changes remain user-owned until explicitly returned to Auto.

Corner gestures may temporarily scale the existing text bitmap for smoother interaction, then render crisp text at the exact previewed size and position on release without changed line structure. Width gestures still show live reflow with fixed letter size. This preserves ADR 0018's distinction between width reflow and proportional scaling while accepting temporary softness instead of requiring glyph measurement and repaint every frame.

These product decisions were accepted in the eight-question interview on 2026-10-04. Measurement and profiling must establish trustworthy source-size evidence and the remaining dense-page bottleneck; implementation and final shared-understanding confirmation remain pending.
