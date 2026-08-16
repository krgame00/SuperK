from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from app.detector import RgbImage
from app.mask_refiner import BinaryMask


@dataclass(frozen=True)
class CachedResult:
    clean_image: RgbImage
    mask: BinaryMask
    review_mask: BinaryMask
    protected_mask: BinaryMask
    metadata: dict[str, object]


class ResultCache:
    def __init__(self, root: Path) -> None:
        self.root = root

    def key_for(
        self,
        source_bytes: bytes,
        *,
        pipeline_version: str,
        detector_model_sha: str,
        cleaner_model_sha: str,
        settings: dict[str, object],
    ) -> str:
        canonical = json.dumps(
            settings,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        digest = hashlib.sha256()
        for value in (
            source_bytes,
            pipeline_version.encode(),
            detector_model_sha.encode(),
            cleaner_model_sha.encode(),
            canonical,
        ):
            digest.update(value)
        return digest.hexdigest()

    def store(
        self,
        key: str,
        clean_image: RgbImage,
        mask: BinaryMask,
        review_mask: BinaryMask,
        protected_mask: BinaryMask,
        metadata: dict[str, object],
    ) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        target = self.root / key
        if target.exists():
            return target
        temporary = self.root / f".{key}.{uuid.uuid4().hex}.tmp"
        temporary.mkdir()
        try:
            Image.fromarray(clean_image).save(
                temporary / "clean.png",
            )
            Image.fromarray(mask).save(temporary / "mask.png")
            Image.fromarray(review_mask).save(
                temporary / "review-mask.png",
            )
            Image.fromarray(protected_mask).save(
                temporary / "protected-mask.png",
            )
            (temporary / "result.json").write_text(
                json.dumps(metadata, sort_keys=True),
                encoding="utf-8",
            )
            temporary.replace(target)
        except Exception:
            shutil.rmtree(temporary, ignore_errors=True)
            raise
        return target

    def load(self, key: str) -> CachedResult | None:
        target = self.root / key
        if not target.is_dir():
            return None
        required = (
            "clean.png",
            "mask.png",
            "review-mask.png",
            "protected-mask.png",
            "result.json",
        )
        if any(not (target / name).is_file() for name in required):
            return None
        clean_image = np.asarray(
            Image.open(target / "clean.png").convert("RGB"),
        ).copy()
        mask = np.asarray(Image.open(target / "mask.png").convert("L")).copy()
        review_mask = np.asarray(
            Image.open(target / "review-mask.png").convert("L"),
        ).copy()
        protected_mask = np.asarray(
            Image.open(target / "protected-mask.png").convert("L"),
        ).copy()
        metadata = json.loads(
            (target / "result.json").read_text(encoding="utf-8"),
        )
        return CachedResult(
            clean_image,
            mask,
            review_mask,
            protected_mask,
            metadata,
        )

    @staticmethod
    def retry_key(automatic_key: str, region_id: str, mask_bytes: bytes) -> str:
        digest = hashlib.sha256()
        digest.update(automatic_key.encode())
        digest.update(region_id.encode())
        digest.update(mask_bytes)
        return digest.hexdigest()
