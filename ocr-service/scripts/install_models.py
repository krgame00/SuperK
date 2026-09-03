from __future__ import annotations

import argparse
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.model_store import ModelStore


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install verified cleaning models")
    parser.add_argument(
        "--baseline",
        action="store_true",
        help="install the CTD detector and AOT cleaner",
    )
    parser.add_argument(
        "--include-anime-lama",
        action="store_true",
        help="also install the AnimeLaMa model",
    )
    parser.add_argument(
        "--include-lama-large",
        action="store_true",
        help="also install the LaMa Large checkpoint",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="install all available models (CTD, AOT, AnimeLaMa, LaMa Large)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.baseline and not args.include_anime_lama and not args.include_lama_large and not args.all:
        raise SystemExit("select --baseline, --include-anime-lama, --include-lama-large, or --all")

    store = ModelStore.from_manifest(
        SERVICE_ROOT / "models",
        SERVICE_ROOT / "models" / "manifest.json",
    )
    model_ids: list[str] = []
    if args.all:
        model_ids.extend(("ctd-onnx", "aot-onnx", "anime-lama", "lama-large"))
    else:
        if args.baseline:
            model_ids.extend(("ctd-onnx", "aot-onnx"))
        if args.include_anime_lama:
            model_ids.append("anime-lama")
        if args.include_lama_large:
            model_ids.append("lama-large")

    for model_id in model_ids:
        path = store.ensure(model_id)
        print(f"{model_id}: {path}")


if __name__ == "__main__":
    main()
