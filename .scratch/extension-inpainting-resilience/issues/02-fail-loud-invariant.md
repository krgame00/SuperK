# 02: Strict Fail-Loud Invariant & Actionable Retry UI

**What to build:** When inpainting mode is selected, the extension strictly requires a non-empty cleaned background image before rendering. If inpainting fails, the asset download fails, or the resulting base64 is empty, the extension halts processing immediately, throws a descriptive error, and displays an actionable retry badge on the manga image, strictly forbidding rendering text over uncleaned original artwork or crude white boxes.

**Blocked by:** 01: Proxy Route Normalization & Inpainting Asset Client

**Status:** done

- [x] Inpainting pipeline explicitly asserts `cleanImageBase64` is non-empty, throwing `Error('ไม่ได้รับข้อมูลภาพที่ลบข้อความแล้ว (cleanImageBase64) จากระบบ Inpainting')` if missing.
- [x] Background worker dispatches `TRANSLATION_ERROR` with action badge and retry message handler.
- [x] Content script displays retry badge on failed image without rendering translated text bubbles over original artwork.
- [x] Regression tests verify fail-loud behavior when cleaner backend responds with errors or asset download fails.
