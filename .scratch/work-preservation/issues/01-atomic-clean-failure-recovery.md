# 01: Atomic Clean Failure Recovery & Translation Cache Protection (P1)

**What to build:** When a translator requests a re-clean operation on an existing manga page, any failure or error in the inpainting engine preserves the page's existing translation, bubbles, and rendered image caches in full. The workspace only invalidates and replaces previous translation data after a new cleaned image has been successfully generated and returned.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Cleaning invocation propagates explicit success or failure state to the caller instead of swallowing errors silently.
- [x] Translation bubbles, inpainted clean backgrounds, and pre-rendered export image caches remain completely intact when a re-clean operation fails or throws an error.
- [x] Translation caches are evicted if and only if the replacement clean operation completes successfully.
- [x] Automated integration test in `tests/translation/` reproduces failed re-clean and verifies that translation bubbles survive without being wiped.
