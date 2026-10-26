from __future__ import annotations

import numpy as np

from app.cleaners.hybrid_inpainter import HybridInpainter, InpaintTier


def test_solid_white_balloon_tier1():
    # 80x80 pure white speech balloon
    image = np.full((80, 80, 3), 255, dtype=np.uint8)
    # Add simulated black text pixels in the center (20..60, 20..60)
    image[25:55, 25:55] = 10

    # Binary mask covering the text
    mask = np.zeros((80, 80), dtype=np.uint8)
    mask[25:55, 25:55] = 255

    inpainter = HybridInpainter()
    res = inpainter.inpaint(image, mask)

    assert res.tier == InpaintTier.SOLID
    assert res.has_dominant_bg_color is True
    assert res.dominant_color_rgb == (255, 255, 255)
    assert res.elapsed_ms < 10.0  # Runs in fraction of a millisecond

    # The text area should be completely restored to 255
    assert np.all(res.image_rgb[25:55, 25:55] == 255)


def test_solid_pastel_balloon_tier1():
    # 60x60 pastel balloon with slight noise (< 6.5 std)
    rng = np.random.default_rng(42)
    base_color = np.array([245, 230, 200], dtype=np.float32)
    noise = rng.normal(0, 1.5, size=(60, 60, 3))
    image = np.clip(base_color + noise, 0, 255).astype(np.uint8)

    # Put dark text
    image[20:40, 20:40] = 30

    mask = np.zeros((60, 60), dtype=np.uint8)
    mask[20:40, 20:40] = 255

    inpainter = HybridInpainter()
    res = inpainter.inpaint(image, mask)

    assert res.tier == InpaintTier.SOLID
    assert res.has_dominant_bg_color is True
    # Dominant color close to base_color
    for c_res, c_base in zip(res.dominant_color_rgb, base_color):
        assert abs(c_res - c_base) <= 3


def test_vertical_gradient_tier2():
    # 100x60 vertical gradient (e.g. Manhwa sky)
    h, w = 100, 60
    image = np.zeros((h, w, 3), dtype=np.uint8)
    for y in range(h):
        # Top is light blue (220, 240, 255), Bottom is dark blue (60, 100, 180)
        alpha = y / float(h - 1)
        color = (1.0 - alpha) * np.array([220, 240, 255]) + alpha * np.array([60, 100, 180])
        image[y, :] = color.astype(np.uint8)

    # Mask in the middle (35..65, 15..45)
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[35:65, 15:45] = 255
    # Corrupt the image at the mask
    image[35:65, 15:45] = 0

    inpainter = HybridInpainter()
    res = inpainter.inpaint(image, mask)

    assert res.tier == InpaintTier.GRADIENT
    assert res.has_dominant_bg_color is False
    assert res.elapsed_ms < 15.0

    # Verify monotonic vertical gradient inside the inpainted box
    # Middle pixel should be darker than top pixel and lighter than bottom pixel
    top_val = float(res.image_rgb[35, 30, 0])
    mid_val = float(res.image_rgb[50, 30, 0])
    bot_val = float(res.image_rgb[64, 30, 0])
    assert top_val > mid_val > bot_val


def test_complex_artwork_tier3_fallback():
    # High-variance checkered / screentone pattern
    h, w = 80, 80
    image = np.zeros((h, w, 3), dtype=np.uint8)
    for y in range(h):
        for x in range(w):
            if (x // 4 + y // 4) % 2 == 0:
                image[y, x] = [240, 20, 20]
            else:
                image[y, x] = [20, 240, 20]

    mask = np.zeros((h, w), dtype=np.uint8)
    mask[30:50, 30:50] = 255

    deep_called = False

    def mock_deep(img, msk):
        nonlocal deep_called
        deep_called = True
        out = img.copy()
        out[msk > 0] = [128, 128, 128]
        return out

    inpainter = HybridInpainter()
    res = inpainter.inpaint(image, mask, deep_cleaner_fn=mock_deep)

    assert res.tier == InpaintTier.DEEP
    assert deep_called is True
    assert np.all(res.image_rgb[30:50, 30:50] == [128, 128, 128])


def test_empty_mask():
    image = np.full((50, 50, 3), 200, dtype=np.uint8)
    mask = np.zeros((50, 50), dtype=np.uint8)

    inpainter = HybridInpainter()
    res = inpainter.inpaint(image, mask)

    assert res.tier == InpaintTier.SOLID
    assert np.array_equal(res.image_rgb, image)
