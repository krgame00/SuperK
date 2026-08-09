# Skip UI Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve UI-like labels during cleaning and exclude them from translation while retaining dialogue, thoughts, and narration without bubbles.

**Architecture:** Add conservative page-role and region-geometry guards to the existing cleaning eligibility classifier. Tighten the existing Gemini image prompt so it requests story-bearing text only; the dual-source Original-to-Clean rendering and cache workflow remains unchanged.

**Tech Stack:** Python 3, OpenCV, NumPy, Pytest, Next.js 16, TypeScript, Vitest, Gemini image route.

## Global Constraints

- Preserve interface-like text that is not part of the story.
- Continue cleaning and translating dialogue, thoughts, and narration, including narration without a speech bubble.
- Preserve HUD elements, menus, button labels, status values, counters, watermarks, credits, and SFX.
- Classification uncertainty favors preserving original pixels.
- Manual mask edits and manual translation bubbles remain explicit overrides.
- Gemini reads Original, accepted translations render on Clean, and cache keys remain Original URLs.
- Do not add a second AI request or a new dependency.

---

## File Map

- Modify `ocr-service/app/text_eligibility.py`: decide when page roles and small low-confidence regions must be preserved.
- Modify `ocr-service/tests/test_text_eligibility.py`: unit coverage for UI, credits, unknown pages, small labels, dialogue, and narration.
- Modify `ocr-service/tests/test_pipeline.py`: integration proof that a UI page remains pixel-identical and bypasses cleaners.
- Modify `src/app/api/translate/route.ts`: remove force-extraction language and explicitly exclude UI-like text.
- Modify `tests/translation/routes.test.ts`: inspect the exact Gemini prompt sent by the image route.

### Task 1: Preserve UI-like regions in cleaning eligibility

**Files:**
- Modify: `ocr-service/app/text_eligibility.py`
- Test: `ocr-service/tests/test_text_eligibility.py`

**Interfaces:**
- Consumes: `PageContext.role`, `MaskRegion.rect`, `EligibilityFeatures`, `PageRole`, `TextRole`, `AutomaticAction`, and `ProtectionReason`.
- Produces: `_looks_like_ui_label(region, image_shape, features) -> bool` and conservative `EligibilityDecision` values consumed by `CleaningPipeline._build_eligibility`.

- [ ] **Step 1: Replace the old every-page-role expectation with failing preservation tests**

Add these cases to `ocr-service/tests/test_text_eligibility.py` and remove `test_unprotected_text_is_attempted_on_every_page_role`:

```python
@pytest.mark.parametrize(
    ("role", "reason"),
    [
        (PageRole.UI, ProtectionReason.UI_PAGE),
        (PageRole.CREDITS, ProtectionReason.CREDIT_PAGE),
        (PageRole.UNKNOWN, ProtectionReason.LOW_CONFIDENCE),
    ],
)
def test_noncomic_page_roles_preserve_detected_text(
    role: PageRole,
    reason: ProtectionReason,
) -> None:
    decision = _classify(
        _features(enclosure=1),
        page=_page(role),
    )

    assert decision.text_role is TextRole.PROTECTED
    assert decision.action is AutomaticAction.PRESERVE
    assert decision.protection_reasons == [reason]
```

Add a helper that supplies a page-relative tiny region, then verify an uncertain tiny comic label is preserved:

```python
def _tiny_region() -> MaskRegion:
    return MaskRegion(
        id="ui-label",
        rect=PixelRect(x=30, y=30, width=10, height=4),
        component_ids=(1,),
        stroke_radius=1,
    )


def test_small_unenclosed_comic_label_is_preserved() -> None:
    image = np.full((100, 100, 3), 255, np.uint8)
    mask = np.zeros((100, 100), np.uint8)
    mask[30:34, 30:40] = 255

    decision = classify_eligibility(
        image,
        mask,
        _tiny_region(),
        _page(PageRole.COMIC),
        _protection(),
        feature_extractor=_extractor(_features()),
    )

    assert decision.text_role is TextRole.PROTECTED
    assert decision.action is AutomaticAction.PRESERVE
    assert decision.protection_reasons == [ProtectionReason.LOW_CONFIDENCE]
```

Keep the existing `test_low_confidence_comic_text_is_attempted_for_review`, `test_enclosed_text_is_automatic_dialogue`, and both narration tests. They are the disproof cases that prevent the new guard from preserving all review text or narration.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run from `ocr-service`:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_text_eligibility.py -q
```

Expected: the three non-comic cases and tiny-label case fail because current code returns `CLEAN`.

- [ ] **Step 3: Implement page-role and relative-geometry guards**

In `ocr-service/app/text_eligibility.py`, import `PageRole` and add constants beside the existing thresholds:

```python
UI_LABEL_MAX_AREA_FRACTION = 0.012
UI_LABEL_MAX_HEIGHT_FRACTION = 0.08
```

Add this helper near `_threshold_decision`:

```python
def _looks_like_ui_label(
    region: MaskRegion,
    image_shape: tuple[int, ...],
    features: EligibilityFeatures,
) -> bool:
    height, width = image_shape[:2]
    rect = region.rect
    area_fraction = (rect.width * rect.height) / max(width * height, 1)
    height_fraction = rect.height / max(height, 1)
    lacks_story_backing = (
        features.enclosure_score < 0.55
        and features.backing_uniformity < 0.55
        and features.rectangular_backing < 0.55
    )
    lacks_sfx_shape = (
        features.artwork_edge_density < 0.35
        and features.stroke_irregularity < 0.35
    )
    return (
        area_fraction <= UI_LABEL_MAX_AREA_FRACTION
        and height_fraction <= UI_LABEL_MAX_HEIGHT_FRACTION
        and lacks_story_backing
        and lacks_sfx_shape
    )
```

Immediately after the protected-mask check, preserve non-comic page roles:

```python
    page_reason = {
        PageRole.UI: ProtectionReason.UI_PAGE,
        PageRole.CREDITS: ProtectionReason.CREDIT_PAGE,
        PageRole.UNKNOWN: ProtectionReason.LOW_CONFIDENCE,
    }.get(page.role)
    if page_reason is not None:
        return _preserve(
            TextRole.PROTECTED,
            page.confidence,
            [page_reason],
            features,
        )
```

In the review-mask branch, preserve only when `_looks_like_ui_label(region, image_rgb.shape, features)` is true; otherwise retain the existing `TextRole.REVIEW` plus `CLEAN` behavior. Before the final low-confidence `TextRole.REVIEW` return, add the same UI-label check and return:

```python
    if _looks_like_ui_label(region, image_rgb.shape, features):
        return _preserve(
            TextRole.PROTECTED,
            float(np.clip(max(narration_score, sfx_score), 0, 1)),
            [ProtectionReason.LOW_CONFIDENCE],
            features,
        )
```

Do not move the confident dialogue, narration, or SFX branches; they must win before the final small-label fallback.

- [ ] **Step 4: Run focused and full eligibility tests and confirm GREEN**

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_text_eligibility.py -q
.\.venv\Scripts\python.exe -m pytest tests/test_page_context.py tests/test_protection.py tests/test_text_eligibility.py -q
```

Expected: all tests pass, including existing bubble-free narration and SFX preservation cases.

- [ ] **Step 5: Commit the eligibility policy**

```powershell
git add ocr-service/app/text_eligibility.py ocr-service/tests/test_text_eligibility.py
git commit -m "fix(cleaning): preserve UI-like text"
```

### Task 2: Prove UI pages bypass cleaning end to end

**Files:**
- Modify: `ocr-service/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `classify_eligibility` from Task 1 and the existing `CleaningPipeline` eligibility callback.
- Produces: integration proof that a UI classification yields original pixels, an empty clean mask, and a preserved region record.

- [ ] **Step 1: Add a failing pipeline regression**

Import `classify_eligibility`, then add this test using the same `MaskRegion`, `RefinedMask`, and `SolidCleaner` fixtures already used in the file:

```python
def test_ui_page_regions_are_not_sent_to_cleaner() -> None:
    source = np.full((32, 32, 3), 100, np.uint8)
    mask = np.zeros((32, 32), np.uint8)
    mask[8:16, 8:16] = 255
    region = MaskRegion(
        id="ui-1",
        rect=PixelRect(x=8, y=8, width=8, height=8),
        component_ids=(1,),
        stroke_radius=2,
    )

    def ui_page(*_args) -> PageContext:
        return PageContext(
            role=PageRole.UI,
            confidence=0.95,
            features=PageFeatures(0.1, 0.1, 0.1, 0.9, 0),
        )

    class FailingCleaner:
        def clean(self, *_args):
            raise AssertionError("UI region reached cleaner")

    pipeline = CleaningPipeline(
        detector=NoTextDetector(),
        refiner=lambda _source, _detection: RefinedMask(
            mask,
            [region],
            np.zeros_like(mask),
        ),
        cleaners={
            "flat": FailingCleaner(),
            "gradient": FailingCleaner(),
            "artwork": FailingCleaner(),
        },
        page_classifier=ui_page,
        protection_detector=_empty_protection,
        eligibility_classifier=classify_eligibility,
    )

    output = pipeline.run(source)

    assert np.array_equal(output.clean_image, source)
    assert not np.any(output.mask)
    assert output.regions[0].status is RegionStatus.PRESERVED
    assert output.regions[0].text_role is TextRole.PROTECTED
    assert output.regions[0].automatic_action is AutomaticAction.PRESERVE
```

- [ ] **Step 2: Run the test and verify it fails before Task 1, or passes only with Task 1 present**

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_pipeline.py::test_ui_page_regions_are_not_sent_to_cleaner -q
```

Expected after Task 1: PASS. To prove the test is meaningful, temporarily replace `PageRole.UI` with `PageRole.COMIC` and confirm the `FailingCleaner` assertion fires, then restore `PageRole.UI`.

- [ ] **Step 3: Run the full cleaning service unit suite**

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q -m "not model"
```

Expected: all non-model OCR service tests pass.

- [ ] **Step 4: Commit the integration regression**

```powershell
git add ocr-service/tests/test_pipeline.py
git commit -m "test(cleaning): protect UI pages"
```

### Task 3: Exclude interface text from Gemini extraction

**Files:**
- Modify: `src/app/api/translate/route.ts`
- Test: `tests/translation/routes.test.ts`

**Interfaces:**
- Consumes: existing `requestGemini({ payload })` and `/api/translate` request/response format.
- Produces: the same API response shape, with a story-only extraction prompt used for normal and enhanced retry calls.

- [ ] **Step 1: Add a failing prompt-contract test**

Append this test to `tests/translation/routes.test.ts`:

```typescript
test("image prompt translates story text and excludes interface labels", async () => {
  process.env.GEMINI_API_KEY = "server-key";
  requestGeminiMock.mockResolvedValue({
    data: {
      candidates: [{
        content: { parts: [{ text: '{"bubbles":[]}' }] },
      }],
    },
    keyIndex: 0,
    model: "test-model",
  });
  const request = new Request("http://localhost/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageBase64: "valid-base64",
      mimeType: "image/png",
      targetLang: "Thai",
    }),
  });

  const response = await translateImage(request);
  expect(response.status).toBe(200);

  const options = requestGeminiMock.mock.calls[0][0];
  const payload = options.payload as {
    contents: Array<{ parts: Array<{ text?: string }> }>;
  };
  const prompt = payload.contents[0].parts[0].text ?? "";

  expect(prompt).toContain("dialogue, thoughts, and narration");
  expect(prompt).toContain("IGNORE interface text");
  expect(prompt).toContain("HUD");
  expect(prompt).toContain("watermarks");
  expect(prompt).toContain("Narration may appear without a speech bubble");
  expect(prompt).not.toContain("MUST include ALL dialogue blocks");
  expect(prompt).not.toContain("Force extraction");
  expect(prompt).not.toContain("large red text");
});
```

- [ ] **Step 2: Run the route test and confirm RED**

```powershell
npx vitest run tests/translation/routes.test.ts --reporter=verbose
```

Expected: assertions for the UI exclusions and removed force-extraction phrases fail.

- [ ] **Step 3: Replace conflicting prompt instructions**

In `src/app/api/translate/route.ts`, retain natural-translation, JSON, coordinate, source-language, and retry instructions. Replace the SFX/background/force-extraction block with these exact directives:

```typescript
      `- Translate ONLY story-bearing dialogue, character thoughts, and narration.\n`+
      `- Narration may appear without a speech bubble; include it when it forms a readable story sentence or caption.\n`+
      `- IGNORE interface text: HUD elements, menus, button labels, character or stat labels, counters, status values, credits, watermarks, and other small scattered labels.\n`+
      `- IGNORE all Sound Effects (SFX). Do NOT translate them.\n`+
      `- DO NOT hallucinate text on textures, leaves, clothing, shading, or backgrounds. If an area does not clearly contain readable story text, ignore it completely.\n`+
```

Keep `Format`, `box`, target-language, and `If no text found` instructions. Delete the lines containing `MUST include ALL dialogue blocks`, `CRITICAL: Force extraction`, and `large red text`. The retry directive may request higher precision for faint dialogue, but must not reintroduce UI, SFX, or arbitrary floating text.

- [ ] **Step 4: Run route and translation workflow tests**

```powershell
npx vitest run tests/translation/routes.test.ts tests/translation/useTranslation.test.tsx tests/translation/useTranslation.imageLateEdges.test.tsx --reporter=dot
```

Expected: all tests pass; response and failure behavior remain unchanged.

- [ ] **Step 5: Commit the prompt policy**

```powershell
git add src/app/api/translate/route.ts tests/translation/routes.test.ts
git commit -m "fix(translation): skip interface text"
```

### Task 4: Full verification and live smoke test

**Files:**
- No production file changes expected.
- Test artifact: one mixed UI/comic image like the approved screenshot and one narration-without-bubble page.

**Interfaces:**
- Consumes: cleaning eligibility from Task 1, pipeline proof from Task 2, and translation prompt from Task 3.
- Produces: release evidence for the existing `codex/superk-hybrid-cleaning` branch.

- [ ] **Step 1: Run all automated suites**

From the repository worktree:

```powershell
npm test -- --reporter=dot
npx tsc --noEmit
npm run build
git diff --check
```

From `ocr-service`:

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q -m "not model"
```

Expected: all commands exit 0.

- [ ] **Step 2: Smoke-test a mixed UI/comic page**

Start `ocr-service\run.ps1` and the feature site on port 3010. Upload the approved problem image or its source page, then press **Translate this page**.

Expected:

- small HUD/status/label text remains identical to Original;
- no Thai overlay is added to those labels;
- any actual dialogue or narration on the page is cleaned and translated;
- Original, Clean, and Translated layers remain selectable.

- [ ] **Step 3: Smoke-test narration without a bubble**

Upload a page containing a standalone story caption and no enclosing speech bubble, then translate the page.

Expected: the caption is cleaned, translated, and rendered; SFX and unrelated UI remain unchanged.

- [ ] **Step 4: Review final scope and status**

```powershell
git status --short
git log -5 --oneline
```

Expected: only the two pre-existing untracked plan artifacts remain outside the task commits; no temporary backups, generated screenshots, or unrelated files are staged.
