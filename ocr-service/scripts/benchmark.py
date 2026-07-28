from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import statistics
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

import cv2
import numpy as np
from PIL import Image

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.cleaners.anime_lama import AnimeLamaCleaner
from app.cleaners.aot import AotCleaner
from app.cleaners.flat import FlatCleaner, GradientCleaner
from app.detector import TextDetector
from app.model_store import ModelStore
from app.pipeline import CleaningPipeline, PipelineOutput
from app.residual_probe import CompositeResidualProbe
from app.schemas import (
    AutomaticAction,
    CleanerRoute,
    RegionStatus,
)
from scripts.build_benchmark_manifest import (
    IMAGE_SUFFIXES,
    anonymized_relative_path_hash,
    sha256_file,
)


def build_pipeline(service_root: Path, cleaner_name: str) -> CleaningPipeline:
    model_store = ModelStore.from_manifest(
        service_root / "models",
        service_root / "models" / "manifest.json",
    )
    detector = TextDetector(model_store)
    aot = AotCleaner(model_store)
    artwork = (
        AnimeLamaCleaner.from_model_store(model_store)
        if cleaner_name == "anime-lama"
        else aot
    )
    return CleaningPipeline(
        detector=detector,
        cleaners={
            CleanerRoute.FLAT: FlatCleaner(),
            CleanerRoute.GRADIENT: GradientCleaner(),
            CleanerRoute.ARTWORK: artwork,
            "aot": aot,
            cleaner_name: artwork,
        },
        residual_probe=CompositeResidualProbe(detector),
    )


def resolve_manifest_pages(
    root: Path,
    manifest: dict[str, Any],
) -> list[tuple[Path, dict[str, Any]]]:
    wanted = {
        page["relative_path_hash"]: page
        for page in manifest["pages"]
    }
    resolved: dict[str, Path] = {}
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        relative_hash = anonymized_relative_path_hash(path, root)
        if relative_hash in wanted:
            resolved[relative_hash] = path
    missing = sorted(set(wanted) - set(resolved))
    if missing:
        raise RuntimeError(f"unable to resolve {len(missing)} manifest pages")
    pages = [(resolved[key], page) for key, page in wanted.items()]
    for path, page in pages:
        if sha256_file(path) != page["sha256"]:
            raise RuntimeError(
                f"content hash changed for {page['relative_path_hash']}",
            )
    return pages


def load_rgb(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"), dtype=np.uint8)


def count_unattempted_detected_regions(output: PipelineOutput) -> int:
    count = 0
    for region in output.regions:
        if region.automatic_action is AutomaticAction.CLEAN:
            continue
        rect = region.rect
        protected = output.protected_mask[
            rect.y : rect.y + rect.height,
            rect.x : rect.x + rect.width,
        ]
        if not np.any(protected):
            count += 1
    return count


def measure_page(
    pipeline: CleaningPipeline,
    path: Path,
    metadata: dict[str, Any],
    visual_hashes: set[str] | None = None,
    visual_output_dir: Path | None = None,
) -> dict[str, Any]:
    image = load_rgb(path)
    started = perf_counter()
    output = pipeline.run(image)
    if (
        visual_hashes is not None
        and visual_output_dir is not None
        and metadata["sha256"] in visual_hashes
    ):
        render_visual_artifact(
            image,
            output,
            metadata["sha256"],
            visual_output_dir,
        )
    pipeline_elapsed = round((perf_counter() - started) * 1000)
    encode_started = perf_counter()
    encoded, _ = cv2.imencode(
        ".png",
        cv2.cvtColor(output.clean_image, cv2.COLOR_RGB2BGR),
    )
    if not encoded:
        raise RuntimeError("failed to encode benchmark output")
    encode_ms = round((perf_counter() - encode_started) * 1000)
    timings = dict(output.timings_ms)
    timings["encode"] = encode_ms
    timings["total"] = pipeline_elapsed + encode_ms

    changed = np.any(image != output.clean_image, axis=2)
    support = cv2.dilate(
        (output.mask > 0).astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
    ) > 0
    changed_outside_support = int(np.count_nonzero(changed & ~support))
    route_counts = Counter(region.route.value for region in output.regions)
    repaired = sum(
        region.status is RegionStatus.REPAIRED
        and region.automatic_action is AutomaticAction.CLEAN
        for region in output.regions
    )
    eligible_regions = sum(
        region.automatic_action is AutomaticAction.CLEAN
        for region in output.regions
    )
    residual_pass = sum(
        region.residual_score <= 0.18
        for region in output.regions
        if region.automatic_action is AutomaticAction.CLEAN
    )
    region_count = len(output.regions)
    is_text_free = region_count == 0

    return {
        "relative_path_hash": metadata["relative_path_hash"],
        "sha256": metadata["sha256"],
        "categories": metadata["categories"],
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        "timings_ms": timings,
        "region_count": region_count,
        "route_counts": dict(route_counts),
        "eligible_region_count": eligible_regions,
        "unattempted_detected_region_count": (
            count_unattempted_detected_regions(output)
        ),
        "residual_pass_rate": _ratio(residual_pass, eligible_regions),
        "automatic_region_pass_rate": _ratio(repaired, eligible_regions),
        "needs_review_rate": (
            0.0
            if region_count == 0
            else _ratio(region_count - eligible_regions, region_count)
        ),
        "changed_pixels_outside_support": changed_outside_support,
        "changed_pixels_inside_protected": int(
            np.count_nonzero(changed & (output.protected_mask > 0)),
        ),
        "text_free_pixel_identical": (
            bool(np.array_equal(image, output.clean_image))
            if is_text_free
            else None
        ),
        "peak_rss_mb": round(peak_rss_bytes() / (1024 * 1024), 1),
    }


def measure_protected_page(
    pipeline: CleaningPipeline,
    path: Path,
    metadata: dict[str, Any],
    visual_hashes: set[str] | None = None,
    visual_output_dir: Path | None = None,
) -> dict[str, Any]:
    image = load_rgb(path)
    output = pipeline.run(image)
    if (
        visual_hashes is not None
        and visual_output_dir is not None
        and metadata["sha256"] in visual_hashes
    ):
        render_visual_artifact(
            image,
            output,
            metadata["sha256"],
            visual_output_dir,
        )
    changed = np.any(image != output.clean_image, axis=2)
    categories = metadata["protection_categories"]
    page_identity_required = bool(
        {"credits", "ui"} & set(categories),
    )
    return {
        "relative_path_hash": metadata["relative_path_hash"],
        "sha256": metadata["sha256"],
        "protection_categories": categories,
        "changed_pixels_inside_protected": int(
            np.count_nonzero(changed & (output.protected_mask > 0)),
        ),
        "page_pixel_identical": (
            bool(np.array_equal(image, output.clean_image))
            if page_identity_required
            else None
        ),
    }


def rectangular_patch_score(
    original: np.ndarray,
    cleaned: np.ndarray,
) -> dict[str, float | bool]:
    changed = np.any(original != cleaned, axis=2).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(changed, 8)
    page_area = changed.shape[0] * changed.shape[1]
    worst_fill = 0.0
    worst_area_ratio = 0.0
    failed = False
    for component_id in range(1, count):
        area = int(stats[component_id, cv2.CC_STAT_AREA])
        width = int(stats[component_id, cv2.CC_STAT_WIDTH])
        height = int(stats[component_id, cv2.CC_STAT_HEIGHT])
        fill = area / max(width * height, 1)
        area_ratio = area / max(page_area, 1)
        worst_fill = max(worst_fill, fill)
        worst_area_ratio = max(worst_area_ratio, area_ratio)
        failed |= fill >= 0.85 and area_ratio > 0.01
    return {
        "failed": failed,
        "max_fill_ratio": round(worst_fill, 6),
        "max_area_ratio": round(worst_area_ratio, 6),
    }


def measure_regression(
    pipeline: CleaningPipeline,
    path: Path,
) -> dict[str, Any]:
    image = load_rgb(path)
    output = pipeline.run(image)
    score = rectangular_patch_score(image, output.clean_image)
    return {
        "source_hash": sha256_file(path),
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        **score,
    }


def aggregate(
    pages: list[dict[str, Any]],
    regressions: list[dict[str, Any]],
    protected_pages: list[dict[str, Any]],
    visual_gate: dict[str, Any],
) -> dict[str, Any]:
    totals = [page["timings_ms"]["total"] for page in pages]
    total_regions = sum(page["region_count"] for page in pages)
    residual_passes = sum(
        round(
            page["residual_pass_rate"]
            * page["eligible_region_count"],
        )
        for page in pages
    )
    automatic_passes = sum(
        round(
            page["automatic_region_pass_rate"]
            * page["eligible_region_count"],
        )
        for page in pages
    )
    total_eligible_regions = sum(
        page["eligible_region_count"] for page in pages
    )
    text_free = [
        page["text_free_pixel_identical"]
        for page in pages
        if page["text_free_pixel_identical"] is not None
    ]
    summary = {
        "median_total_ms": round(statistics.median(totals)),
        "p95_total_ms": round(_percentile(totals, 0.95)),
        "residual_pass_rate": _ratio(
            residual_passes,
            total_eligible_regions,
        ),
        "automatic_region_pass_rate": _ratio(
            automatic_passes,
            total_eligible_regions,
        ),
        "needs_review_rate": _ratio(
            total_regions - automatic_passes,
            total_regions,
        ),
        "unattempted_detected_region_count": sum(
            page["unattempted_detected_region_count"]
            for page in pages
        ),
        "changed_pixels_outside_support": sum(
            page["changed_pixels_outside_support"] for page in pages
        ),
        "changed_pixels_inside_protected": sum(
            page["changed_pixels_inside_protected"] for page in pages
        )
        + sum(
            page["changed_pixels_inside_protected"]
            for page in protected_pages
        ),
        "text_free_pages_pixel_identical": all(text_free),
        "rectangular_patch_regressions_pass": not any(
            item["failed"] for item in regressions
        ),
        "peak_rss_mb": max(page["peak_rss_mb"] for page in pages),
        "visual_review_pass": visual_gate["passed"],
    }
    summary["passed"] = bool(
        summary["median_total_ms"] <= 30_000
        and summary["residual_pass_rate"] >= 0.95
        and summary["automatic_region_pass_rate"] >= 0.90
        and summary["unattempted_detected_region_count"] == 0
        and summary["changed_pixels_outside_support"] == 0
        and summary["changed_pixels_inside_protected"] == 0
        and summary["text_free_pages_pixel_identical"]
        and summary["rectangular_patch_regressions_pass"]
        and summary["visual_review_pass"]
    )
    return summary


def peak_rss_bytes() -> int:
    if os.name != "nt":
        try:
            import resource

            return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024)
        except (ImportError, AttributeError):
            return 0

    class ProcessMemoryCounters(ctypes.Structure):
        _fields_ = [
            ("cb", ctypes.c_ulong),
            ("PageFaultCount", ctypes.c_ulong),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    counters = ProcessMemoryCounters()
    counters.cb = ctypes.sizeof(counters)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ProcessMemoryCounters),
        ctypes.c_ulong,
    ]
    psapi.GetProcessMemoryInfo.restype = ctypes.c_int
    process = kernel32.GetCurrentProcess()
    ok = psapi.GetProcessMemoryInfo(
        process,
        ctypes.byref(counters),
        counters.cb,
    )
    return int(counters.PeakWorkingSetSize) if ok else 0


def markdown_report(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# SuperK cleaning benchmark",
        "",
        f"- Cleaner: `{report['cleaner']}`",
        f"- Corpus pages: {len(report['pages'])}",
        f"- Median: {summary['median_total_ms']} ms",
        f"- p95: {summary['p95_total_ms']} ms",
        f"- Residual pass: {summary['residual_pass_rate']:.1%}",
        (
            f"- Automatic region pass: "
            f"{summary['automatic_region_pass_rate']:.1%}"
        ),
        (
            f"- Unattempted detector regions: "
            f"{summary['unattempted_detected_region_count']}"
        ),
        (
            f"- Changed pixels outside support: "
            f"{summary['changed_pixels_outside_support']}"
        ),
        (
            f"- Changed pixels inside protected: "
            f"{summary['changed_pixels_inside_protected']}"
        ),
        f"- Visual review: {summary['visual_review_pass']}",
        f"- Peak RSS: {summary['peak_rss_mb']:.1f} MB",
        f"- Acceptance: {'PASS' if summary['passed'] else 'FAIL'}",
        "",
        "| Page hash | Total ms | Regions | Residual | Auto pass | Review |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for page in report["pages"]:
        lines.append(
            f"| `{page['relative_path_hash'][:12]}` "
            f"| {page['timings_ms']['total']} "
            f"| {page['region_count']} "
            f"| {page['residual_pass_rate']:.1%} "
            f"| {page['automatic_region_pass_rate']:.1%} "
            f"| {page['needs_review_rate']:.1%} |",
        )
    return "\n".join(lines) + "\n"


def _ratio(numerator: int, denominator: int) -> float:
    return 1.0 if denominator == 0 else numerator / denominator


def _percentile(values: list[int], quantile: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    position = (len(ordered) - 1) * quantile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def visual_review_gate(document: dict[str, Any]) -> dict[str, Any]:
    passed = [
        item for item in document["pages"] if item["decision"] == "pass"
    ]
    categories = Counter(
        category for item in passed for category in item["categories"]
    )
    required = ("dialogue", "narration", "sfx", "protected-heavy")
    return {
        "passed": len(passed) >= 12
        and all(categories[category] >= 3 for category in required),
        "passed_pages": len(passed),
        "categories": dict(categories),
    }


def render_visual_artifact(
    image: np.ndarray,
    output,
    source_hash: str,
    output_dir: Path,
) -> None:
    height = 360
    width = max(1, round(image.shape[1] * height / image.shape[0]))
    original = cv2.resize(image, (width, height))
    clean = cv2.resize(output.clean_image, (width, height))
    eligible = cv2.resize(
        output.mask,
        (width, height),
        interpolation=cv2.INTER_NEAREST,
    )
    protected = cv2.resize(
        output.protected_mask,
        (width, height),
        interpolation=cv2.INTER_NEAREST,
    )
    eligible_rgb = np.zeros_like(original)
    eligible_rgb[eligible > 0] = (255, 55, 80)
    protected_rgb = np.zeros_like(original)
    protected_rgb[protected > 0] = (45, 145, 255)
    difference = np.clip(
        np.abs(clean.astype(np.int16) - original.astype(np.int16)) * 5,
        0,
        255,
    ).astype(np.uint8)
    sheet = np.concatenate(
        (original, clean, eligible_rgb, protected_rgb, difference),
        axis=1,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet).save(
        output_dir / f"{source_hash[:12]}.jpg",
        quality=92,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--protected-manifest", type=Path, required=True)
    parser.add_argument("--visual-review", type=Path, required=True)
    parser.add_argument("--cleaner", choices=("aot", "anime-lama"), default="aot")
    parser.add_argument(
        "--regression-page",
        type=Path,
        action="append",
        default=[],
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("benchmark-results"),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    pages = resolve_manifest_pages(args.root.resolve(), manifest)
    protected_manifest = json.loads(
        args.protected_manifest.read_text(encoding="utf-8"),
    )
    protected_pages = resolve_manifest_pages(
        args.root.resolve(),
        protected_manifest,
    )
    visual_review = json.loads(
        args.visual_review.read_text(encoding="utf-8"),
    )
    pipeline = build_pipeline(SERVICE_ROOT, args.cleaner)

    warmup_image = load_rgb(pages[0][0])
    print("Warmup 1/1", flush=True)
    pipeline.run(warmup_image)

    page_reports: list[dict[str, Any]] = []
    visual_hashes = {
        item["sha256"] for item in visual_review["pages"]
    }
    for index, (path, metadata) in enumerate(pages, start=1):
        print(f"Benchmark {index}/{len(pages)}", flush=True)
        page_reports.append(
            measure_page(
                pipeline,
                path,
                metadata,
                visual_hashes,
                args.output_dir / "visual",
            ),
        )
    protected_reports = []
    for path, metadata in protected_pages:
        protected_reports.append(
            measure_protected_page(
                pipeline,
                path,
                metadata,
                visual_hashes,
                args.output_dir / "visual",
            ),
        )
    regression_reports = [
        measure_regression(pipeline, path.resolve())
        for path in args.regression_page
    ]
    visual_gate = visual_review_gate(visual_review)
    summary = aggregate(
        page_reports,
        regression_reports,
        protected_reports,
        visual_gate,
    )
    report = {
        "version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "cleaner": args.cleaner,
        "manifest_sha256": hashlib.sha256(
            args.manifest.read_bytes(),
        ).hexdigest(),
        "pages": page_reports,
        "regressions": regression_reports,
        "protected_pages": protected_reports,
        "visual_gate": visual_gate,
        "summary": summary,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.output_dir / f"latest-{args.cleaner}.json"
    markdown_path = args.output_dir / f"latest-{args.cleaner}.md"
    json_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    markdown_path.write_text(markdown_report(report), encoding="utf-8")
    print(markdown_report(report))
    raise SystemExit(0 if summary["passed"] else 1)


if __name__ == "__main__":
    main()
