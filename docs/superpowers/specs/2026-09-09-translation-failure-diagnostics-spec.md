# Granular Translation Failure Diagnostics and Automatic Environment Forwarding Specification

**Triage:** `ready-for-agent`

## Problem Statement

When translators run batch translation across manga pages and translation fails on one or more pages, the application currently displays an opaque summary message:
`⚠️ แปลเสร็จ แต่หน้า 1, 2, 3... ต้องลองใหม่`

This feedback lacks essential diagnostic context:
1. Translators cannot tell **why** the pages failed — whether due to a missing API key, rate limiting (HTTP 429 quota exhaustion), cloud safety/NSFW policy blocks, a disconnected local neural cleaner, or network timeouts.
2. Translators are given no direct path to resolution; they must guess whether to wait, edit settings, restart processes, or adjust bypass modes.
3. In the standalone Windows desktop application, the embedded Next.js server does not automatically inherit environment variables from the user's `.env.local` file on disk, silently producing a missing API key state even when valid keys exist.
4. Pages on the filmstrip exhibit no visual status indicating which specific pages failed and why, forcing translators to blindly click through every page to check translation outcomes.

## Solution

Implement an end-to-end Granular Translation Failure Diagnostic system paired with an Actionable Resolution Prompt and Desktop Environment Auto-Forwarding:

1. **Failure Classification Taxonomy**:
   Standardize translation errors into five explicit, actionable categories:
   - `MISSING_KEY`: Neither server nor client provided a Gemini API Key.
   - `QUOTA_EXHAUSTED`: Google Gemini quota exceeded (429 Rate Limit) across all configured keys and fallback models.
   - `SAFETY_BLOCKED`: Prompt or response was blocked by upstream safety filters (e.g. NSFW, violent, or explicit content flags).
   - `LOCAL_SIDECAR_OFFLINE`: Local Python cleaning and OCR engine (:8765) is unresponsive or crashed.
   - `NETWORK_OR_TIMEOUT`: Network connection interrupted or request timed out.

2. **Diagnostic Error Modal & Action Matrix**:
   When batch translation finishes with failed pages, open an informative diagnostic modal that groups failed pages by root cause, clearly explains the issue in Thai, and provides one-click action buttons:
   - For `MISSING_KEY`: Button to open Settings modal directly focused on the API Key input field.
   - For `QUOTA_EXHAUSTED`: Countdown timer until quota cooldown, with suggestions to configure multi-key rotation.
   - For `SAFETY_BLOCKED`: Button to enable NSFW / Comic Slicing Bypass mode and immediately re-translate the blocked pages.
   - For `LOCAL_SIDECAR_OFFLINE`: Button to trigger cleaner restart and check port status.
   - For `NETWORK_OR_TIMEOUT`: Immediate "Retry Failed Pages" action button.

3. **Per-Page Filmstrip Diagnostic Badges**:
   Display warning badges directly on page thumbnails in the filmstrip for any page awaiting review due to failure, with tooltip explanations of the failure reason.

4. **Desktop Environment Auto-Forwarding**:
   Enhance Electron's `WorkspaceServerSupervisor` and main launcher to parse `.env.local` / `.env` from the project directory (or user data directory) and inject `GEMINI_API_KEY` directly into the child Next.js process environment on startup.

## User Stories

1. As a manga translator, I want to immediately know why a page failed to translate (e.g. "ไม่มี API Key" or "ติด Safety 18+"), so that I don't waste time guessing the root cause.
2. As a manga translator, I want a single click on a "ตั้งค่า API Key" button when my key is missing, so that I am taken directly to the key configuration input without searching through menus.
3. As a manga translator, I want clear feedback when Gemini returns a 429 quota error, so that I know how long to wait or whether to switch API keys.
4. As a manga translator translating mature manga, I want the system to detect when pages are blocked by safety filters and offer a one-click "เปิดโหมดบายพาส (NSFW Bypass) แล้วแปลใหม่", so that my workflow is not interrupted.
5. As a manga translator, I want to see which specific pages failed on the thumbnail filmstrip, so that I can visually identify problematic pages at a glance.
6. As a manga translator using the Windows Desktop application, I want my `.env.local` API keys to be automatically loaded by the application, so that I don't have to copy-paste keys manually every session.
7. As a manga translator, I want a "ลองแปลใหม่เฉพาะหน้าที่ไม่ผ่าน" (Retry Failed Pages) button, so that I don't have to re-translate already completed pages.
8. As a manga translator, I want clear Thai diagnostic messages with helpful tips, so that technical errors are easy to understand and solve.

## Implementation Decisions

### 1. Diagnostic Taxonomy & Error Normalization
- Refactor translation error handling to produce a structured diagnostic payload containing:
  - `code`: One of `MISSING_KEY`, `QUOTA_EXHAUSTED`, `SAFETY_BLOCKED`, `LOCAL_SIDECAR_OFFLINE`, `NETWORK_OR_TIMEOUT`, or `UNKNOWN`.
  - `title`: User-friendly Thai summary title.
  - `description`: Detailed explanation of the error.
  - `action`: Prescribed recovery action identifier.
  - `pages`: Array of 1-based page numbers affected.
- Translate API route responses (400, 401, 403, 413, 429, 500, 503) will return structured error codes in addition to raw error text.

### 2. UI Components & Workflow Integration
- Build a dedicated `TranslationDiagnosticModal` component invoked automatically when batch translation finishes with failures.
- Add error badge indicators to `PageFilmstrip` thumbnails for pages listed in `batchFailures`.
- Wire modal actions directly to workspace state functions: opening Settings modal, toggling `nsfwBypassMode`, and triggering `retryFailedPages`.

### 3. Desktop Environment Loading
- In `electron/workspaceServer.js`, inspect for `.env.local` and `.env` in `projectRoot`.
- Parse simple `KEY=VALUE` pairs using a lightweight, robust parser (handling quotes and whitespace) and merge into `env` before spawning the Next.js process.
- Ensure that `GEMINI_API_KEY` and translation endpoint overrides are properly passed to Next.js in both development and packaged standalone mode.

## Testing Decisions

- **Seam**: Test via external observable React hook behavior (`useTranslation`), API route contract verification (`/api/translate`), and Electron workspace server supervisor tests.
- **Unit Tests**:
  - Verify that `MISSING_KEY` error status triggers the appropriate diagnostic classification and action payload.
  - Verify that upstream 429 rate limits produce `QUOTA_EXHAUSTED` with retry guidance.
  - Verify that safety blocks produce `SAFETY_BLOCKED` with NSFW bypass recommendations.
  - Verify that `workspaceServer` properly parses `.env.local` files and injects them into process environment options.
- **Prior Art**: Follows patterns established in `tests/translation/useTranslation.test.tsx`, `tests/translation/routes.test.ts`, and `tests/desktop/workspaceServer.test.ts`.

## Out of Scope

- Modifying upstream Google Gemini safety classifiers or creating external reverse proxies.
- Replacing the core translation prompt or altering speech bubble font styling logic.

## Further Notes

All user-facing copy will be in natural, polite Thai consistent with the "9arm" style, making complex technical errors intuitive and empowering the user with immediate solutions.
