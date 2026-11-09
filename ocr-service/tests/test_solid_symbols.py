"""Unit tests for peeling solid non-text symbol blobs out of region masks."""

import cv2
import numpy as np

from app.solid_symbols import peel_solid_symbols


def _ink(mask: np.ndarray) -> np.ndarray:
    return (mask > 0).astype(np.uint8)


def _canvas() -> np.ndarray:
    return np.zeros((60, 60), np.uint8)


def _draw_ring(canvas: np.ndarray, cx: int, cy: int, radius: int) -> None:
    # Glyph-like shape: thick outline with a real counter (hole) inside.
    cv2.circle(canvas, (cx, cy), radius, 255, thickness=4, lineType=cv2.LINE_8)


def _draw_solid_blob(canvas: np.ndarray, cx: int, cy: int, rx: int, ry: int) -> None:
    cv2.ellipse(canvas, (cx, cy), (rx, ry), 0, 0, 360, 255, thickness=-1)


def test_glyph_with_counter_stays_in_text_mask() -> None:
    canvas = _canvas()
    _draw_ring(canvas, 20, 20, 10)

    text, symbols = peel_solid_symbols(canvas)

    assert _ink(symbols).sum() == 0
    assert np.array_equal(_ink(text), _ink(canvas))


def _draw_text_bars(canvas: np.ndarray, rows: int = 4) -> None:
    # Thin dialogue-like strokes so the region ink is text-dominated.
    for row in range(rows):
        y = 8 + row * 13
        canvas[y : y + 4, 6:46] = 255


def test_solid_note_head_is_peeled_to_symbols() -> None:
    canvas = _canvas()
    for row in range(3):
        y = 6 + row * 11
        canvas[y : y + 4, 6:50] = 255
    _draw_solid_blob(canvas, 30, 48, 13, 10)

    text, symbols = peel_solid_symbols(canvas)

    expected_note = _canvas()
    _draw_solid_blob(expected_note, 30, 48, 13, 10)
    assert np.array_equal(_ink(symbols), _ink(expected_note))
    assert np.array_equal(_ink(text), _ink(canvas) - _ink(symbols))


def test_thin_stroke_stays_in_text_mask() -> None:
    canvas = _canvas()
    canvas[10:40, 28:32] = 255  # 4x30 vertical bar: stroke-like, min side < 11

    text, symbols = peel_solid_symbols(canvas)

    assert _ink(symbols).sum() == 0
    assert np.array_equal(_ink(text), _ink(canvas))


def test_small_dot_stays_in_text_mask() -> None:
    canvas = _canvas()
    canvas[28:36, 28:36] = 255  # 8x8 blob: area below the symbol floor

    text, symbols = peel_solid_symbols(canvas)

    assert _ink(symbols).sum() == 0
    assert np.array_equal(_ink(text), _ink(canvas))


def test_partition_preserves_every_mask_pixel() -> None:
    canvas = _canvas()
    _draw_ring(canvas, 18, 20, 9)
    _draw_solid_blob(canvas, 42, 38, 12, 9)
    canvas[44:56, 8:12] = 255

    text, symbols = peel_solid_symbols(canvas)

    assert np.array_equal(
        np.maximum(_ink(text), _ink(symbols)),
        _ink(canvas),
    )


def test_rescued_zone_fill_is_never_peeled() -> None:
    canvas = _canvas()
    canvas[10:50, 10:50] = 255  # 40x40 rescue envelope fill: one solid blob
    keep = np.zeros_like(canvas)
    keep[10:50, 10:50] = 255

    text, symbols = peel_solid_symbols(canvas, keep_mask=keep)

    assert _ink(symbols).sum() == 0
    assert np.array_equal(_ink(text), _ink(canvas))


def test_rescued_pixels_stay_in_text_while_symbols_still_peel() -> None:
    canvas = _canvas()
    _draw_solid_blob(canvas, 16, 40, 10, 8)  # solid note head, not rescued
    canvas[8:30, 34:48] = 255  # rescued envelope fill on the right (14x22)
    keep = np.zeros_like(canvas)
    keep[8:30, 34:48] = 255

    text, symbols = peel_solid_symbols(canvas, keep_mask=keep)

    assert np.array_equal(_ink(symbols), _ink(_draw_note_only()))
    assert np.array_equal(_ink(text), _ink(canvas) - _ink(symbols))


def _draw_note_only() -> np.ndarray:
    canvas = _canvas()
    _draw_solid_blob(canvas, 16, 40, 10, 8)
    return canvas


def test_empty_region_yields_empty_masks() -> None:
    text, symbols = peel_solid_symbols(np.zeros((40, 40), np.uint8))
    assert _ink(text).sum() == 0
    assert _ink(symbols).sum() == 0
