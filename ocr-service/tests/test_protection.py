import numpy as np

from app.mask_refiner import MaskRegion
from app.page_context import PageContext, PageFeatures
from app.protection import detect_protection
from app.schemas import PageRole, PixelRect, ProtectionReason


class FakeQrScanner:
    def detect(self, _image: np.ndarray) -> list[np.ndarray]:
        return [
            np.array(
                [[20, 20], [60, 20], [60, 60], [20, 60]],
                dtype=np.int32,
            ),
        ]


def _context(role: PageRole) -> PageContext:
    return PageContext(
        role=role,
        confidence=0.95,
        features=PageFeatures(
            line_art_density=0.1,
            text_coverage=0.1,
            margin_text_fraction=0.1,
            horizontal_band_score=0.1,
            qr_count=0,
        ),
    )


def _region(
    *,
    x: int = 20,
    y: int = 20,
    width: int = 40,
    height: int = 20,
) -> MaskRegion:
    return MaskRegion(
        id="region-1",
        rect=PixelRect(x=x, y=y, width=width, height=height),
        component_ids=(1,),
        stroke_radius=2,
    )


def test_qr_polygon_is_protected_with_eight_pixel_margin() -> None:
    result = detect_protection(
        np.zeros((100, 100, 3), np.uint8),
        _context(PageRole.COMIC),
        [],
        qr_scanner=FakeQrScanner(),
    )

    assert result.protected_mask[12, 12] == 255
    assert result.protected_mask[10, 10] == 0
    assert result.regions[0].reason is ProtectionReason.QR


def test_credit_page_protects_all_detected_text() -> None:
    result = detect_protection(
        np.full((100, 100, 3), 255, np.uint8),
        _context(PageRole.CREDITS),
        [_region()],
    )

    assert np.all(result.protected_mask[20:40, 20:60] == 255)
    assert result.regions[0].reason is ProtectionReason.CREDIT_PAGE


def test_unknown_page_sends_detected_text_to_review() -> None:
    result = detect_protection(
        np.full((100, 100, 3), 255, np.uint8),
        _context(PageRole.UNKNOWN),
        [_region()],
    )

    assert np.all(result.review_mask[20:40, 20:60] == 255)
    assert not np.any(result.protected_mask)


def test_compact_margin_text_is_not_blocked_on_comic_page() -> None:
    result = detect_protection(
        np.full((100, 100, 3), 255, np.uint8),
        _context(PageRole.COMIC),
        [_region(x=1, y=40, width=12, height=8)],
    )

    assert not np.any(result.review_mask)
    assert not np.any(result.protected_mask)
    assert result.regions == []
