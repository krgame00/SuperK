from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export SuperK's LamaLarge TorchScript model to production ONNX.",
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def _set_int_attribute(node: object, name: str, value: int) -> None:
    import onnx

    kept = [attribute for attribute in node.attribute if attribute.name != name]
    del node.attribute[:]
    node.attribute.extend(kept)
    node.attribute.extend([onnx.helper.make_attribute(name, value)])


def _rewrite_irfft_for_ort(model: object) -> int:
    """Replace inverse one-sided DFT with an explicit Hermitian expansion.

    The current PyTorch exporter correctly represents ``torch.fft.irfftn`` as
    ONNX DFT(inverse=1, onesided=1). ONNX defines that operation, but the
    onnxruntime-directml 1.24.x schema bundled by our Windows runtime rejects
    that attribute combination during model loading.

    For a real signal, the missing negative-frequency bins are the conjugate
    reverse of the positive-frequency bins. We therefore expand the one-sided
    spectrum explicitly and feed a normal inverse complex DFT. The exporter
    already slices the real component immediately after the DFT, so downstream
    graph semantics remain unchanged.
    """
    import onnx
    from onnx import TensorProto, helper

    rewritten = 0
    new_nodes = []

    for node_index, node in enumerate(model.graph.node):
        attributes = {
            attribute.name: helper.get_attribute_value(attribute)
            for attribute in node.attribute
        }
        if not (
            node.op_type == "DFT"
            and int(attributes.get("inverse", 0)) == 1
            and int(attributes.get("onesided", 0)) == 1
        ):
            new_nodes.append(node)
            continue

        if len(node.input) < 2 or not node.input[1]:
            raise RuntimeError(
                f"IRFFT node {node.name or node_index} has no explicit dft_length",
            )

        axis = int(attributes.get("axis", 1))
        prefix = f"superk_irfft_{node_index}"
        source = node.input[0]
        dft_length = node.input[1]

        shape_name = f"{prefix}_shape"
        axis_index_name = f"{prefix}_axis_index"
        half_length_name = f"{prefix}_half_length"
        two_name = f"{prefix}_two"
        parity_name = f"{prefix}_parity"
        zero_name = f"{prefix}_zero"
        is_even_name = f"{prefix}_is_even"
        even_int_name = f"{prefix}_even_int"
        stop_scalar_name = f"{prefix}_stop_scalar"
        unsqueeze_axis_name = f"{prefix}_unsqueeze_axis"
        stop_vector_name = f"{prefix}_stop_vector"
        starts_name = f"{prefix}_starts"
        axes_name = f"{prefix}_axes"
        steps_name = f"{prefix}_steps"
        interior_name = f"{prefix}_interior"
        reverse_start_name = f"{prefix}_reverse_start"
        reverse_end_name = f"{prefix}_reverse_end"
        reverse_step_name = f"{prefix}_reverse_step"
        reversed_name = f"{prefix}_reversed"
        conjugate_mask_name = f"{prefix}_conjugate_mask"
        conjugate_name = f"{prefix}_conjugate"
        full_spectrum_name = f"{prefix}_full_spectrum"

        constants = [
            helper.make_node(
                "Constant",
                [],
                [axis_index_name],
                name=f"{prefix}_axis_index_const",
                value=helper.make_tensor(
                    f"{prefix}_axis_index_value",
                    TensorProto.INT64,
                    [],
                    [axis],
                ),
            ),
            helper.make_node(
                "Constant",
                [],
                [two_name],
                name=f"{prefix}_two_const",
                value=helper.make_tensor(
                    f"{prefix}_two_value",
                    TensorProto.INT64,
                    [],
                    [2],
                ),
            ),
            helper.make_node(
                "Constant",
                [],
                [zero_name],
                name=f"{prefix}_zero_const",
                value=helper.make_tensor(
                    f"{prefix}_zero_value",
                    TensorProto.INT64,
                    [],
                    [0],
                ),
            ),
            helper.make_node(
                "Constant",
                [],
                [unsqueeze_axis_name],
                name=f"{prefix}_unsqueeze_axis_const",
                value=helper.make_tensor(
                    f"{prefix}_unsqueeze_axis_value",
                    TensorProto.INT64,
                    [1],
                    [0],
                ),
            ),
            helper.make_node(
                "Constant",
                [],
                [starts_name],
                name=f"{prefix}_starts_const",
                value=helper.make_tensor(
                    f"{prefix}_starts_value",
                    TensorProto.INT64,
                    [1],
                    [1],
                ),
            ),
            helper.make_node(
                "Constant",
                [],
                [axes_name],
                name=f"{prefix}_axes_const",
                value=helper.make_tensor(
                    f"{prefix}_axes_value",
                    TensorProto.INT64,
                    [1],
                    [axis],
                ),
            ),
            helper.make_node(
                "Constant",
                [],
                [steps_name],
                name=f"{prefix}_steps_const",
                value=helper.make_tensor(
                    f"{prefix}_steps_value",
                    TensorProto.INT64,
                    [1],
                    [1],
                ),
            ),
            helper.make_node(
                "Constant",
                [],
                [reverse_start_name],
                name=f"{prefix}_reverse_start_const",
                value=helper.make_tensor(
                    f"{prefix}_reverse_start_value",
                    TensorProto.INT64,
                    [1],
                    [-1],
                ),
            ),
            helper.make_node(
                "Constant",
                [],
                [reverse_end_name],
                name=f"{prefix}_reverse_end_const",
                value=helper.make_tensor(
                    f"{prefix}_reverse_end_value",
                    TensorProto.INT64,
                    [1],
                    [-(2**63) + 1],
                ),
            ),
            helper.make_node(
                "Constant",
                [],
                [reverse_step_name],
                name=f"{prefix}_reverse_step_const",
                value=helper.make_tensor(
                    f"{prefix}_reverse_step_value",
                    TensorProto.INT64,
                    [1],
                    [-1],
                ),
            ),
            helper.make_node(
                "Constant",
                [],
                [conjugate_mask_name],
                name=f"{prefix}_conjugate_mask_const",
                value=helper.make_tensor(
                    f"{prefix}_conjugate_mask_value",
                    TensorProto.FLOAT,
                    [2],
                    [1.0, -1.0],
                ),
            ),
        ]

        expansion = [
            helper.make_node(
                "Shape",
                [source],
                [shape_name],
                name=f"{prefix}_shape_node",
            ),
            helper.make_node(
                "Gather",
                [shape_name, axis_index_name],
                [half_length_name],
                name=f"{prefix}_half_length_node",
                axis=0,
            ),
            helper.make_node(
                "Mod",
                [dft_length, two_name],
                [parity_name],
                name=f"{prefix}_parity_node",
                fmod=0,
            ),
            helper.make_node(
                "Equal",
                [parity_name, zero_name],
                [is_even_name],
                name=f"{prefix}_is_even_node",
            ),
            helper.make_node(
                "Cast",
                [is_even_name],
                [even_int_name],
                name=f"{prefix}_even_int_node",
                to=TensorProto.INT64,
            ),
            helper.make_node(
                "Sub",
                [half_length_name, even_int_name],
                [stop_scalar_name],
                name=f"{prefix}_stop_scalar_node",
            ),
            helper.make_node(
                "Unsqueeze",
                [stop_scalar_name, unsqueeze_axis_name],
                [stop_vector_name],
                name=f"{prefix}_stop_vector_node",
            ),
            helper.make_node(
                "Slice",
                [source, starts_name, stop_vector_name, axes_name, steps_name],
                [interior_name],
                name=f"{prefix}_interior_node",
            ),
            helper.make_node(
                "Slice",
                [
                    interior_name,
                    reverse_start_name,
                    reverse_end_name,
                    axes_name,
                    reverse_step_name,
                ],
                [reversed_name],
                name=f"{prefix}_reverse_node",
            ),
            helper.make_node(
                "Mul",
                [reversed_name, conjugate_mask_name],
                [conjugate_name],
                name=f"{prefix}_conjugate_node",
            ),
            helper.make_node(
                "Concat",
                [source, conjugate_name],
                [full_spectrum_name],
                name=f"{prefix}_concat_node",
                axis=axis,
            ),
        ]

        new_nodes.extend(constants)
        new_nodes.extend(expansion)
        node.input[0] = full_spectrum_name
        _set_int_attribute(node, "onesided", 0)
        new_nodes.append(node)
        rewritten += 1

    if rewritten:
        del model.graph.node[:]
        model.graph.node.extend(new_nodes)

    return rewritten


def _export_with_ts2ep(model: object, image: object, mask: object, output: Path) -> None:
    import torch
    from torch._export.converter import TS2EPConverter

    exported_program = TS2EPConverter(model, (image, mask), {}).convert()
    torch.onnx.export(
        exported_program,
        (),
        str(output),
        input_names=["image", "mask"],
        output_names=["output"],
        opset_version=18,
        dynamo=True,
    )


def export_model(source: Path, output: Path, *, force: bool = False) -> None:
    try:
        import onnx
        import onnxruntime as ort
        import torch
        import onnxscript  # noqa: F401 - required by the dynamo ONNX exporter
    except ImportError as exc:
        raise SystemExit(
            "LamaLarge ONNX export needs the build-only dependencies. "
            "Install: python -m pip install -r requirements-build.in",
        ) from exc

    # The modern exporter logs Unicode status glyphs; Windows Thai code pages do
    # not encode them. Force UTF-8 only for this build-time process.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    if not source.exists():
        raise SystemExit(f"TorchScript source model not found: {source}")

    if (
        output.exists()
        and not force
        and output.stat().st_size > 1000
        and output.stat().st_mtime >= source.stat().st_mtime
    ):
        print(f"LamaLarge ONNX is up to date: {output}")
        return

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.part")
    temporary.unlink(missing_ok=True)

    model = torch.jit.load(str(source), map_location="cpu")
    model.eval()

    generator = torch.Generator(device="cpu").manual_seed(1234)
    image = torch.rand((1, 3, 128, 128), generator=generator, dtype=torch.float32)
    mask = torch.zeros((1, 1, 128, 128), dtype=torch.float32)
    mask[:, :, 48:80, 44:84] = 1.0

    with torch.inference_mode():
        expected = model(image, mask).detach().cpu().numpy()

    _export_with_ts2ep(model, image, mask, temporary)

    graph = onnx.load(str(temporary))
    rewritten = _rewrite_irfft_for_ort(graph)
    if rewritten == 0:
        raise SystemExit("Exported LamaLarge graph contained no IRFFT nodes to rewrite")
    onnx.checker.check_model(graph)
    onnx.save(graph, str(temporary))

    session = ort.InferenceSession(
        str(temporary),
        providers=["CPUExecutionProvider"],
    )
    actual = session.run(
        None,
        {
            "image": image.numpy(),
            "mask": mask.numpy(),
        },
    )[0]

    if actual.shape != expected.shape:
        raise SystemExit(
            f"Exported output shape mismatch: torch={expected.shape}, onnx={actual.shape}",
        )
    max_abs_error = float(np.max(np.abs(actual - expected)))
    if not np.isfinite(max_abs_error) or max_abs_error > 2e-3:
        raise SystemExit(
            f"Exported LamaLarge ONNX parity check failed (max abs error {max_abs_error:.6f})",
        )

    # Prove that the converted graph is genuinely spatially dynamic, rather
    # than merely accepting the 128x128 export sample.
    dynamic_image = np.random.default_rng(4321).random(
        (1, 3, 192, 192),
        dtype=np.float32,
    )
    dynamic_mask = np.zeros((1, 1, 192, 192), dtype=np.float32)
    dynamic_mask[:, :, 64:128, 72:120] = 1.0
    dynamic_output = session.run(
        None,
        {"image": dynamic_image, "mask": dynamic_mask},
    )[0]
    if dynamic_output.shape != dynamic_image.shape or not np.isfinite(dynamic_output).all():
        raise SystemExit(
            f"Exported LamaLarge ONNX dynamic-shape check failed: {dynamic_output.shape}",
        )

    temporary.replace(output)
    print(
        "Exported LamaLarge ONNX: "
        f"{output} ({output.stat().st_size / 1024 / 1024:.1f} MB, "
        f"IRFFT rewrites {rewritten}, max abs error {max_abs_error:.6f})",
    )


def main() -> None:
    args = parse_args()
    export_model(args.source, args.output, force=args.force)


if __name__ == "__main__":
    main()
