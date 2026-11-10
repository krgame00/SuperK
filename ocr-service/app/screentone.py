"""Classify one grayscale patch as screentone (halftone dots) via its 2-D FFT.

Neural inpainting smears halftone dots into a flat gray smudge, so screentone
regions must route to procedural regeneration instead of LaMa. A patch counts
as screentone only when both gates pass: hard luma contrast (sigma gate) and
one dominant symmetric harmonic pair in the spectrum (FFT gate). Gaussian
noise passes the sigma gate but spreads its energy evenly across the spectrum,
which is why the FFT gate exists.

Blueprint: "พิมพ์เขียววิศวกรรมย้อนกลับ: ระบบฟื้นฟูเม็ดสกรีนโทน (Screentone
Inpainting) ..." sections 2.1-2.3 (FFT pipeline) and 5.2 (detection gate).
"""

import math
from dataclasses import dataclass

import numpy as np

# Blueprint section 5.2: real screentone sigma spans 80-125 while neural
# inpainting output spans 0.5-12; 60.0 is the documented decision boundary.
SIGMA_THRESHOLD = 60.0
# Geometric midpoint of the measured separation (tests/test_screentone.py
# fixtures plus a sweep of public/comparison): clipped Gaussian noise tops out
# at 8.14 while synthetic halftone floors at 379.4, so 55.0 sits 6.8x above
# the noise ceiling and 6.9x below the halftone floor. On the 80 real-page
# patches it keeps every genuine tone patch (prominence >= 78) while dropping
# most text/linework peaks (40-170).
PEAK_PROMINENCE_THRESHOLD = 55.0


@dataclass(frozen=True)
class ScreentoneAnalysis:
    sigma_patch: float
    peak_magnitude: float
    period_px: float | None
    angle_rad: float | None
    is_screentone: bool


def analyze_screentone(gray_patch: np.ndarray, *, fft_window: int = 256) -> ScreentoneAnalysis:
    """Analyze one grayscale patch and decide whether it is screentone.

    ``gray_patch`` is a 2-D luma array (uint8 or float, 0-255 scale). The
    patch is center-cropped to an even ``n <= fft_window`` square, Hanning
    windowed, and FFT-shifted; the harmonic pair with the highest magnitude
    sum outside the DC zone yields the dot period and screen angle.
    """
    if gray_patch.ndim != 2:
        raise ValueError(f"expected a 2-D grayscale patch, got shape {gray_patch.shape}")
    luma = np.asarray(gray_patch, dtype=np.float32)
    n = min(int(fft_window), luma.shape[0], luma.shape[1])
    n -= n % 2  # even n keeps the DC bin exactly at (n/2, n/2) as in section 2.2
    if n <= 0:
        raise ValueError("patch is too small to analyze")
    y0 = (luma.shape[0] - n) // 2
    x0 = (luma.shape[1] - n) // 2
    patch = luma[y0 : y0 + n, x0 : x0 + n]

    sigma = float(patch.std())
    hanning_2d = np.hanning(n)[:, None] * np.hanning(n)[None, :]
    magnitude = np.abs(np.fft.fftshift(np.fft.fft2(patch * hanning_2d)))

    offsets = np.arange(n) - n / 2
    dc_radius = max(3, math.ceil(n * 0.06))
    dc_zone = offsets[:, None] ** 2 + offsets[None, :] ** 2 <= dc_radius**2

    peak_magnitude = 0.0
    period_px = None
    angle_rad = None
    mean_magnitude = magnitude[~dc_zone].mean() if (~dc_zone).any() else 0.0
    if mean_magnitude > 0.0:
        mirror = (-np.arange(n)) % n  # conjugate bin of each fftshifted index
        pair_sum = magnitude + magnitude[mirror[:, None], mirror[None, :]]
        pair_sum[dc_zone] = 0.0
        row, col = np.unravel_index(np.argmax(pair_sum), pair_sum.shape)
        dv = float(row - n / 2)
        du = float(col - n / 2)
        radius = math.hypot(du, dv)
        if radius > 0.0:
            peak_magnitude = float(pair_sum[row, col] / mean_magnitude)
            period_px = n / radius  # P = 1/f with f = radius/n cycles per pixel
            angle_rad = math.atan2(dv, du)

    return ScreentoneAnalysis(
        sigma_patch=sigma,
        peak_magnitude=peak_magnitude,
        period_px=period_px,
        angle_rad=angle_rad,
        is_screentone=sigma > SIGMA_THRESHOLD and peak_magnitude > PEAK_PROMINENCE_THRESHOLD,
    )
