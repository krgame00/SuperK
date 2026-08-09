import hashlib
import subprocess
import sys
from pathlib import Path

import pytest

from app.model_store import ChecksumMismatch, ModelSpec, ModelStore


def test_model_store_accepts_matching_file(tmp_path: Path) -> None:
    payload = b"model-bytes"
    digest = hashlib.sha256(payload).hexdigest()
    target = tmp_path / "model.onnx"
    target.write_bytes(payload)
    store = ModelStore(
        tmp_path,
        {"test": ModelSpec("test", "", digest, "MIT", "model.onnx")},
    )
    assert store.ensure("test") == target


def test_model_store_rejects_wrong_checksum(tmp_path: Path) -> None:
    target = tmp_path / "model.onnx"
    target.write_bytes(b"wrong")
    store = ModelStore(
        tmp_path,
        {"test": ModelSpec("test", "", "0" * 64, "MIT", "model.onnx")},
    )
    with pytest.raises(ChecksumMismatch):
        store.ensure("test")
    assert target.read_bytes() == b"wrong"


def test_model_store_rejects_unknown_model(tmp_path: Path) -> None:
    store = ModelStore(tmp_path, {})
    with pytest.raises(KeyError, match="unknown model"):
        store.ensure("missing")


def test_install_models_script_runs_from_service_root() -> None:
    service_root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "scripts/install_models.py", "--help"],
        cwd=service_root,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "--baseline" in result.stdout
