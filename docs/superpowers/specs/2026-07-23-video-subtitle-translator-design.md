# Design Specification: Interactive Video Subtitle Translator Studio

**Date**: 2026-07-23  
**Status**: Approved  
**Target Feature**: Video Subtitle Translation (STT + Timestamping + Translation + Interactive Sync Editor + Export)

---

## 1. Overview
The **Interactive Video Subtitle Translator Studio** is a Next.js web-based tool designed to translate video speech into Thai subtitles. Powered directly by **Gemini 1.5 / 2.0 Multimodal API**, the system ingests video/audio files, transcribes speech with precise millisecond-level timestamps, translates the text while maintaining context, and presents an interactive subtitle editor alongside a synchronized video player.

---

## 2. Goals & Success Criteria
- **Multimodal AI Efficiency**: Single API pipeline using Gemini File API to generate structured subtitle JSON containing `startTime`, `endTime`, `originalText`, and `translatedText`.
- **Interactive Editing**: Subtitle List Editor synchronized in real-time with an HTML5 Video Player (click to jump, auto-highlight on playback).
- **Flexible Export**: Support for `.srt`, `.vtt` file downloads and client-side canvas-rendered hardsub video export.
- **Sleek UX**: Minimalist, content-focused dark theme aligned with the existing design system.

---

## 3. Architecture & Data Flow

```
[User Video File]
       │ (Instant Blob/ObjectURL)
       ▼
[HTML5 Video Player Ready] ──► [Post to /api/video-translate]
                                            │
                                            ▼
                               [Gemini File Upload API]
                                            │
                                            ▼
                             [Gemini Structured JSON Prompt]
                                            │
                                            ▼
[Populate Interactive Subtitle Editor] ◄────┘
```

### Data Contracts

#### SubtitleItem Model
```typescript
export interface SubtitleItem {
  id: string;
  startTime: number;      // Start time in seconds (e.g. 1.50)
  endTime: number;        // End time in seconds (e.g. 4.20)
  originalText: string;   // Transcribed original text
  translatedText: string; // Translated text (Thai)
}
```

#### API Endpoint (`POST /api/video-translate`)
- **Payload**: `FormData` containing:
  - `file`: Video/Audio File
  - `targetLanguage`: Destination language code (default: `th`)
- **Response**:
```json
{
  "success": true,
  "subtitles": [
    {
      "id": "sub-1",
      "startTime": 1.20,
      "endTime": 3.80,
      "originalText": "Welcome to our video tutorial.",
      "translatedText": "ยินดีต้อนรับสู่สืบทอดบทเรียนวิดีโอของเรา"
    }
  ]
}
```

---

## 4. Component Hierarchy & UI Design

```
src/
├── app/
│   ├── video-translator/
│   │   └── page.tsx              # Main Studio View
│   └── api/
│       └── video-translate/
│           └── route.ts          # Gemini Multimodal API Handler
├── components/
│   └── video-translator/
│       ├── VideoPlayer.tsx       # HTML5 Video with Custom Subtitle Overlay
│       ├── SubtitleEditor.tsx    # Subtitle List with Real-time Editor & Sync
│       ├── SubtitleItemCard.tsx  # Individual Subtitle Row (Time & Text inputs)
│       └── ExportModal.tsx       # SRT/VTT & Hardsub Export Options
└── lib/
    ├── srtFormatter.ts           # SRT/VTT Generation Utilities
    └── geminiVideoService.ts     # Gemini SDK Integration Helpers
```

### UI Features
1. **Video Stage**:
   - Native HTML5 player with custom HTML/CSS Subtitle Overlay positioned on the video frame.
   - Play/Pause, Seek, Time indicator, Playback Speed controls.
2. **Subtitle Editor Stage**:
   - List of `SubtitleItemCard` components.
   - Auto-scrolls and highlights the active item as `video.currentTime` updates.
   - In-place text editing and timestamp adjustments (`startTime` / `endTime`).
   - Action controls: Add (+), Delete (🗑️), Re-sync (⏱️).

---

## 5. Gemini Prompt & Response Schema Strategy

### System Prompt
- Instructs Gemini to act as a **Professional Subtitle Translator & Synchronizer**.
- Constraints: Break long utterances into concise lines (maximum 10-12 words per line) for optimal reading speed.
- Output strictly formatted according to JSON Schema.

### Gemini Response Schema
```json
{
  "type": "ARRAY",
  "items": {
    "type": "OBJECT",
    "properties": {
      "id": { "type": "STRING" },
      "startTime": { "type": "NUMBER" },
      "endTime": { "type": "NUMBER" },
      "originalText": { "type": "STRING" },
      "translatedText": { "type": "STRING" }
    },
    "required": ["id", "startTime", "endTime", "originalText", "translatedText"]
  }
}
```

---

## 6. Export Utilities

1. **SRT File Generation (`srtFormatter.ts`)**:
   - Converts seconds into `HH:MM:SS,mmm` format (`00:01:12,400 --> 00:01:15,800`).
   - Downloads file directly as `subtitles.srt`.
2. **VTT File Generation**:
   - Converts seconds into `HH:MM:SS.mmm` format.
3. **Hardsub Video Export (Client-side Canvas)**:
   - Uses `canvas.drawImage(video)` + text rendering overlaid onto frames.
   - Streamed into `MediaRecorder` to download MP4/WebM with burned-in subtitles.

---

## 7. Error Handling & Edge Cases
- **Large Files**: Upload via `@google/genai` File API for files > 20MB, auto-cleanup remote files after processing.
- **Silent Sections**: Gemini prompt enforces returning no subtitle entries during silent gaps.
- **Local Persistence**: State saved in `localStorage` so user edits are preserved across page refreshes.
