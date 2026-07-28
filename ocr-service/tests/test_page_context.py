import numpy as np

from app.mask_refiner import MaskRegion
from app.page_context import classify_page
from app.schemas import PageRole, PixelRect

QR_POLYGON = np.array([[18, 18], [42, 18], [42, 42], [18, 42]])


def _region(x: int, y: int, width: int, height: int) -> MaskRegion:
    return MaskRegion(
        id="region-1",
        rect=PixelRect(x=x, y=y, width=width, height=height),
        component_ids=(1,),
        stroke_radius=2,
    )


def test_qr_heavy_page_is_not_automatic_comic() -> None:
    image = np.full((200, 160, 3), 255, np.uint8)
    image[10:55, 10:55] = 0
    image[170:175, 15:145] = 0

    result = classify_page(image, regions=[], qr_polygons=[QR_POLYGON])

    assert result.role is PageRole.CREDITS


def test_panel_art_page_is_comic() -> None:
    image = np.full((200, 160, 3), 255, np.uint8)
    image[20:180:8, 15:145] = 0
    image[20:180, 15:145:8] = 0

    result = classify_page(
        image,
        [_region(55, 70, 45, 30)],
        qr_polygons=[],
    )

    assert result.role is PageRole.COMIC


def test_horizontal_text_bands_are_ui() -> None:
    image = np.full((200, 160, 3), 255, np.uint8)
    image[20:45, 5:155] = 0
    image[80:105, 5:155] = 0
    image[140:165, 5:155] = 0

    result = classify_page(
        image,
        [_region(5, 20, 150, 145)],
        qr_polygons=[],
    )

    assert result.role is PageRole.UI


def test_dense_comic_art_wins_over_horizontal_dark_rows() -> None:
    image = np.full((200, 160, 3), 255, np.uint8)
    image[20:180:8, 15:145] = 0
    image[20:180, 15:145:8] = 0
    image[35:45, 5:155] = 0
    image[100:110, 5:155] = 0

    result = classify_page(
        image,
        [_region(20, 30, 130, 120)],
        qr_polygons=[],
    )

    assert result.features.horizontal_band_score >= 0.72
    assert result.features.text_coverage >= 0.08
    assert result.role is PageRole.COMIC


def test_sparse_full_width_interface_is_ui_despite_artwork() -> None:
    image = np.full((200, 160, 3), 255, np.uint8)
    image[20:180:10, 20:140] = 0
    image[20:180, 20:140:10] = 0
    image[50:62, :] = 0
    image[120:132, :] = 0

    result = classify_page(
        image,
        [_region(5, 175, 150, 8)],
        qr_polygons=[],
    )

    assert result.features.line_art_density >= 0.035
    assert result.features.horizontal_band_score >= 0.98
    assert result.features.text_coverage < 0.08
    assert result.role is PageRole.UI


def test_ambiguous_blank_page_is_unknown() -> None:
    image = np.full((800, 600, 3), 255, np.uint8)

    assert classify_page(image, [], qr_polygons=[]).role is PageRole.UNKNOWN
