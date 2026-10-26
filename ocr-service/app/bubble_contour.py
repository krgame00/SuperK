from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class BubbleProfile:
    text_box_id: int
    bbox: tuple[int, int, int, int]          # (x, y, w, h) of safe area
    polygon: list[tuple[int, int]]           # Contour coordinates
    scanline_ratios: list[float]             # Horizontal width ratio across vertical slices


def extract_bubble_profiles(
    image: np.ndarray,
    ocr_boxes: list[tuple[int, int, int, int]],
    padding_ratio: float = 0.12,
    num_slices: int = 20,
    brightness_threshold: int = 215,
) -> list[BubbleProfile]:
    """
    Extracts authentic Speech Bubble contours and scanline chords for each OCR box.
    Partitions shared multi-bubble components cleanly via Voronoi distance bisector.
    """
    h_img, w_img = image.shape[:2]
    if len(image.shape) == 2:
        gray = image
    else:
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)

    _, thresh = cv2.threshold(gray, brightness_threshold, 255, cv2.THRESH_BINARY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)

    box_to_label: dict[int, int] = {}
    label_to_boxes: dict[int, list[int]] = {}

    for idx, (bx, by, bw, bh) in enumerate(ocr_boxes):
        cx = int(np.clip(bx + bw * 0.5, 0, w_img - 1))
        cy = int(np.clip(by + bh * 0.5, 0, h_img - 1))
        comp_id = int(labels[cy, cx])

        comp_area = stats[comp_id, cv2.CC_STAT_AREA] if comp_id > 0 else 0
        # Valid balloon: not background (0), not full page (> 40% area)
        if comp_id > 0 and comp_area < (h_img * w_img * 0.40):
            box_to_label[idx] = comp_id
            label_to_boxes.setdefault(comp_id, []).append(idx)
        else:
            box_to_label[idx] = -1

    profiles: list[BubbleProfile] = []

    for idx, (bx, by, bw, bh) in enumerate(ocr_boxes):
        comp_id = box_to_label[idx]
        if comp_id == -1:
            profiles.append(
                BubbleProfile(
                    text_box_id=idx,
                    bbox=(bx, by, bw, bh),
                    polygon=[(bx, by), (bx + bw, by), (bx + bw, by + bh), (bx, by + bh)],
                    scanline_ratios=[1.0] * num_slices,
                )
            )
            continue

        bubble_mask = np.uint8(labels == comp_id) * 255

        # If multiple speech boxes share this balloon, bisect using Voronoi distance
        shared_indices = label_to_boxes[comp_id]
        if len(shared_indices) > 1:
            yy, xx = np.ogrid[:h_img, :w_img]
            my_cx, my_cy = bx + bw * 0.5, by + bh * 0.5
            my_dist_sq = (xx - my_cx) ** 2 + (yy - my_cy) ** 2
            for other_idx in shared_indices:
                if other_idx == idx:
                    continue
                obx, oby, obw, obh = ocr_boxes[other_idx]
                ocx, ocy = obx + obw * 0.5, oby + obh * 0.5
                other_dist_sq = (xx - ocx) ** 2 + (yy - ocy) ** 2
                bubble_mask[other_dist_sq < my_dist_sq] = 0

        erode_px = max(2, int(min(bw, bh) * padding_ratio))
        erode_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (erode_px * 2 + 1, erode_px * 2 + 1)
        )
        safe_mask = cv2.erode(bubble_mask, erode_kernel)
        if np.count_nonzero(safe_mask) < 50:
            safe_mask = bubble_mask

        contours, _ = cv2.findContours(safe_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            profiles.append(
                BubbleProfile(
                    text_box_id=idx,
                    bbox=(bx, by, bw, bh),
                    polygon=[(bx, by), (bx + bw, by), (bx + bw, by + bh), (bx, by + bh)],
                    scanline_ratios=[1.0] * num_slices,
                )
            )
            continue

        main_contour = max(contours, key=cv2.contourArea)
        cx_rect, cy_rect, cw_rect, ch_rect = cv2.boundingRect(main_contour)

        scanline_ratios: list[float] = []
        for s in range(num_slices):
            y_sample = int(cy_rect + (s + 0.5) * (ch_rect / num_slices))
            y_sample = np.clip(y_sample, 0, h_img - 1)
            row = safe_mask[y_sample, cx_rect : cx_rect + cw_rect]
            xs = np.where(row > 0)[0]
            if len(xs) > 1:
                chord_w = float(xs[-1] - xs[0]) / max(1.0, float(cw_rect))
                scanline_ratios.append(round(max(0.25, min(1.0, chord_w)), 3))
            else:
                scanline_ratios.append(0.35)

        approx_poly = cv2.approxPolyDP(main_contour, epsilon=2.5, closed=True)
        poly_pts = [(int(pt[0][0]), int(pt[0][1])) for pt in approx_poly]

        profiles.append(
            BubbleProfile(
                text_box_id=idx,
                bbox=(int(cx_rect), int(cy_rect), int(cw_rect), int(ch_rect)),
                polygon=poly_pts,
                scanline_ratios=scanline_ratios,
            )
        )

    return profiles
