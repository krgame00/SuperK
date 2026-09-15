# 19: Brightness Classification & Outline Strengthening

**What to build:** Make Binary Fill choose a stable preferred pair from trustworthy source color evidence. Source accent classification is luminance-led rather than based on color names, and weak/pastel source-colored outlines may be strengthened while preserving hue where practical.

**Blocked by:** 18: Binary Fill Readable Foundation.

**Status:** closed

- [x] A trustworthy Source accent color can be derived from detected source fill or outline evidence without using surrounding background color as the accent.
- [x] Source accent classification is based primarily on luminance/brightness rather than semantic hue names.
- [x] Light/bright Source accents prefer white fill plus Source-accent outline before local background admission.
- [x] Dark/near-black Source accents prefer black fill plus white/light high-contrast outline before local background admission.
- [x] Ambiguous mid-tone Source accents are not forced into one mapping by hue; both binary directions remain eligible for Readability-gate evaluation.
- [x] Pastel/light Source-accent outlines may be darkened/strengthened when necessary for separation.
- [x] Outline strengthening preserves recognizable source hue where practical instead of replacing every weak accent with black.
- [x] Exact source RGB is not treated as mandatory in Readable behavior when it would make the outline unreadable.
- [x] A safe neutral outline remains available when the Source accent cannot produce adequate separation.
- [x] Fill remains strictly white or black throughout classification and outline-strengthening behavior.
- [x] Dark, bright, pastel, and ambiguous source-color fixtures cover the observable resolved-style contract without locking tests to one private luminance threshold or color-space helper.

