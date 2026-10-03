# Per-page export source

User approved both original and clean export, selected separately for each image because some pages are blank.

- Each page has `exportSource?: "translated" | "original" | "clean"`; absent/invalid values mean translated for existing projects.
- Current-page controls show “ส่งออกหน้านี้เป็น” with “พร้อมคำแปล”, “ต้นฉบับ”, “ภาพคลีน”. Choice is independent of preview layer and persists through navigation, reorder and saved projects.
- Single-image export and PDF/strip/ZIP/CBZ honor each page's choice. Originals preserve source pixels and source text; clean pages contain no translation overlay. Translated export keeps existing review and rendering safeguards.
- Blank pages can export originals without OCR or translation. Missing clean assets produce an explicit error; no silent substitution.
- Translation/readability reviews apply only to translated pages. Cleaning uncertainty review applies to clean pages; originals bypass derived-image reviews.
- Raw original/clean image files preserve bytes and use extensions matching their actual MIME. PDF and strip may reencode as required by their formats.
- Source choices are captured for an export operation and cannot be changed mid-export. Default translated failure remains failure, never original fallback.
- Verify synthetic fixtures only, including mixed-source export, blank pages, persistence, unavailable clean images, review routing and file MIME.
