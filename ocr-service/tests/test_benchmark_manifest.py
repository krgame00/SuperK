import json
import os
from pathlib import Path

import pytest

from scripts.benchmark import peak_rss_bytes
from scripts.build_benchmark_manifest import anonymized_relative_path_hash

MANIFEST = Path(__file__).parents[1] / "benchmarks" / "manifest.json"
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


def test_manifest_has_30_unique_source_pages() -> None:
    pages = _manifest()["pages"]
    assert isinstance(pages, list)
    assert len(pages) == 30
    assert len({page["sha256"] for page in pages}) == 30
    assert len({page["relative_path_hash"] for page in pages}) == 30


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


@pytest.mark.skipif(os.name != "nt", reason="Windows RSS implementation")
def test_peak_rss_reports_current_process_memory() -> None:
    assert peak_rss_bytes() > 0
