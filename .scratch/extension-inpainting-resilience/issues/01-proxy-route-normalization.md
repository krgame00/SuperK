# 01: Proxy Route Normalization & Inpainting Asset Client

**What to build:** The extension server client reliably requests inpainting jobs and downloads cleaned manga page assets through the Next.js proxy route (`http://127.0.0.1:3000/api/clean/v1/jobs/...`). When the inpainting service returns relative asset paths starting with `/v1/`, the client automatically normalizes them to `/api/clean/v1/...` so that asset fetching succeeds with HTTP 200 rather than encountering HTTP 404.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Relative clean asset paths beginning with `/v1/` are automatically prepended with `/api/clean` when base URL is port 3000.
- [x] Clean asset downloads assert HTTP 200 response status.
- [x] Clean asset blob is converted to Base64 and returned in `cleanImageBase64`.
- [x] Unit test verifies that `/v1/jobs/{jobId}/assets/clean.png` is correctly normalized and fetched via `/api/clean/v1/jobs/...`.
