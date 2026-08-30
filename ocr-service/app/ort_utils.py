"""Shared ONNX Runtime provider selection and session utilities.

Prefers GPU providers (CUDA/TensorRT/DirectML) when available, falls back to CPU.

Note: onnxruntime-gpu lists CUDA as "available" even when the CUDA
runtime DLLs are missing — session creation then fails.
Set SUPERK_FORCE_CPU=1 to skip GPU entirely (stable, slower).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import onnxruntime as ort

logger = logging.getLogger(__name__)


def _ensure_cuda_path() -> None:
    """Add torch's bundled CUDA/cuDNN DLLs (torch/lib) to PATH.

    onnxruntime-gpu needs cublas64_12.dll / cudnn64_9.dll at runtime.
    CUDA Toolkit's DLLs are often not installed; torch ships them in
    venv/Lib/site-packages/torch/lib. Without this, session creation
    with CUDAExecutionProvider fails and we silently fall back to CPU.
    """
    try:
        import torch

        lib_dir = Path(torch.__file__).resolve().parent / "lib"
        if lib_dir.is_dir():
            os.environ["PATH"] = str(lib_dir) + os.pathsep + os.environ.get("PATH", "")
            logger.debug("Added torch/lib to PATH for CUDA DLLs: %s", lib_dir)
    except Exception as exc:  # torch not installed — nothing to add
        logger.debug("Could not locate torch/lib for CUDA DLLs: %s", exc)


_ensure_cuda_path()


def _gpu_providers() -> list[str]:
    available = set(ort.get_available_providers())
    # Order of priority: CUDA -> DirectML (Windows AMD/Intel/NVIDIA)
    providers: list[str] = []
    if "CUDAExecutionProvider" in available:
        providers.append("CUDAExecutionProvider")
    if os.environ.get("SUPERK_ENABLE_TENSORRT") == "1" and "TensorrtExecutionProvider" in available:
        providers.append("TensorrtExecutionProvider")
    if "DmlExecutionProvider" in available:
        providers.append("DmlExecutionProvider")
    return providers


def preferred_providers() -> list[str]:
    """Return the best available execution providers, GPU first."""
    if os.environ.get("SUPERK_FORCE_CPU") == "1":
        return ["CPUExecutionProvider"]
    gpu = _gpu_providers()
    return gpu + ["CPUExecutionProvider"] if gpu else ["CPUExecutionProvider"]


def is_gpu_available() -> bool:
    if os.environ.get("SUPERK_FORCE_CPU") == "1":
        return False
    gpu = _gpu_providers()
    return len(gpu) > 0


def create_session_options() -> ort.SessionOptions:
    """Create high-performance tuned session options for ONNX Runtime."""
    options = ort.SessionOptions()
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = True
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.intra_op_num_threads = min(4, os.cpu_count() or 1)
    return options


def create_inference_session(
    model_path: str | Path,
    sess_options: ort.SessionOptions | None = None,
) -> ort.InferenceSession:
    """Create an InferenceSession with automatic fallback to CPU if GPU initialization fails."""
    options = sess_options or create_session_options()
    path_str = str(model_path)
    providers = preferred_providers()

    try:
        return ort.InferenceSession(
            path_str,
            sess_options=options,
            providers=providers,
        )
    except Exception as exc:
        if providers != ["CPUExecutionProvider"]:
            logger.warning(
                "GPU initialization failed for %s with %s (%s). Falling back to CPUExecutionProvider.",
                path_str,
                providers,
                exc,
            )
            return ort.InferenceSession(
                path_str,
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
        raise
