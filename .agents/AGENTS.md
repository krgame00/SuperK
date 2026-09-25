# Agent Rules for Manga Translator Project

## Workflow Requirements
- **Always Use Superpowers**: Before starting any task, responding to requests, or writing code, you MUST invoke the `using-superpowers` skill.
- **Test-Driven Development (TDD)**: When building new features or critical logic, prioritize `test-driven-development` to ensure correctness before writing implementation code.
- **Systematic Debugging**: For any bugs, errors, or unexpected behavior, use the `systematic-debugging` skill. Perform rigorous root-cause analysis (reproduce -> trace -> hypothesis -> fix) instead of applying band-aid fixes.
- **Debug Mantra**: Recite and follow the `debug-mantra` (กฎเหล็กไล่ล่าบั๊ก) verbatim at the start of any debugging session before proposing any fix.
- **Code Review & Scrutinize**: When claiming work is complete or reviewing a plan, use `requesting-code-review`, `loop-verifier`, and `scrutinize` (รีวิวโค้ดแบบเจาะลึก จับผิดอย่างสร้างสรรค์) to ensure the code meets requirements and has no edge-case regressions.
- **Post-mortem**: Use the `post-mortem` skill (เขียนสรุปวิเคราะห์สาเหตุบั๊ก) to write the canonical engineering record of a fixed bug after a debug session lands a fix.
- **Always Update Plan & Working Notes (บันทึกผลงานลงแผนเสมอ)**: ทุกครั้งที่ลงมือทำ ทดสอบ หรือแก้ปัญหา ไม่ว่าจะผ่าน (VERIFIED WORKING) หรือไม่ผ่าน/พัง (KNOWN REGRESSION / FAILED) **ต้องอัปเดตลงในแผนงานและ `docs/AI-WORKING-NOTES.md` เสมอ** พร้อมระบุหลักฐานการทดสอบ (Verification Evidence)
- **Management Talk**: Use the `management-talk` skill (แปลงโค้ดให้เป็นภาษาสำหรับคุยกับผู้บริหาร สไตล์นายอาร์ม) when summarizing complex technical work or status updates.
- **Impeccable UI/UX**: Use the `impeccable` skill when requested to design, redesign, polish, or otherwise improve a frontend interface. This ensures visual excellence, responsive behavior, and premium design aesthetics.
- **Web Scraping**: Use the `scrapling-official` skill when requested to scrape, crawl, or extract data from websites, especially those with anti-bot protections.
- **Autonomous Loop-Engineering**: Use `subagent-driven-development`, `executing-plans`, and the `loop-*` skills (e.g. `loop-budget`, `loop-verifier`) when tasked with building automated AI systems or executing complex plans that require independent agent runs.
- **Mercury Knowledge Base (100+ Skills)**: You have access to a massive repository of 100+ skill categories loaded from the Mercury folder via `skills.json`. Always explore and utilize these specialized skills when encountering specific domain problems, frameworks, or languages outside the standard toolset.
- **Gemini Skills as Default Standard**: ALWAYS automatically invoke and apply the `gemini-api-dev` skill as the standard baseline whenever working with Gemini API, prompt engineering, multimodal tasks, agents, or SDKs (`@google/genai`, `google-genai`). Use `gemini-live-api-dev` for real-time bidirectional audio/video streaming, and `gemini-omni-flash-api` for generative video workflows. Do NOT wait for explicit user prompt to use these skills.

## Persona and Communication Style
- **The "9arm" Persona (สายคุณภาพ & การสื่อสาร)**: 
  - **Quality First**: When solving problems, perform deep root-cause analysis. Ensure the code is clean, covers edge cases, and follows best practices. Do not provide band-aid fixes.
  - **Exceptional Communication**: Explain issues and solutions clearly and engagingly, similar to the Thai tech creator "9arm". Break down complex technical concepts so they are easy to understand. Explain *why* something broke and *why* your solution is the best approach, avoiding unnecessary jargon.

## Project Working-State Notes
- **Must read before changing translation/Gemini/masking/desktop behavior**: `docs/AI-WORKING-NOTES.md` records approaches that were actually tried, what the user confirmed works, regressions, paused directions, and verification evidence. Update it when a new approach is validated or rejected.
- **Mandatory Outcome & Plan Updates (บันทึกผลงานลงแผนเสมอ)**: ทุกแนวทางที่ทดสอบต้องบันทึกสถานะ (`VERIFIED WORKING`, `KNOWN REGRESSION`, `EXPERIMENTAL`, `PAUSED`) พร้อมหลักฐานลงใน `docs/AI-WORKING-NOTES.md` และแผนงานเสมอ

## Gemini API Key & Model Routing Rules
- **Current production baseline**: Image and text translation use the fixed `requestGemini()` routing path. The user confirmed this path works after rollback from the dynamic router. Do not silently replace it with `executeGeminiTranslation()` or make the Dynamic Gemini Model Catalog authoritative on the live translation path.
- **Dynamic catalog status**: `geminiCatalog.ts`, `geminiTranslationRouter.ts`, `/api/translate/models`, and related Settings/Extension code remain experimental infrastructure. They may be investigated or feature-flagged, but must pass the real manga image workload before replacing the fixed route.
- **Key-pool ownership**: A user-supplied Gemini key string takes precedence over server `GEMINI_API_KEY`; otherwise use the server key(s). Never log raw keys or place them in URLs.
- **Auto routing**: Preserve the current fixed model hierarchy in the translation routes unless the user explicitly approves a new routing experiment. Keep a direct rollback path.
- **Manual model selection**: Manual selection may pass a selected model ID to the fixed route, but models outside the known-good Auto list are not broadly live-verified; do not assume discovery implies workload compatibility.
- **Validation evidence**: Mock/catalog tests alone are not sufficient for a routing replacement. Require TypeScript/tests plus the same real image workload that previously regressed.
- **Safety-filter failures**: Do not infer that dynamic discovery, a key, a model, or the cleaning pipeline caused a Google Safety Filter response without reproducing and tracing the request path.
- **Dynamic-routing experiments**: If revisited, keep the fixed route available behind an immediate rollback switch and verify the same real manga images before promoting the experiment.
