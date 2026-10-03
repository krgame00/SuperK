# P01 dense-page baseline — DONE_WITH_CONCERNS

## Scope and reference

Research baseline of production `applyTranslationOverlay` at reference HEAD `117dd367d269a0de7eb819ff597110cc6aaf5089`. No production renderer changes, provider requests, service restarts, or unrelated document edits. Read P01 issue and parent spec, AGENTS.md, CONTEXT text layout/selection/width reflow terms, October 2 overlay drag performance spec, and existing Vite/Electron tight-selection harness. Next local TypeScript guide read before adding fixture code.

**Hardware/browser limitation:** Windows 10.0.26200, AMD Ryzen 5 5600G, 12 logical CPUs, 31.87 GiB RAM; Electron 44.2.0 / Chromium 152.0.7977.76, DPR 1. Hidden offscreen 1800×2600 window with background throttling disabled. GPU report lists NVIDIA RTX 5050 but all devices inactive, GL/ANGLE none; this is offscreen CPU/raster diagnostic evidence, not proof of smoothness in the user's visible GPU browser. G06 should validate that interactive path. Some shared focused checks ran during the plain pass; ordinary workstation contention is not controlled.

## Reproduction and metrics

Run `node scripts/verify-dense-page-baseline.mjs` for plain timing and `node scripts/verify-dense-page-baseline.mjs --diagnostic` for separately instrumented Chromium trace; then `node scripts/summarize-dense-page-baseline.mjs`. These start only their own temporary Vite listener on 127.0.0.1:4178 and hidden Electron; close both afterward.

36 scenes: 1000×1400 and 1600×2400 pages × 10/50/100 text points × 44%/100% zoom × move/corner-scale/width. Every point uses multiline Thai, outline and standard shadow. Selected text contains four long Thai sentences, wraps to additional lines, 26px target font, 320×460 opening layout at (100,300); neighbors have three lines and 14px target. Scenes contain all requested point counts in the renderer; at44% entire page fits viewport, at100% both fit the1800×2600 viewport. Some neighbors overlap the selected text intentionally. Each scene starts fresh.

Select first point, use actual renderer chrome handle, dispatch pointerdown, then60 frame-paced pointermoves from opening coordinate to +60 page pixels horizontally. Move adds +30 vertically; corner adds −60 vertically; width preserves vertical coordinate. Release at last preview input. Capture APIs are stubbed because dispatched synthetic pointer events do not establish native capture; the actual renderer's handlers, layout, canvas and DOM run in Chromium. This is the prior browser harness interaction seam, not mocked rendering or native hardware input.

Frame distributions are60 rAF timestamp intervals per scene (p50 lower median, p95 nearest rank, max). Missed60Hz slots = sum(max(0,round(interval/16.6667)−1)); this is a frame opportunity estimate, not display presentation telemetry. Input-to-preview latency is dispatch-to-completion of the renderer's queued rAF followed by geometry read. Callback ordering ensures renderer preview executes before the measurement callback. This is DOM preview completion, **not input-to-photon/compositor presentation latency**. Two-rAF release metric records settling opportunity, not asynchronous IndexedDB durability. Release-handler wall time is recorded separately.

Full36-row p50/p95/max, missed frames, latency and release timing: `P01-metrics.md`. Raw compact timing/call artifacts: `P01-baseline.json`, `P01-diagnostic.json`; Chromium phase costs: `P01-trace-summary.json`. Raw126MB trace `P01-diagnostic-trace.json` remains local and is intentionally not committed; regenerate via diagnostic command. `durationMs` in raw rows includes release settling; metrics table subtracts releaseToSecondFrameMs to obtain drag duration.

Key plain-pass results:

- Move: p50≈16.7ms, p95≤16.8ms,0 missed slots in all12 scenes; latency p95 17.5–18.8ms; release handler2.5–4.2ms.
- Corner: 100-point1600×2400 at44% frame p95/max33.4/33.4ms,13 missed slots; latency p50/p95/max19.4/29.6/33.1ms. At100%, p95/max33.3/33.4ms,8 misses; latency18.7/27.9/30.0ms. Smaller scenes have0–2 misses. Release handlers6.2–17.1ms.
- Width: p95 frame50.0–66.7ms,34–62 missed slots per60 inputs; max reaches100.0ms. Dense1600×2400 at44% latency38.0/58.0/63.6ms; at100%37.5/61.5/69.0ms. Release handler40.6–56.9ms; release-to-second-rAF51.7–94.0ms.

## Evidence and optimization targets

Instrumentation is separated from plain timing; wrapper call counts identify executed work, elapsed times include wrapper overhead and nested browser work. Chromium trace phases include only renderer main-thread complete events fully inside user-timing drag/release bounds. Nested event totals must not be added together as an exclusive CPU breakdown. Initial scene construction is excluded. No claim that any one method explains all raster cost.

1600×2400/100/44% diagnostic drag evidence:

| Gesture | measureText calls / totalms | getBoundingClientRect calls / totalms | Main-thread Layout calls / totalms | Layerize totalms |
|---|---:|---:|---:|---:|
| Move |0 /0 |304 /177.7 |120 /152.1 |405.2 |
| Corner |54,333 /59.6 |664 /404.7 |240 /357.6 |399.0 |
| Width |553,794 /645.3 |544 /366.1 |182 /330.9 |504.6 |

Move draws/measures zero glyphs continuously, confirming October2 bitmap reuse is present. Corner still renders once per preview (627 fill/stroke line calls over60inputs), resets its canvas and remeasures layout; source `applyPointerMove` calls renderBubble then pinScaleAnchor, while renderBubble updates frame both before and after selection-bounds measurement. Chrome positioning reads root/wrapper/stage geometry after style changes. Correlated real Layout events and rectangle-read wall times support eliminating repeated geometry write/read cycles and avoiding corner re-typesetting with bitmap previews; counts alone do not prove the whole wall time cause. Trace Layerize also remains substantial and requires later same-harness comparison.

Width source computes `layoutBubbleAtFixedFont` in applyPointerMove then calls renderBubble, which computes it again. Width geometry also repeatedly calculates the minimum whole-word width. The measured553,794 measureText calls and645ms method time support reusing per-text/font word measurements and passing a computed layout through the draw path while preserving visible live reflow. Width FireAnimationFrame max75.4ms confirms actual long callback work beyond count instrumentation. This is a concrete reflow target; move does not show the old per-pointer repaint defect.

No setItem or getImageData calls during any diagnostic continuous gesture. Each release has one storage write and one image read; in the100-point44% width release setItem≈0ms/getImageData0.8ms, versus64.5ms trace EventDispatch and21,398 measureText calls/19.7ms. Release re-layout is a measured contributor; do not blame persistence for the continuous stutter. Parent autosave callback is intentionally empty to isolate overlay renderer; application React/autosave overhead is unmeasured. Diagnostic GC is present but small relative to width callback work (35.8ms MinorGC and12.9ms MajorGC over3.35s), so there is no evidence here that GC is the primary cause.

## Verification, commands and TDD

This research slice adds no behavior; no artificial RED test or production bugfix TDD claim. Used verification-before-completion skill and checked actual command output.

- `C:\Program Files\nodejs\node.exe scripts/verify-dense-page-baseline.mjs` — exit0, `Baseline: true36 scenes`, saved plain results.
- Same command `--diagnostic` — exit0, true36 scenes and real Chromium trace.
- `node scripts/summarize-dense-page-baseline.mjs` — exit0, wrote36-row metrics and72 phase summaries.
- `node node_modules/vitest/vitest.mjs run tests/cleaning/translationOverlay.test.ts --root . --maxWorkers1` — exit0,1 file/93 tests passed,6.81s. Actual shell arguments include spaces (`--maxWorkers 1`). Root owns final full suite.
- `node node_modules/eslint/bin/eslint.js tests/browser/dense-page-baseline.ts tests/browser/dense-page-baseline-electron.cjs scripts/verify-dense-page-baseline.mjs` — exit0, no output.
- `node node_modules/typescript/bin/tsc --noEmit` — initially exit1, four TS2339 errors in concurrently authored `tests/translation/sourceSizePreparation.test.ts` (status/evidence/fallbackLabel on{}); none in P01 files. Reported to root/owning slice; root final typecheck covers resolution.
- Existing `node scripts/verify-tight-selection.mjs` diagnostic launch check — existing45s timeout after14 of16 logged scenarios, no observed assertion failure; this is not a passing acceptance run.

Launch investigation: original Electron benchmark passed an absolute output JSON path as extra positional argument and exited1 before main readiness with no output (both sandbox/escalated). URL-only launch reached main; moving output/trace configuration to child environment fixed it. Successful baseline/diagnostic runs used approved escalation for hidden Electron. No service restarts. Large trace uncommitted; compact results and reusable fixture committed with explicit paths only. Commit recorded below by final report update.

## Remaining concerns

Single measured pass per scene, software/offscreen raster, no compositor input-to-photon telemetry, no real mouse device, no app-level persistence completion or application autosave measurements. These limits do not invalidate the observed renderer costs; they constrain claims about visible user smoothness. P02/P03 should compare identical scenes after optimization, and G06 should test visible GPU editing, exact release geometry/line structure, Undo/Redo, reopening and export parity.

## Commits and named comparison runs

Baseline fixture and compact evidence commit: `26faee2` (`test: capture dense-page renderer baseline`). Follow-up adds optional `--name p02` (or `p03`) to **all three commands**. This writes `P01-p02-baseline.json`, `P01-p02-diagnostic.json`, `P01-p02-diagnostic-trace.json`, `P01-p02-metrics.md` and `P01-p02-trace-summary.json`, preserving the original P01 files. Output stays in the Electron child environment. Named file routing is a reversible launcher option; final ESLint checks both scripts. Example: `node scripts/verify-dense-page-baseline.mjs --name p02`, then same with `--diagnostic`, then `node scripts/summarize-dense-page-baseline.mjs --name p02`.
