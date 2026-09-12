# SuperK — Development Summary

Web manga translator with local-first text cleaning and Gemini API translation.

## Architecture
```
Image → ocr-service (FastAPI :8765) detect → refine → route → clean → verify → Gemini / 9router text overlay
```

- **Local Cleaning Pipeline (`ocr-service/`)**:
  - FastAPI service on port 8765
  - CTD (Comic Text Detector) text detection
  - Mask refiner with artwork & speedline protection
  - Cleaners: Flat / Gradient / AOT ONNX / LaMa Large
  - Disk-backed job persistence & recovery
- **Frontend (`src/app/`)**:
  - Next.js (Turbopack)
  - Interactive speech bubble overlay with 360° rotate, diagonal scale, 4-way move, and quick-action pill toolbar
  - Thai semantic word segmentation (`Intl.Segmenter`) and symmetric adaptive bubble expansion
  - Export: PNG / Webtoon Strip / ZIP / CBZ / PDF with affine rotation transformation

For details and benchmark specifications, see `README.md` and `docs/cleaning-benchmark.md`.
