import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from app.pipeline import PipelineOutput
from app.schemas import (
    AutomaticAction,
    CleanerRoute,
    PageRole,
    PixelRect,
    ProtectionReason,
    RegionRecord,
    RegionStatus,
    TextRole,
)
from scripts.benchmark import (
    aggregate,
    count_preserved_sfx_regions,
    count_unexpected_unattempted_regions,
    peak_rss_bytes,
)
from scripts.build_benchmark_manifest import (
    anonymized_relative_path_hash,
    should_include_relative_path,
)
from scripts.review_benchmark_corpus import build_review_artifacts

MANIFEST = Path(__file__).parents[1] / "benchmarks" / "manifest.json"
VISUAL_REVIEW = (
    Path(__file__).parents[1] / "benchmarks" / "visual-review.json"
)
REQUIRED_CATEGORIES = {
    "white-bubble",
    "colored-bubble",
    "vertical-japanese",
    "outlined-or-colored-text",
    "artwork-sfx",
    "screentone",
    "complex-color",
    "dense-text",
    "text-free",
}


def _manifest() -> dict[str, object]:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def _benchmark_region(
    region_id: str,
    action: AutomaticAction,
    *,
    x: int = 0,
    role: PageRole = PageRole.COMIC,
    text_role: TextRole = TextRole.REVIEW,
    protection_reasons: list[ProtectionReason] | None = None,
) -> RegionRecord:
    return RegionRecord(
        id=region_id,
        rect=PixelRect(x=x, y=8, width=8, height=8),
        route=CleanerRoute.FLAT,
        confidence=0.8,
        status=RegionStatus.PRESERVED,
        residual_score=0,
        damage_score=0,
        page_role=role,
        text_role=text_role,
        eligibility_confidence=0.5,
        automatic_action=action,
        protection_reasons=protection_reasons or [],
    )


def _benchmark_output(
    regions: list[RegionRecord],
    *,
    protected_slice: tuple[int, int],
) -> PipelineOutput:
    source = np.zeros((32, 32, 3), np.uint8)
    mask = np.zeros((32, 32), np.uint8)
    protected = np.zeros_like(mask)
    protected[8:16, protected_slice[0] : protected_slice[1]] = 255
    return PipelineOutput(
        source_image=source,
        clean_image=source.copy(),
        mask=mask.copy(),
        review_mask=mask.copy(),
        protected_mask=protected,
        regions=regions,
        timings_ms={"total": 1},
    )


def test_policy_metrics_exclude_preserved_sfx_and_hard_protection() -> None:
    output = _benchmark_output(
        [
            _benchmark_region("attempted", AutomaticAction.CLEAN),
            _benchmark_region(
                "unexpected",
                AutomaticAction.PRESERVE,
                x=8,
                role=PageRole.UI,
            ),
            _benchmark_region(
                "sfx",
                AutomaticAction.PRESERVE,
                x=16,
                text_role=TextRole.SFX,
                protection_reasons=[ProtectionReason.SFX_POLICY],
            ),
            _benchmark_region(
                "protected",
                AutomaticAction.PRESERVE,
                x=24,
            ),
        ],
        protected_slice=(24, 32),
    )

    assert count_unexpected_unattempted_regions(output) == 1
    assert count_preserved_sfx_regions(output) == 1


def test_aggregate_does_not_count_preserved_sfx_as_needs_review() -> None:
    page = {
        "timings_ms": {"total": 100},
        "region_count": 2,
        "eligible_region_count": 1,
        "residual_pass_rate": 1.0,
        "automatic_region_pass_rate": 1.0,
        "needs_review_count": 0,
        "unexpected_unattempted_region_count": 0,
        "preserved_sfx_region_count": 1,
        "changed_pixels_outside_support": 0,
        "changed_pixels_inside_protected": 0,
        "text_free_pixel_identical": None,
        "peak_rss_mb": 100.0,
    }

    summary = aggregate(
        [page],
        regressions=[],
        protected_pages=[],
        visual_gate={"passed": True},
    )

    assert summary["needs_review_count"] == 0
    assert summary["needs_review_rate"] == 0
    assert summary["preserved_sfx_region_count"] == 1


def test_manifest_has_30_unique_source_pages() -> None:
    pages = _manifest()["pages"]
    assert isinstance(pages, list)
    assert len(pages) == 30
    assert len({page["sha256"] for page in pages}) == 30
    assert len({page["relative_path_hash"] for page in pages}) == 30
    assert {page["review_label"] for page in pages} == {
        "original_comic",
    }


@pytest.mark.parametrize(
    "relative",
    [
        "[English]/01.webp",
        "[Chinese]/01.webp",
        "[Thai]/01.webp",
        "ภาษาไทย/01.webp",
        "[中国語版]/01.webp",
    ],
)
def test_language_tagged_paths_are_excluded(relative: str) -> None:
    assert should_include_relative_path(Path(relative)) is False


def test_manifest_does_not_store_external_paths_or_language_tags() -> None:
    manifest_text = MANIFEST.read_text(encoding="utf-8")
    assert "F:\\" not in manifest_text
    assert "E:\\" not in manifest_text
    assert "[English]" not in manifest_text
    assert "[Chinese]" not in manifest_text
    assert "[Thai]" not in manifest_text
    assert "ภาษาไทย" not in manifest_text
    assert "[中国語版]" not in manifest_text


def test_manifest_records_dimensions_hashes_and_category_coverage() -> None:
    pages = _manifest()["pages"]
    categories: set[str] = set()
    for page in pages:
        assert len(page["relative_path_hash"]) == 64
        assert len(page["sha256"]) == 64
        assert page["width"] > 0
        assert page["height"] > 0
        assert page["categories"]
        categories.update(page["categories"])
    assert categories == REQUIRED_CATEGORIES


def test_path_hash_accepts_legacy_surrogate_filenames() -> None:
    root = Path("F:/Doujin/Download")
    path = root / "legacy-\udde1" / "01.webp"

    assert len(anonymized_relative_path_hash(path, root)) == 64


def test_review_artifacts_contain_hashes_without_source_paths(
    tmp_path: Path,
) -> None:
    root = tmp_path / "private-corpus"
    root.mkdir()
    from PIL import Image

    Image.new("RGB", (64, 96), "white").save(root / "page.png")
    output = tmp_path / "review"

    build_review_artifacts(root, output, count=1)

    candidates = (output / "candidates.json").read_text(encoding="utf-8")
    assert str(root) not in candidates
    assert "page.png" not in candidates
    payload = json.loads(candidates)
    assert len(payload["candidates"][0]["sha256"]) == 64


def test_review_script_runs_as_a_direct_cli(tmp_path: Path) -> None:
    root = tmp_path / "corpus"
    root.mkdir()
    from PIL import Image

    Image.new("RGB", (64, 96), "white").save(root / "page.png")
    output = tmp_path / "review"

    completed = subprocess.run(
        [
            sys.executable,
            "scripts/review_benchmark_corpus.py",
            "--root",
            str(root),
            "--emit-review-dir",
            str(output),
            "--count",
            "1",
        ],
        cwd=Path(__file__).parents[1],
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr


def test_visual_review_has_required_coverage() -> None:
    visual_review = json.loads(
        VISUAL_REVIEW.read_text(encoding="utf-8"),
    )
    passed = [
        item
        for item in visual_review["pages"]
        if item["decision"] == "pass"
    ]
    assert len(passed) >= 12
    categories = Counter(
        category
        for item in passed
        for category in item["categories"]
    )
    assert categories["dialogue"] >= 3
    assert categories["narration"] >= 3
    assert categories["sfx"] >= 3
    assert categories["protected-heavy"] >= 3


@pytest.mark.skipif(os.name != "nt", reason="Windows RSS implementation")
def test_peak_rss_reports_current_process_memory() -> None:
    assert peak_rss_bytes() > 0
