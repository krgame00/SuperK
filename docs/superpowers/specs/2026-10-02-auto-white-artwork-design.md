# Auto white artwork text

Approved by the user on 2026-10-02: artwork text uses white interiors and detected source color as an outline. Ordinary black text in white balloons stays black. Manual, Original, and explicit Readable choices remain authoritative.

The PDF exports demonstrate the reported readability problem but do not contain the original extraction metadata. A deterministic source sampler experiment independently reproduces white interiors being mistaken for pink ink when several glyphs occupy a crop. The new presentation policy must not depend on deciding which of two source colors is the interior.

Apply the presentation rule to explicit overlay subtitles and automatic colored source text, including unclassified colored text. Admitted text on dark backgrounds also uses white interiors. Keep the monochrome page policy for other categories. For a trustworthy chromatic source, use its detected ink/accent as the outline; strengthen excessively light colors. Untrusted evidence uses a dark outline. Do not reuse a source gradient as white fill.

Keep extracted profiles as source evidence so Original remains available. Use the shared resolver for preview and export. Version derived rendering and invalidate eligible saved renders without destroying source profiles or user choices. Do not change OCR/removal masks, layout, or the extraction heuristic in this work. Its independently reproduced limitation remains tracked separately.

Acceptance: no colored interiors for eligible Auto text; visible outlines even for borderless source text; source-white and reversed source-color profiles resolve consistently; weak/rejected colors never become trusted outlines; ordinary white-balloon dialogue and explicit ownership modes retain their behavior; saved render caches refresh.
