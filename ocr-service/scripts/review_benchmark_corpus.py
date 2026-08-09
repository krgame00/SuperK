from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from scripts.build_benchmark_manifest import (
    CATEGORIES,
    Candidate,
    discover,
    select,
    sha256_file,
)

THUMBNAIL_SIZE = (220, 300)
SHEET_COLUMNS = 4
SHEET_ROWS = 5
SHEET_MARGIN = 16
LABEL_HEIGHT = 26


def build_review_artifacts(
    root: Path,
    output_dir: Path,
    *,
    count: int = 80,
) -> None:
    candidates = discover(root)
    selected = _review_selection(candidates, count)
    output_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, object]] = []
    labels: dict[str, str] = {}
    for candidate, category in selected:
        content_hash = sha256_file(candidate.path)
        records.append(
            {
                "sha256": content_hash,
                "width": candidate.width,
                "height": candidate.height,
                "feature_categories": [category],
            },
        )
        labels[content_hash] = "reject"

    (output_dir / "candidates.json").write_text(
        json.dumps(
            {"version": 1, "candidates": records},
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    (output_dir / "labels.template.json").write_text(
        json.dumps(
            {"version": 1, "labels": labels},
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    _write_contact_sheets(selected, output_dir)


def _review_selection(
    candidates: list[Candidate],
    count: int,
) -> list[tuple[Candidate, str]]:
    if count <= 0:
        raise ValueError("count must be positive")
    if len(candidates) <= count:
        return [
            (
                candidate,
                max(CATEGORIES, key=lambda name: candidate.scores[name]),
            )
            for candidate in candidates
        ]
    if count < len(CATEGORIES):
        ranked = sorted(
            candidates,
            key=lambda candidate: max(candidate.scores.values()),
            reverse=True,
        )
        return [
            (
                candidate,
                max(CATEGORIES, key=lambda name: candidate.scores[name]),
            )
            for candidate in ranked[:count]
        ]
    return select(candidates, count)


def _write_contact_sheets(
    selected: list[tuple[Candidate, str]],
    output_dir: Path,
) -> None:
    per_sheet = SHEET_COLUMNS * SHEET_ROWS
    font = ImageFont.load_default()
    for sheet_index, start in enumerate(
        range(0, len(selected), per_sheet),
        start=1,
    ):
        subset = selected[start : start + per_sheet]
        cell_width = THUMBNAIL_SIZE[0] + SHEET_MARGIN * 2
        cell_height = THUMBNAIL_SIZE[1] + LABEL_HEIGHT + SHEET_MARGIN * 2
        sheet = Image.new(
            "RGB",
            (cell_width * SHEET_COLUMNS, cell_height * SHEET_ROWS),
            (24, 24, 27),
        )
        draw = ImageDraw.Draw(sheet)
        for index, (candidate, category) in enumerate(subset):
            row, column = divmod(index, SHEET_COLUMNS)
            x = column * cell_width + SHEET_MARGIN
            y = row * cell_height + SHEET_MARGIN
            try:
                with Image.open(candidate.path) as source:
                    thumbnail = source.convert("RGB")
                    thumbnail.thumbnail(THUMBNAIL_SIZE)
            except (OSError, UnidentifiedImageError):
                continue
            image_x = x + (THUMBNAIL_SIZE[0] - thumbnail.width) // 2
            image_y = y + (THUMBNAIL_SIZE[1] - thumbnail.height) // 2
            sheet.paste(thumbnail, (image_x, image_y))
            prefix = sha256_file(candidate.path)[:12]
            draw.text(
                (x, y + THUMBNAIL_SIZE[1] + 5),
                f"{prefix}  {category}",
                fill=(245, 245, 245),
                font=font,
            )
        sheet.save(
            output_dir / f"contact-sheet-{sheet_index:02d}.jpg",
            quality=90,
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument(
        "--emit-review-dir",
        type=Path,
        required=True,
    )
    parser.add_argument("--count", type=int, default=80)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        raise SystemExit(f"benchmark root does not exist: {root}")
    build_review_artifacts(
        root,
        args.emit_review_dir,
        count=args.count,
    )
    print(f"Wrote hash-only review artifacts to {args.emit_review_dir}")


if __name__ == "__main__":
    main()
