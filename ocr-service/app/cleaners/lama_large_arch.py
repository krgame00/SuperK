"""LaMa Large network architecture builder module."""
from __future__ import annotations


def build_lama_large():
    """Build and return a LaMa Large generator model instance.

    When using TorchScript (.pt), the architecture is embedded in the JIT graph.
    """
    raise NotImplementedError(
        "Standalone LaMa Large architecture module is not configured. Use TorchScript (.pt) model."
    )
