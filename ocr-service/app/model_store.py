from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from urllib.request import urlopen


class ChecksumMismatch(RuntimeError):
    """Raised when a model file does not match its pinned digest."""


@dataclass(frozen=True)
class ModelSpec:
    id: str
    url: str
    sha256: str
    license: str
    filename: str


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path: Path) -> dict[str, ModelSpec]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {
        model_id: ModelSpec(id=model_id, **model_data)
        for model_id, model_data in raw.items()
    }


class ModelStore:
    def __init__(self, model_dir: Path, manifest: dict[str, ModelSpec]) -> None:
        self.model_dir = model_dir
        self.manifest = manifest

    @classmethod
    def from_manifest(cls, model_dir: Path, manifest_path: Path) -> ModelStore:
        return cls(model_dir, load_manifest(manifest_path))

    def ensure(self, model_id: str) -> Path:
        try:
            spec = self.manifest[model_id]
        except KeyError as error:
            raise KeyError(f"unknown model: {model_id}") from error

        self.model_dir.mkdir(parents=True, exist_ok=True)
        target = self.model_dir / spec.filename
        if target.exists():
            self._verify(target, spec)
            return target

        part = target.with_suffix(f"{target.suffix}.part")
        with urlopen(spec.url) as response, part.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        try:
            self._verify(part, spec)
        except ChecksumMismatch:
            part.unlink(missing_ok=True)
            raise
        part.replace(target)
        return target

    @staticmethod
    def _verify(path: Path, spec: ModelSpec) -> None:
        actual = sha256_file(path)
        if actual != spec.sha256:
            raise ChecksumMismatch(
                f"{spec.id} checksum mismatch: expected {spec.sha256}, got {actual}",
            )
