// Shared type home for the overlay surface. Leaf module by rule: type-only
// imports only, so translationOverlay and bubbleLayoutOptimizer can both point
// down here without forming a dependency cycle.

import type { TranslationReview } from "../translation/qualityReview";
import type { SourceSizing } from "../sourceTextSize";
import type { TextStyleProfile } from "../colorMatching/types";
import type { WarpConfig } from "../tools/TextWarpRenderer";
import type { BubbleCategory } from "../typography/comicTypography";

/** A translated bubble produced by the LLM / manual editor.
 *  Loose by design: carries optional rendering metadata added at runtime. */
export interface TranslatedBubble {
  t?: string;
  translated?: string;
  original_text?: string;
  translationReview?: TranslationReview;
  /** bounding box [ymin, xmin, ymax, xmax] in 0-1000 scale */
  box?: number[];
  isManual?: boolean;
  isInvalidBox?: boolean;
  /** runtime flag set once the user has manually resized a bubble */
  __resized?: boolean;
  /** runtime flag set once the user has deleted a bubble */
  deleted?: boolean;
  /** runtime flag set when bubble is hidden (e.g. SFX policy: ignore) */
  hidden?: boolean;
  /** cached translated text for SFX bubbles when switching policy modes */
  sfxTranslated?: string;
  /** cached original source text for SFX bubbles when switching policy modes */
  sfxOriginal?: string;
  /** explicit marker whether this bubble is an SFX bubble */
  isSfx?: boolean;
  /** runtime font size multiplier for this bubble */
  fontSizeMultiplier?: number;
  /** rotation angle in degrees (-180..180; negative = tilted upward-right) */
  rotation?: number;
  /** whether the bubble text renders with italic / slanted glyphs */
  isItalic?: boolean;
  /** alias for isItalic returned by LLM payload */
  italic?: boolean;
  /** locked base font size for width reflow and editing */
  targetFontSize?: number;
  /** Persisted original-pixel measurement, distinct from style and saved manual sizes. */
  sourceSizing?: SourceSizing;
  /** User-authorized layout space in original-image pixels, never inferred from an OCR box. */
  userTextSpace?: {owner:'manual';rect:{x:number;y:number;width:number;height:number};imageWidth:number;imageHeight:number};
  /** minimum frame height preserved by content-driven width reflow */
  manualMinHeightPx?: number;
  /** persisted interactive layout; source of truth for move/resize/rotation */
  layoutAdjustment?: OverlayAdjustment;
  /** bounded proportional layout of the last render; drives bitmap previews
   *  and exact re-renders for movement/rotation/undo/reopen */
  layoutSnapshot?: BubbleProportionalLayout;
  /** redraw callback attached to overlay bubbles */
  render?: () => void;
  styleProfile?: TextStyleProfile;
  /** Non-linear SFX text warp deformation (arch, wave, bulge, squeeze) */
  warp?: WarpConfig;
  /** Authentic speech bubble scanline chord width ratios (20 vertical slices) */
  scanlineRatios?: number[];
  /** Comic bubble archetype (CAT-01 normal, CAT-02 shouting, CAT-03 thought, CAT-04 narration) */
  bubbleCategory?: BubbleCategory;
  /** Vertical typesetting orientation (Tate-chū-gaki / 縦書き) */
  vertical?: boolean;
  /** Character who spoke this bubble (e.g. character name or role) */
  speaker?: string;
  /** Whether the speaker was confirmed/edited by the user */
  speakerConfirmed?: boolean;
  /** Stable identity used by persistence keys and layout dedup. */
  id?: string | number;
  /** Category hint written by style-inference passes (aliases of bubbleCategory). */
  styleCategory?: string;
  /** Raw LLM payload category fields read by style inference. */
  category?: string;
  type?: string;
  kind?: string;
  role?: string;
  textType?: string;
  text_type?: string;
  /** SFX / narration / subtitle payload flags (multiple alias shapes from LLM). */
  sfx?: boolean;
  is_sfx?: boolean;
  narration?: boolean;
  is_narration?: boolean;
  subtitle?: boolean;
  is_subtitle?: boolean;
  isOverlay?: boolean;
  is_overlay?: boolean;
  isSubtitle?: boolean;
  isNarration?: boolean;
  /** Payload text aliases carried by LLM responses and test fixtures. */
  text?: string;
  translation?: string;
  translated_text?: string;
  originalText?: string;
  /** Identity used by test fixtures and persistence-key assertions. */
  bubble_id?: string;
  /** LLM payload page/ language metadata carried on bubbles. */
  page_num?: number;
  detected_language?: string;
  /** LLM payload 2D box (top-left/bottom-right pixel form) alongside box. */
  box_2d?: number[];
  /** Voronoi split metadata marking a merged double-bubble pair. */
  isDoubleBubble?: boolean;
  /** Review tracking metadata written by the whole-book confirmation pipeline. */
  needsReview?: boolean;
  isLowConfidence?: boolean;
  confidence?: number;
  /** Source-size evidence inputs for the auto sizing key. */
  writingMode?: string;
  sourceRotation?: number;
}

/** Style options for the translation text overlay. */
export interface OverlayTextStyle {
  fontFamily?: string;
  fontSizeMultiplier?: number;
  textColor?: string;
  textOutline?: string;
  categoryFonts?: Partial<Record<string, string>>;
}

export interface OverlayAdjustment {
  bx: number;
  by: number;
  bw: number;
  bh: number;
  iw: number;
  ih: number;
  rotation?: number;
  isItalic?: boolean;
  fontSizeMultiplier?: number;
  targetFontSize?: number;
  manualMinHeightPx?: number;
  /** Flag indicating this adjustment was manually moved, resized, or adjusted by the user */
  userModified?: boolean;
  /** Flag indicating this adjustment was generated by the automated bubble layout optimizer */
  isAutoOptimized?: boolean;
  /** Schema version of the automated bubble layout optimizer that produced this adjustment */
  autoOptimizeVersion?: number;
  /** Bounded proportional layout snapshot captured from the last render. */
  layoutSnapshot?: BubbleProportionalLayout;
  /** Persisted text style profile (including bwContrastMode and manual overrides). */
  styleProfile?: TextStyleProfile;
  /** Persisted non-linear SFX text warp deformation (arch, wave, bulge, squeeze) */
  warp?: WarpConfig;
  /** Persisted custom font family override */
  fontFamily?: string;
  /** Persisted comic bubble archetype */
  bubbleCategory?: BubbleCategory;
  /** Persisted text alignment */
  align?: "left" | "center" | "right";
  /** Persisted bold font weight override */
  isBold?: boolean;
  /** Persisted stroke outline width */
  strokeWidth?: number;
  /** Persisted box background fill color */
  boxFill?: string;
  /** Persisted text layer opacity */
  opacity?: number;
}

/**
 * Bounded proportional snapshot of one rendered bubble layout: exact text and
 * canvas font identity, the wrapped lines with their float font/line size, and
 * the tight text-block geometry inside the frame. Corner drags rescale it for
 * bitmap previews and crisp releases; re-renders reuse it verbatim for
 * movement/rotation/Undo/Redo/reopen parity. Text, font, and width edits
 * invalidate it; movement and rotation do not.
 */
export interface BubbleProportionalLayout {
  /** Exact (script-normalized) translated text the lines were laid out for. */
  text: string;
  /** Canvas font family used when the lines were measured. */
  fontFamily: string;
  /** Rendered effective font size in frame pixels (float). */
  fontSizePx: number;
  /** Rendered line height in frame pixels (float). */
  lineHeightPx: number;
  /** Wrapped lines captured from the rendered layout. */
  lines: string[];
  /** Frame size the snapshot was captured at (source-image px). */
  frameWidthPx: number;
  frameHeightPx: number;
  /** Tight text-block bounds inside the frame (source-image px, unrotated). */
  selectionX: number;
  selectionY: number;
  selectionWidth: number;
  selectionHeight: number;
  /** Bubble/global font multipliers at capture time (identity check). */
  bubbleMult: number;
  globalMult: number;
  /** Whether italic slant was active when the snapshot was captured. */
  isItalic?: boolean;
  /** Whether the captured layout overflowed its frame. */
  overflow: boolean;
}
