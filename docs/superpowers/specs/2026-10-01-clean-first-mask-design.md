# Clean first, edit mask afterward

## Approved user intent

Clean all detected text first, including colored text, borderless dialogue, text over artwork and review candidates. Preserve the original source so the user can repair missed or excessive cleaning afterward. The user approved this as the normal app workflow and approved simplifying the existing mask editor.

## Cleaning behavior

The app submits `cleaning_mode=all-text`. Legacy API requests/jobs without this field remain `safe` for backward compatibility. The all-text mode uses detected text masks rather than filling entire image or region rectangles; automatic eligibility/review/protection classification must not leave detected text untouched. Quality failures keep the bounded cleaning candidate and a needs-review marker instead of restoring source text. Failure/no detection must be reported honestly; no claim that OCR finds every glyph. Keep manual protect/restore actions and original source intact. Source/mode/pipeline identity participates in cache reuse so old safe cleaning cannot silently satisfy an all-text request. Persist/restore mode, including sidecar job recovery and retries. All-text quality flags remain visible but do not block subsequent translation.

## Mask editor refinement

Preserve the current app identity. Use plain Thai labels: `ลบข้อความ` paints the area to remove, `กู้ภาพเดิม` restores source pixels, and `ไม่ลบตรงนี้` removes the proposed mask. Keep the first two primary and move specialist cleaner/authorization controls into additional options. Show red as the area to remove, with original/cleaned comparison and current region highlighted. Fit the selected region when navigating. Main action `ใช้กับจุดนี้` applies edits without closing the editor; `จุดถัดไป` moves to the next region. Keep undo, brush size, zoom/pan, draft mask retention and existing bounded authorization paths. Restore brush submits through the existing restore/protect semantics, not force-clean. Retain ability to handle missed text through existing proposal refresh/detection recovery; do not imply unrestricted painting outside authorized regions is saved.

## Verification

Regressions for all-text versus safe behavior, rejected quality candidate retention, API/job persistence, cache/restoration identity, translation proceeding with all-text flags, and editor primary actions/draft navigation/restore. Run Python non-model and frontend gates. Actual user-page cleaning quality requires real model/image verification; attached screenshots do not supply the original page bytes.
