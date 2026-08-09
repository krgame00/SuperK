from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

SEED = 20260727
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
CATEGORIES = (
    "white-bubble",
    "colored-bubble",
    "vertical-japanese",
    "outlined-or-colored-text",
    "artwork-sfx",
    "screentone",
    "complex-color",
    "dense-text",
    "text-free",
)
LANGUAGE_TAGS = re.compile(
    r"\[(?:English|Chinese|Thai|中国語版)\]|ภาษาไทย",
    flags=re.IGNORECASE,
)
EXCLUDED_PATH_TAGS = (
    "[english]",
    "[chinese]",
    "[thai]",
    "ภาษาไทย",
    "[中国語版]",
)


@dataclass(frozen=True)
class Candidate:
    path: Path
    relative_path_hash: str
    width: int
    height: int
    scores: dict[str, float]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def anonymized_relative_path_hash(path: Path, root: Path) -> str:
    relative = path.relative_to(root).as_posix()
    normalized = LANGUAGE_TAGS.sub("", relative)
    return hashlib.sha256(
        normalized.encode("utf-8", errors="surrogatepass"),
    ).hexdigest()


def should_include_relative_path(relative: Path) -> bool:
    folded = relative.as_posix().casefold()
    return not any(
        tag.casefold() in folded for tag in EXCLUDED_PATH_TAGS
    )


def analyze(path: Path, root: Path) -> Candidate | None:
    try:
        with Image.open(path) as image:
            width, height = image.size
            image.thumbnail((384, 384))
            rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    except (OSError, UnidentifiedImageError):
        return None
    if width <= 0 or height <= 0 or rgb.size == 0:
        return None

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    edges = cv2.Canny(gray, 70, 160)
    edge_density = float(np.mean(edges > 0))
    white_ratio = float(np.mean(gray >= 238))
    dark_ratio = float(np.mean(gray <= 55))
    saturation = float(np.mean(hsv[..., 1]) / 255.0)
    color_spread = float(np.mean(np.std(rgb.astype(np.float32), axis=2)) / 120.0)
    contrast = float(np.std(gray) / 96.0)
    laplacian = float(np.var(cv2.Laplacian(gray, cv2.CV_32F)) / 5000.0)
    portrait = min(1.0, max(0.0, (height / max(width, 1) - 1.0) / 0.8))
    midtone = float(np.mean((gray > 60) & (gray < 220)))

    scores = {
        "white-bubble": 1.6 * white_ratio + edge_density + 0.4 * contrast,
        "colored-bubble": 1.2 * saturation + edge_density + 0.3 * white_ratio,
        "vertical-japanese": 1.5 * portrait + edge_density + 0.2 * dark_ratio,
        "outlined-or-colored-text": 1.1 * saturation + 1.5 * edge_density + contrast,
        "artwork-sfx": 1.8 * edge_density + contrast + 0.5 * dark_ratio,
        "screentone": 0.9 * midtone + 0.8 * min(laplacian, 1.5) + edge_density,
        "complex-color": 1.5 * saturation + color_spread + contrast,
        "dense-text": 2.2 * edge_density + dark_ratio + 0.5 * portrait,
        "text-free": 1.8 * (1.0 - min(edge_density * 8.0, 1.0))
        + 0.4 * (1.0 - min(contrast, 1.0)),
    }
    return Candidate(
        path=path,
        relative_path_hash=anonymized_relative_path_hash(path, root),
        width=width,
        height=height,
        scores=scores,
    )


def discover(root: Path) -> list[Candidate]:
    candidates: list[Candidate] = []
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix().casefold()):
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
            if not should_include_relative_path(path.relative_to(root)):
                continue
            candidate = analyze(path, root)
            if candidate is not None:
                candidates.append(candidate)
    return candidates


def select(candidates: list[Candidate], count: int) -> list[tuple[Candidate, str]]:
    if count < len(CATEGORIES):
        raise ValueError(f"count must be at least {len(CATEGORIES)}")

    ranked: dict[str, list[Candidate]] = {}
    for category in CATEGORIES:
        ranked[category] = sorted(
            candidates,
            key=lambda candidate: (
                candidate.scores[category],
                _seeded_tiebreak(candidate.relative_path_hash),
            ),
            reverse=True,
        )

    selected: list[tuple[Candidate, str]] = []
    used_paths: set[str] = set()
    used_content: set[str] = set()

    def add(candidate: Candidate, category: str) -> bool:
        if candidate.relative_path_hash in used_paths:
            return False
        content_hash = sha256_file(candidate.path)
        if content_hash in used_content:
            return False
        used_paths.add(candidate.relative_path_hash)
        used_content.add(content_hash)
        selected.append((candidate, category))
        return True

    for category in CATEGORIES:
        if not any(add(candidate, category) for candidate in ranked[category]):
            raise RuntimeError(f"unable to select a unique page for {category}")

    fill_order = sorted(
        candidates,
        key=lambda candidate: _seeded_tiebreak(candidate.relative_path_hash),
        reverse=True,
    )
    for candidate in fill_order:
        if len(selected) >= count:
            break
        category = max(CATEGORIES, key=lambda name: candidate.scores[name])
        add(candidate, category)
    if len(selected) != count:
        raise RuntimeError(f"found only {len(selected)} unique images")
    return selected


def build_manifest(
    root: Path,
    count: int,
    review_labels: dict[str, str],
) -> dict[str, object]:
    reviewed = [
        candidate
        for candidate in discover(root)
        if review_labels.get(sha256_file(candidate.path)) == "original_comic"
    ]
    if len(reviewed) < count:
        raise RuntimeError(
            f"found only {len(reviewed)} reviewed original_comic pages",
        )
    selected = select(reviewed, count)
    pages = [
        {
            "relative_path_hash": candidate.relative_path_hash,
            "sha256": sha256_file(candidate.path),
            "width": candidate.width,
            "height": candidate.height,
            "categories": [category],
            "review_label": "original_comic",
        }
        for candidate, category in selected
    ]
    return {"version": 1, "seed": SEED, "pages": pages}


def _seeded_tiebreak(relative_path_hash: str) -> int:
    payload = f"{SEED}:{relative_path_hash}".encode()
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], "big")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--count", type=int, default=30)
    parser.add_argument(
        "--review-labels",
        type=Path,
        required=True,
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parents[1] / "benchmarks" / "manifest.json",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    if not root.is_dir():
        raise SystemExit(f"benchmark root does not exist: {root}")
    labels_document = json.loads(
        args.review_labels.read_text(encoding="utf-8"),
    )
    review_labels = labels_document.get("labels", labels_document)
    manifest = build_manifest(root, args.count, review_labels)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(manifest['pages'])} anonymized pages to {args.output}")


if __name__ == "__main__":
    main()
