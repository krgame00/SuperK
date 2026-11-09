# Manga Translator - Development Summary

## Overview
Local manga translation tool using PaddleOCR (text extraction) + Gemini API (translation), designed to bypass Gemini's content filter for 18+ manga by not sending images to Gemini.

## Architecture
```
Image → PaddleOCR (localhost:8080) → Text blocks → Gemini API (text only) → Translation
```

## What We Built

### 1. Local OCR Service (`ocr-service/`)
- **`main.py`** - FastAPI + PaddleOCR 2.9.1 service
  - POST `/ocr` - accepts `{image, lang}` → returns `{text_blocks, raw_count, elapsed_ms}`
  - GET `/health` - health check
  - `merge_nearby_blocks()` - groups nearby text blocks into speech bubbles
  - Language support: `en`, `japan`, `ch`, `korean`, `th` (lazy-loaded per language)
- **`requirements.txt`** - paddlepaddle 2.6.2, paddleocr 2.9.1, fastapi 0.115.0
- **`Dockerfile`** - for future deployment

### 2. Frontend Changes
- **`hooks/useTranslation.ts`** - Added `useLocalOcr`, `ocrLang` states
  - Two-step flow: OCR → translate text only
- **`src/app/page.tsx`** - Settings modal with:
  - Local OCR toggle
  - Language selector (en/japan/ch/korean/th)

### 3. API Route
- **`src/app/api/ocr/route.ts`** - Proxy to OCR service, forwards `lang` parameter
- **`.env.local`** - `OCR_SERVICE_URL=http://localhost:8080`

## Merge Function
- **Purpose**: Group nearby text blocks that belong to same speech bubble
- **Algorithm**: Union-Find based on proximity
  - Horizontal gap < 4% of image width
  - Vertical gap < 4% of image height
  - Box height ratio > 60%
- **Sorting**: Right-to-left, top-to-bottom (manga reading order)
- **Results**: 30 raw blocks → 9-15 merged blocks (depends on page)

## Test Results

### Page 1 (Japanese manga)
- Raw: 30 → Merged: 15 blocks
- Merge working correctly, but OCR quality poor

### Page 2 (English manga)
- Raw: 21 → Merged: 8 blocks
- Merge working, OCR quality still poor

## Known Issues

### Critical: OCR Quality
PaddleOCR 2.9.1 produces **garbled text** for manga:
- Japanese text → gibberish
- English text → gibberish
- Stylized fonts and speech bubbles not handled well

### Merge Thresholds
- Too aggressive: merged text from different panels
- Fixed by reducing thresholds (12%→4% horizontal, 8%→4% vertical)

## Possible Next Steps
1. Try **EasyOCR** instead of PaddleOCR (better for stylized text)
2. Use **Gemini Vision** directly (but blocked for 18+ content)
3. Add **manual text input** option (slow but accurate)
4. Explore **manga-specific OCR models**

## Running the Project
```bash
# Terminal 1: OCR Service
cd ocr-service
venv\Scripts\activate
python main.py

# Terminal 2: Next.js
npm run dev
```

## File Locations
- Project: `C:\Users\PC\Downloads\manga-translator`
- OCR Service: `ocr-service/main.py`
- Python venv: `ocr-service/venv/`
- OCR models: `C:\Users\PC/.paddleocr/whl/`
