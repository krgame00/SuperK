import {
  type TranslatedBubble,
  type OverlayAdjustment,
  fitTextForBubble,
  layoutBubbleAtFixedFont,
} from "./translationOverlay";

export interface BubbleRect {
  id: string | number;
  x: number;
  y: number;
  width: number;
  height: number;
  bubble: TranslatedBubble;
}

export interface BubbleCollision {
  bubbleA: TranslatedBubble;
  bubbleB: TranslatedBubble;
  overlapArea: number;
  overlapX: number;
  overlapY: number;
}

export interface AutoOrganizeOptions {
  fontFamily?: string;
  fontSizeMultiplier?: number;
  locale?: string;
  forceRealign?: boolean;
  minFontSize?: number;
  maxEnlargeRatio?: number;
  maxAllowedWidth?: number;
  maxAllowedHeight?: number;
  constrainToOriginalBox?: boolean;
  overrideUserModified?: boolean;
}

export interface AutoOrganizeResult {
  optimizedBubbles: TranslatedBubble[];
  adjustedCount: number;
  resolvedCollisionCount: number;
  unresolvedCollisionCount: number;
}

export const AUTO_OPTIMIZE_VERSION = 4;

/**
 * Detects whether a non-user-modified layoutAdjustment was corrupted (e.g. crushed into a narrow
 * strip < 52px, teleported far from its canonical box center by the prior id-less collision bug,
 * or produced by a pre-v4 auto-organizer build).
 */
export function isCorruptedAutoAdjustment(
  b: TranslatedBubble,
  iw: number,
  ih: number,
  adjOverride?: OverlayAdjustment,
): boolean {
  const adj = adjOverride ?? b.layoutAdjustment;
  if (!adj || adj.userModified || !adj.isAutoOptimized) return false;
  if ((adj.autoOptimizeVersion ?? 0) < AUTO_OPTIMIZE_VERSION) return true;

  const sx = adj.iw > 0 ? iw / adj.iw : 1;
  const sy = adj.ih > 0 ? ih / adj.ih : 1;
  const adjW = adj.bw * sx;
  const adjH = adj.bh * sy;
  const adjCx = (adj.bx + adj.bw / 2) * sx;
  const adjCy = (adj.by + adj.bh / 2) * sy;

  if (adjW < 52 || adjH < 28) return true;

  if (b.box && Array.isArray(b.box) && b.box.length === 4) {
    const [ymin, xmin, ymax, xmax] = b.box;
    if (
      typeof ymin === "number" &&
      typeof xmin === "number" &&
      typeof ymax === "number" &&
      typeof xmax === "number" &&
      !(xmin === 0 && ymin === 0 && xmax === 1000 && ymax === 1000)
    ) {
      const rawW = Math.max(8, ((xmax - xmin) / 1000) * iw);
      const rawCx = ((xmin + xmax) / 2000) * iw;
      const rawCy = ((ymin + ymax) / 2000) * ih;
      if (adjW < Math.min(64, rawW * 0.65)) return true;
      if (Math.abs(adjCx - rawCx) > iw * 0.22 || Math.abs(adjCy - rawCy) > ih * 0.25) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extracts the pixel bounding rectangle of a bubble for a given page dimension (iw x ih).
 */
export function getBubbleGeometry(
  b: TranslatedBubble,
  iw: number,
  ih: number,
  ignoreAdjustment = false,
): BubbleRect {
  const id: string | number =
    typeof b.id === "string" || typeof b.id === "number"
      ? b.id
      : (b.t || b.translated || "").slice(0, 15) || "bubble";

  if (
    (!ignoreAdjustment || b.layoutAdjustment?.userModified) &&
    b.layoutAdjustment &&
    b.layoutAdjustment.iw > 0 &&
    b.layoutAdjustment.ih > 0 &&
    !isCorruptedAutoAdjustment(b, iw, ih)
  ) {
    const adj = b.layoutAdjustment;
    const sx = iw / adj.iw;
    const sy = ih / adj.ih;
    return {
      id,
      x: adj.bx * sx,
      y: adj.by * sy,
      width: Math.max(8, adj.bw * sx),
      height: Math.max(8, adj.bh * sy),
      bubble: b,
    };
  }

  let x = (iw * 0.5) - (iw * 0.1);
  let y = (ih * 0.5) - (ih * 0.05);
  let width = iw * 0.2;
  let height = ih * 0.1;

  if (b.box && Array.isArray(b.box) && b.box.length === 4) {
    const [ymin, xmin, ymax, xmax] = b.box;
    if (
      typeof ymin === "number" &&
      typeof xmin === "number" &&
      typeof ymax === "number" &&
      typeof xmax === "number"
    ) {
      if (!(xmin === 0 && ymin === 0 && xmax === 1000 && ymax === 1000)) {
        x = (xmin / 1000) * iw;
        y = (ymin / 1000) * ih;
        width = Math.max(8, ((xmax - xmin) / 1000) * iw);
        height = Math.max(8, ((ymax - ymin) / 1000) * ih);
      }
    }
  }

  return { id, x, y, width, height, bubble: b };
}

/**
 * Detects overlapping / colliding bubble bounding boxes.
 */
export function detectBubbleCollisions(
  bubbles: TranslatedBubble[],
  iw: number,
  ih: number,
  padding = 0,
): BubbleCollision[] {
  const active = bubbles.filter((b) => b && !b.deleted && (b.t || b.translated || "").trim());
  const rects = active.map((b) => getBubbleGeometry(b, iw, ih));
  const collisions: BubbleCollision[] = [];

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const rA = rects[i];
      const rB = rects[j];

      const xOverlap = Math.min(rA.x + rA.width, rB.x + rB.width) - Math.max(rA.x, rB.x) + padding;
      const yOverlap = Math.min(rA.y + rA.height, rB.y + rB.height) - Math.max(rA.y, rB.y) + padding;

      if (xOverlap > 0 && yOverlap > 0) {
        collisions.push({
          bubbleA: rA.bubble,
          bubbleB: rB.bubble,
          overlapArea: xOverlap * yOverlap,
          overlapX: xOverlap,
          overlapY: yOverlap,
        });
      }
    }
  }

  return collisions;
}

/**
 * Computes a neighbor-aware horizontal width cap so adjacent vertical lobes in a
 * double/triple speech balloon can expand comfortably while preserving cluster order
 * and preventing corner neighbors from growing under/over each other.
 */
function computeNeighborMaxWidth(
  targetIdx: number,
  rawRects: BubbleRect[],
  iw: number,
): number | undefined {
  const rA = rawRects[targetIdx];
  if (!rA) return undefined;
  const cxA = rA.x + rA.width / 2;
  let minLeftDx: number | undefined;
  let minRightDx: number | undefined;
  let minCornerCap: number | undefined;

  for (let j = 0; j < rawRects.length; j++) {
    if (j === targetIdx) continue;
    const rB = rawRects[j];
    const vOverlap = Math.min(rA.y + rA.height, rB.y + rB.height) - Math.max(rA.y, rB.y);
    const minH = Math.min(rA.height, rB.height);
    if (vOverlap <= minH * 0.14) continue;

    const cxB = rB.x + rB.width / 2;
    const dx = Math.abs(cxB - cxA);
    if (dx <= 8 || dx >= iw * 0.25) continue;

    // Diagonal / corner neighbor (e.g. Page 4 top-left camera box above-right of upper-left oval):
    // Prevent horizontal expansion from growing underneath/above the neighbor and forcing vertical push.
    const overlapRatio = vOverlap / Math.max(1, minH);
    if (overlapRatio < 0.45) {
      const safeHalfW = Math.max(rA.width / 2, dx - rB.width * 0.48 - 2);
      const cornerCap = Math.max(rA.width, Math.round(safeHalfW * 2));
      minCornerCap = minCornerCap === undefined ? cornerCap : Math.min(minCornerCap, cornerCap);
      continue;
    }

    if (cxB < cxA) {
      minLeftDx = minLeftDx === undefined ? dx : Math.min(minLeftDx, dx);
    } else {
      minRightDx = minRightDx === undefined ? dx : Math.min(minRightDx, dx);
    }
  }

  let sideCap: number | undefined;
  if (minLeftDx !== undefined && minRightDx !== undefined && minLeftDx < iw * 0.16 && minRightDx < iw * 0.16) {
    // Sandwiched middle lobe in a 3-lobe cluster (e.g. Page 4 top-right "ด-เดี๋ยว ก่อนสิ!"):
    // Ensure enough width (~102-108px on 1280px) so compound Thai words render at >= 16-18px without crushing.
    sideCap = Math.max(
      Math.round(rA.width * 1.65),
      Math.round(Math.min(minLeftDx, minRightDx) * 1.25),
      Math.round(iw * 0.082),
    );
  } else {
    const closestDx = Math.min(minLeftDx ?? Infinity, minRightDx ?? Infinity);
    if (Number.isFinite(closestDx)) {
      if (closestDx < iw * 0.12) {
        // Tight double-balloon or outer lobe of a 3-lobe cluster:
        sideCap = Math.max(Math.round(rA.width * 1.38), Math.round(closestDx * 1.42));
      } else {
        sideCap = Math.max(Math.round(rA.width * 1.55), Math.round(closestDx * 1.55));
      }
    }
  }

  if (minCornerCap !== undefined && sideCap !== undefined) {
    return Math.min(minCornerCap, sideCap);
  }
  return minCornerCap ?? sideCap;
}

/**
 * Computes a neighbor-aware vertical height cap when two bubbles are stacked in the
 * same vertical column (e.g. Page 3 "SHHH!" / "EVERYONE'S GONNA HEAR YOU!", Page 4 top/bottom).
 */
function computeNeighborMaxHeight(
  targetIdx: number,
  rawRects: BubbleRect[],
  ih: number,
): number | undefined {
  const rA = rawRects[targetIdx];
  if (!rA) return undefined;
  const cyA = rA.y + rA.height / 2;
  let minCap: number | undefined;

  for (let j = 0; j < rawRects.length; j++) {
    if (j === targetIdx) continue;
    const rB = rawRects[j];
    const hOverlap = Math.min(rA.x + rA.width, rB.x + rB.width) - Math.max(rA.x, rB.x);
    const minW = Math.min(rA.width, rB.width);
    if (hOverlap <= minW * 0.18) continue;

    const cyB = rB.y + rB.height / 2;
    const dy = Math.abs(cyB - cyA);
    if (dy > 8 && dy < ih * 0.25) {
      const shareA = dy * (rA.height / Math.max(1, rA.height + rB.height));
      const nonInvadingCap = Math.round(shareA * 2 * 1.06);
      const cap = Math.max(rA.height, nonInvadingCap);
      minCap = minCap === undefined ? cap : Math.min(minCap, cap);
    }
  }

  return minCap;
}

/**
 * Fits translated text with a Readability-First + Proportional-Shape policy:
 * - Preserves vertical balloon silhouettes (`bh > bw`) on tall vertical speech balloons
 *   instead of turning them into wide horizontal boxes across character artwork.
 * - Expands tight OCR boxes into the balloon margin (or beyond when standalone) so
 *   fonts stay readable and consistent across the page.
 */
export function fitBubbleTextWithinBounds(
  bubble: TranslatedBubble,
  iw: number,
  ih: number,
  options?: AutoOrganizeOptions,
): TranslatedBubble {
  const text = (bubble.t || bubble.translated || "").trim();
  if (!text) return bubble;
  if (bubble.layoutAdjustment?.userModified && !options?.overrideUserModified) return bubble;

  // Always derive from canonical raw box when forceRealign is requested, when
  // previous adjustment was auto-generated, or when previous adjustment was corrupted.
  const ignorePrevAdjustment = Boolean(
    options?.forceRealign ||
    options?.overrideUserModified ||
    bubble.layoutAdjustment?.isAutoOptimized ||
    isCorruptedAutoAdjustment(bubble, iw, ih),
  );
  const geom = getBubbleGeometry(
    options?.overrideUserModified && bubble.layoutAdjustment?.userModified
      ? { ...bubble, layoutAdjustment: { ...bubble.layoutAdjustment, userModified: false } }
      : bubble,
    iw,
    ih,
    ignorePrevAdjustment,
  );
  const fontFamily = options?.fontFamily || "Itim, sans-serif";
  const locale = options?.locale || "th";
  const globalMult = options?.fontSizeMultiplier || 1.0;
  const bubbleMult = typeof bubble.fontSizeMultiplier === "number" ? bubble.fontSizeMultiplier : 1.0;
  const multiplier = globalMult * bubbleMult;
  const constrainToOriginal = options?.constrainToOriginalBox === true;
  const hasCloseNeighbors =
    options?.maxAllowedWidth !== undefined || options?.maxAllowedHeight !== undefined;

  const minFs = options?.minFontSize ?? (
    constrainToOriginal
      ? Math.max(13, Math.round(iw * 0.0115))
      : hasCloseNeighbors
        ? Math.max(16, Math.round(iw * 0.014))
        : Math.max(18, Math.round(iw * 0.016))
  );
  const preferredReadableFs = options?.minFontSize ?? (
    constrainToOriginal
      ? minFs
      : hasCloseNeighbors
        ? Math.max(19, Math.round(iw * 0.0165))
        : Math.max(23, Math.round(iw * 0.0195))
  );
  const isOval = !bubble.isInvalidBox;

  const origAspectRatio = geom.width / Math.max(1, geom.height);
  const isTallVerticalBalloon =
    !bubble.isInvalidBox &&
    origAspectRatio < 0.72 &&
    geom.width >= iw * 0.095 &&
    geom.height >= ih * 0.12;

  const defaultMaxW = isTallVerticalBalloon
    ? Math.round(geom.width * (options?.maxEnlargeRatio ? Math.min(1.65, options.maxEnlargeRatio) : 1.42))
    : Math.round(iw * (constrainToOriginal ? 0.36 : 0.45));
  const maxAllowedW = options?.maxAllowedWidth !== undefined
    ? Math.min(options.maxAllowedWidth, defaultMaxW)
    : defaultMaxW;
  const maxAllowedH = options?.maxAllowedHeight ?? Math.round(ih * (constrainToOriginal ? 0.38 : 0.45));

  // 1. Aspect ratio adaptation ONLY for genuinely narrow Japanese 1-column strips
  // (`geom.width < iw * 0.095` or `origAspectRatio < 0.42`), NOT wide enough vertical ovals!
  let curW = geom.width;
  let curH = geom.height;

  const isSkinnyStrip =
    !bubble.isInvalidBox &&
    !isTallVerticalBalloon &&
    (origAspectRatio < 0.45 || (origAspectRatio < 0.72 && geom.width < iw * 0.095));

  if (isSkinnyStrip) {
    const area = geom.width * geom.height;
    const desiredW = Math.max(
      geom.width,
      Math.min(
        iw * (constrainToOriginal ? 0.30 : 0.36),
        Math.round(geom.width * (constrainToOriginal ? 2.0 : 2.25)),
        Math.max(
          Math.round(geom.height * (constrainToOriginal ? 0.65 : 0.75)),
          Math.round(Math.sqrt(area * (constrainToOriginal ? 0.92 : 1.12))),
        ),
      ),
    );
    curW = Math.max(geom.width, Math.min(maxAllowedW, desiredW));
    curH = constrainToOriginal
      ? Math.max(Math.round(geom.height * 0.85), Math.min(geom.height, Math.round(area / Math.max(1, curW))))
      : Math.max(geom.height, Math.round(area / Math.max(1, curW)));
  }

  // 2. Initial fit attempt at preferredReadableFs
  let fit = fitTextForBubble(
    text,
    curW,
    curH,
    fontFamily,
    isOval,
    multiplier,
    preferredReadableFs,
    locale,
  );

  let finalWidth = curW;
  let finalHeight = curH;
  let targetFontSize = fit.fontSize;

  // 3. Controlled expansion when text doesn't fit at preferredReadableFs
  if (!fit.fits) {
    if (constrainToOriginal) {
      const fallbackFit = fitTextForBubble(
        text,
        curW,
        curH,
        fontFamily,
        isOval,
        multiplier,
        minFs,
        locale,
      );
      if (fallbackFit.fits) {
        fit = fallbackFit;
        targetFontSize = fallbackFit.fontSize;
      } else {
        const maxEnlarge = options?.maxEnlargeRatio ?? 1.15;
        const enlargedW = Math.max(curW, Math.min(maxAllowedW, Math.round(curW * maxEnlarge)));
        const enlargedH = Math.max(curH, Math.min(maxAllowedH, Math.round(curH * maxEnlarge)));
        const enlargedFit = fitTextForBubble(
          text,
          enlargedW,
          enlargedH,
          fontFamily,
          isOval,
          multiplier,
          minFs,
          locale,
        );
        finalWidth = enlargedW;
        finalHeight = enlargedH;
        targetFontSize = enlargedFit.fontSize;
        fit = enlargedFit;
      }
    } else {
      const maxEnlarge = options?.maxEnlargeRatio ?? (hasCloseNeighbors ? 1.48 : 2.15);
      const steps = [1.18, 1.35, 1.55, 1.8, maxEnlarge].filter((s) => s <= maxEnlarge + 0.01);
      let foundReadableFit = false;

      for (const scale of steps) {
        const candW = Math.max(
          curW,
          Math.min(maxAllowedW, Math.round(iw * 0.45), Math.round(curW * scale)),
        );
        const candH = Math.max(
          curH,
          Math.min(maxAllowedH, Math.round(ih * 0.45), Math.round(curH * Math.min(1.85, scale))),
        );
        const candFit = fitTextForBubble(
          text,
          candW,
          candH,
          fontFamily,
          isOval,
          multiplier,
          preferredReadableFs,
          locale,
        );
        finalWidth = candW;
        finalHeight = candH;
        targetFontSize = candFit.fontSize;
        fit = candFit;
        if (candFit.fits) {
          foundReadableFit = true;
          break;
        }
      }

      if (!foundReadableFit) {
        const fallbackFit = fitTextForBubble(
          text,
          finalWidth,
          finalHeight,
          fontFamily,
          isOval,
          multiplier,
          minFs,
          locale,
        );
        targetFontSize = fallbackFit.fontSize;
        fit = fallbackFit;
      }
    }
  }

  // Cap overly huge fonts on normal sentences in clustered pages so adjacent bubbles stay harmonious
  if (!options?.minFontSize && hasCloseNeighbors && text.length >= 6) {
    const maxClusterDialogueFs = Math.max(20, Math.round(iw * 0.0172));
    if (targetFontSize > maxClusterDialogueFs) {
      targetFontSize = maxClusterDialogueFs;
    }
  }

  // 4. Synchronize height & font size with layoutBubbleAtFixedFont
  let fixedRenderLayout = layoutBubbleAtFixedFont(
    text,
    finalWidth,
    Math.max(8, Math.round(targetFontSize * multiplier)),
    fontFamily,
    isOval,
    25,
    ih,
    locale,
  );

  // When allowed to exceed original box, expand finalWidth / finalHeight within maxAllowedW/H before stepping down font
  if (!constrainToOriginal) {
    let expandGuard = 0;
    while (
      expandGuard < 6 &&
      (fixedRenderLayout.overflow || fixedRenderLayout.requiredHeightPx > finalHeight) &&
      (finalWidth < maxAllowedW || finalHeight < maxAllowedH)
    ) {
      expandGuard++;
      const prevW = finalWidth;
      const prevH = finalHeight;
      if (fixedRenderLayout.overflow && finalWidth < maxAllowedW) {
        finalWidth = Math.min(maxAllowedW, Math.max(finalWidth + 14, Math.round(finalWidth * 1.14)));
      }
      if (fixedRenderLayout.requiredHeightPx > finalHeight && finalHeight < maxAllowedH) {
        finalHeight = Math.min(maxAllowedH, Math.max(finalHeight + 14, fixedRenderLayout.requiredHeightPx));
      }
      if (finalWidth === prevW && finalHeight === prevH) break;
      fixedRenderLayout = layoutBubbleAtFixedFont(
        text,
        finalWidth,
        Math.max(8, Math.round(targetFontSize * multiplier)),
        fontFamily,
        isOval,
        25,
        ih,
        locale,
      );
    }
  }

  // Step down to minFs if still overflowing
  while (
    targetFontSize > minFs &&
    (fixedRenderLayout.overflow || fixedRenderLayout.requiredHeightPx > finalHeight)
  ) {
    targetFontSize -= 1;
    fixedRenderLayout = layoutBubbleAtFixedFont(
      text,
      finalWidth,
      Math.max(8, Math.round(targetFontSize * multiplier)),
      fontFamily,
      isOval,
      25,
      ih,
      locale,
    );
  }

  if (fit.fits && fit.lines.length > 0 && !fixedRenderLayout.overflow) {
    const textH = (fit.lines.length - 1) * fit.lineHeight + fit.fontSize * 1.30;
    const minPreserveRatio = isTallVerticalBalloon ? 0.85 : 0.65;
    const snugH = Math.max(
      Math.round(geom.height * minPreserveRatio),
      Math.min(finalHeight, Math.max(Math.ceil(textH * 1.30), fixedRenderLayout.requiredHeightPx)),
    );
    finalHeight = Math.max(snugH, Math.min(finalHeight, fixedRenderLayout.requiredHeightPx));
  } else if (fixedRenderLayout.requiredHeightPx > finalHeight) {
    finalHeight = Math.min(maxAllowedH, Math.max(finalHeight, fixedRenderLayout.requiredHeightPx));
  }

  // If oval word-chord or vertical constraint still overflows at minFs, allow a slight width bump
  // up to the readable word floor (~8.2% page width) before stepping down below minFs
  if (!constrainToOriginal && (fixedRenderLayout.overflow || fixedRenderLayout.requiredHeightPx > finalHeight)) {
    const minWordW = Math.max(finalWidth, Math.round(iw * 0.082));
    if (minWordW > finalWidth) {
      finalWidth = minWordW;
      fixedRenderLayout = layoutBubbleAtFixedFont(
        text,
        finalWidth,
        Math.max(8, Math.round(targetFontSize * multiplier)),
        fontFamily,
        isOval,
        25,
        ih,
        locale,
      );
    }
  }

  while (
    targetFontSize > 8 &&
    (fixedRenderLayout.overflow || fixedRenderLayout.requiredHeightPx > finalHeight)
  ) {
    targetFontSize -= 1;
    fixedRenderLayout = layoutBubbleAtFixedFont(
      text,
      finalWidth,
      Math.max(8, Math.round(targetFontSize * multiplier)),
      fontFamily,
      isOval,
      25,
      ih,
      locale,
    );
  }
  if (fixedRenderLayout.requiredHeightPx > finalHeight) {
    finalHeight = Math.min(ih, fixedRenderLayout.requiredHeightPx);
  }

  // Ensure tall vertical balloons keep bh > bw
  if (isTallVerticalBalloon && finalHeight <= finalWidth) {
    finalHeight = Math.min(maxAllowedH, Math.max(geom.height, finalWidth + 12));
  }

  const cx = geom.x + geom.width / 2;
  const cy = geom.y + geom.height / 2;
  const bx = Math.max(0, Math.min(iw - finalWidth, Math.round(cx - finalWidth / 2)));
  const by = Math.max(0, Math.min(ih - finalHeight, Math.round(cy - finalHeight / 2)));

  const updatedAdj: OverlayAdjustment = {
    bx,
    by,
    bw: finalWidth,
    bh: finalHeight,
    iw,
    ih,
    rotation: bubble.layoutAdjustment?.rotation ?? (bubble.rotation as number) ?? 0,
    targetFontSize,
    fontSizeMultiplier: bubble.fontSizeMultiplier,
    isAutoOptimized: true,
    autoOptimizeVersion: AUTO_OPTIMIZE_VERSION,
  };

  const nextBubble: TranslatedBubble = {
    ...bubble,
    targetFontSize,
    layoutAdjustment: updatedAdj,
  };
  delete nextBubble.layoutSnapshot;
  return nextBubble;
}

/**
 * Re-verifies font size inside a collision-resolved bounding box WITHOUT expanding
 * bw/bh or moving bx/by, preserving zero-collision guarantees from Step 2.
 */
function refitFontInResolvedBox(
  bubble: TranslatedBubble,
  iw: number,
  ih: number,
  options?: AutoOrganizeOptions,
): TranslatedBubble {
  const text = (bubble.t || bubble.translated || "").trim();
  if (!text || bubble.layoutAdjustment?.userModified || !bubble.layoutAdjustment) {
    return bubble;
  }

  const adj = bubble.layoutAdjustment;
  const fontFamily = options?.fontFamily || "Itim, sans-serif";
  const locale = options?.locale || "th";
  const globalMult = options?.fontSizeMultiplier || 1.0;
  const bubbleMult = typeof bubble.fontSizeMultiplier === "number" ? bubble.fontSizeMultiplier : 1.0;
  const multiplier = globalMult * bubbleMult;
  const minFs = options?.minFontSize ?? Math.max(15, Math.round(iw * 0.0135));
  const isOval = !bubble.isInvalidBox;

  let targetFontSize = bubble.targetFontSize;
  if (typeof targetFontSize !== "number" || targetFontSize <= 0) {
    const fit = fitTextForBubble(
      text,
      adj.bw,
      adj.bh,
      fontFamily,
      isOval,
      multiplier,
      minFs,
      locale,
    );
    targetFontSize = fit.fontSize;
  }

  let fixedRenderLayout = layoutBubbleAtFixedFont(
    text,
    adj.bw,
    Math.max(8, Math.round(targetFontSize * multiplier)),
    fontFamily,
    isOval,
    25,
    ih,
    locale,
  );
  while (
    targetFontSize > 8 &&
    (fixedRenderLayout.overflow || fixedRenderLayout.requiredHeightPx > adj.bh)
  ) {
    targetFontSize -= 1;
    fixedRenderLayout = layoutBubbleAtFixedFont(
      text,
      adj.bw,
      Math.max(8, Math.round(targetFontSize * multiplier)),
      fontFamily,
      isOval,
      25,
      ih,
      locale,
    );
  }

  const nextBubble: TranslatedBubble = {
    ...bubble,
    targetFontSize,
    layoutAdjustment: {
      ...adj,
      targetFontSize,
      isAutoOptimized: true,
      autoOptimizeVersion: AUTO_OPTIMIZE_VERSION,
    },
  };
  delete nextBubble.layoutSnapshot;
  return nextBubble;
}

/**
 * Harmonizes font sizes across adjacent/clustered dialogue bubbles so neighboring
 * lobes in the same panel don't have jarring font jumps (e.g. 24px next to 14px).
 */
function harmonizeClusterFontSizes(
  bubbles: TranslatedBubble[],
  iw: number,
  ih: number,
  options?: AutoOrganizeOptions,
): TranslatedBubble[] {
  if (options?.minFontSize || bubbles.length < 2) return bubbles;

  const rects = bubbles.map((b) => getBubbleGeometry(b, iw, ih));
  return bubbles.map((b, i) => {
    if (!b || b.deleted || b.layoutAdjustment?.userModified || !b.layoutAdjustment || !b.targetFontSize) {
      return b;
    }
    const rA = rects[i];
    const cxA = rA.x + rA.width / 2;
    const cyA = rA.y + rA.height / 2;

    let minNeighborFs = b.targetFontSize;
    for (let j = 0; j < bubbles.length; j++) {
      if (i === j) continue;
      const nb = bubbles[j];
      if (!nb || nb.deleted || !nb.targetFontSize) continue;
      const rB = rects[j];
      const cxB = rB.x + rB.width / 2;
      const cyB = rB.y + rB.height / 2;
      if (Math.abs(cxA - cxB) < iw * 0.22 && Math.abs(cyA - cyB) < ih * 0.20) {
        minNeighborFs = Math.min(minNeighborFs, nb.targetFontSize);
      }
    }

    const maxAllowedClusterFs = minNeighborFs + 5;
    if (b.targetFontSize > maxAllowedClusterFs) {
      return refitFontInResolvedBox(
        {
          ...b,
          targetFontSize: maxAllowedClusterFs,
          layoutAdjustment: {
            ...b.layoutAdjustment,
            targetFontSize: maxAllowedClusterFs,
          },
        },
        iw,
        ih,
        options,
      );
    }
    return b;
  });
}

/**
 * Resolves overlapping bubbles by:
 * 1. Trimming back excess enlargement (`bw > trimFloorW` or `bh > rawH`) around the bubble's
 *    original balloon center FIRST, so enlarged bubbles don't shove neighbors off their balloons.
 * 2. Applying gentle repulsion separation along the shortest penetration axis.
 */
export function resolveBubbleCollisions(
  bubbles: TranslatedBubble[],
  iw: number,
  ih: number,
  options?: AutoOrganizeOptions,
): TranslatedBubble[] {
  const active = bubbles.map((b) => {
    const clone = { ...b };
    if (!clone.layoutAdjustment?.userModified) {
      delete clone.layoutSnapshot;
    }
    return clone;
  });
  const rawRects = active.map((b) => getBubbleGeometry(b, iw, ih, true));
  const maxIterations = 60;
  const readableFloorW = Math.min(Math.round(iw * 0.12), Math.max(96, Math.round(iw * 0.082)));

  for (let iter = 0; iter < maxIterations; iter++) {
    const collisions = detectBubbleCollisions(active, iw, ih, 2);
    if (collisions.length === 0) break;

    for (const col of collisions) {
      const idxA = active.findIndex(
        (b) =>
          b === col.bubbleA ||
          (b.id !== undefined && col.bubbleA.id !== undefined && b.id === col.bubbleA.id),
      );
      const idxB = active.findIndex(
        (b) =>
          b === col.bubbleB ||
          (b.id !== undefined && col.bubbleB.id !== undefined && b.id === col.bubbleB.id),
      );
      if (idxA === -1 || idxB === -1 || idxA === idxB) continue;

      const rA = getBubbleGeometry(active[idxA], iw, ih);
      const rB = getBubbleGeometry(active[idxB], iw, ih);
      const rawA = rawRects[idxA] ?? rA;
      const rawB = rawRects[idxB] ?? rB;

      const cAx = rA.x + rA.width / 2;
      const cAy = rA.y + rA.height / 2;
      const cBx = rB.x + rB.width / 2;
      const cBy = rB.y + rB.height / 2;

      const dx = cBx - cAx;
      const dy = cBy - cAy;

      let xOverlap = Math.min(rA.x + rA.width, rB.x + rB.width) - Math.max(rA.x, rB.x) + 2;
      let yOverlap = Math.min(rA.y + rA.height, rB.y + rB.height) - Math.max(rA.y, rB.y) + 2;

      if (xOverlap <= 0 || yOverlap <= 0) continue;

      const aFixed = Boolean(active[idxA].layoutAdjustment?.userModified);
      const bFixed = Boolean(active[idxB].layoutAdjustment?.userModified);
      if (aFixed && bFixed) continue;

      const multA = aFixed ? 0 : (bFixed ? 2 : 1);
      const multB = bFixed ? 0 : (aFixed ? 2 : 1);

      // Check whether raw OCR boxes had a smaller horizontal or vertical overlap
      const rawXOverlap = Math.min(rawA.x + rawA.width, rawB.x + rawB.width) - Math.max(rawA.x, rawB.x);
      const rawYOverlap = Math.min(rawA.y + rawA.height, rawB.y + rawB.height) - Math.max(rawA.y, rawB.y);
      const preferHorizontal =
        xOverlap < yOverlap ||
        Math.abs(dx) > Math.abs(dy) ||
        (rawXOverlap < rawYOverlap && Math.abs(dx) >= Math.abs(dy) * 0.45);

      // Step A: Trim back excess enlargement when vertical collision threatens balloon centering
      // or after initial gentle horizontal nudges (iter >= 6)
      const rawCxA = rawA.x + rawA.width / 2;
      const rawCyA = rawA.y + rawA.height / 2;
      const rawCxB = rawB.x + rawB.width / 2;
      const rawCyB = rawB.y + rawB.height / 2;
      const driftXExceeded =
        Math.abs(cAx - rawCxA) > Math.max(18, rawA.width * 0.18) ||
        Math.abs(cBx - rawCxB) > Math.max(18, rawB.width * 0.18);
      const driftYExceeded =
        Math.abs(cAy - rawCyA) > Math.max(14, rawA.height * 0.12) ||
        Math.abs(cBy - rawCyB) > Math.max(14, rawB.height * 0.12);

      if (preferHorizontal && (iter >= 6 || driftXExceeded)) {
        const trimFloorWA = Math.max(rawA.width, readableFloorW);
        const trimFloorWB = Math.max(rawB.width, readableFloorW);
        const excessWA = !aFixed ? Math.max(0, rA.width - trimFloorWA) : 0;
        const excessWB = !bFixed ? Math.max(0, rB.width - trimFloorWB) : 0;
        if (excessWA + excessWB > 2) {
          const trimTotal = Math.min(xOverlap + 2, excessWA + excessWB);
          const trimA = excessWA > 0 ? Math.min(excessWA, Math.ceil(trimTotal * (excessWA / (excessWA + excessWB)))) : 0;
          const trimB = excessWB > 0 ? Math.min(excessWB, Math.ceil(trimTotal - trimA)) : 0;
          rA.width -= trimA;
          rA.x = cAx - rA.width / 2;
          rB.width -= trimB;
          rB.x = cBx - rB.width / 2;
        }
      } else if (!preferHorizontal && (iter >= 2 || driftYExceeded)) {
        const excessHA = !aFixed ? Math.max(0, rA.height - rawA.height) : 0;
        const excessHB = !bFixed ? Math.max(0, rB.height - rawB.height) : 0;
        if (excessHA + excessHB > 2) {
          const trimTotal = Math.min(yOverlap + 2, excessHA + excessHB);
          const trimA = excessHA > 0 ? Math.min(excessHA, Math.ceil(trimTotal * (excessHA / (excessHA + excessHB)))) : 0;
          const trimB = excessHB > 0 ? Math.min(excessHB, Math.ceil(trimTotal - trimA)) : 0;
          rA.height -= trimA;
          rA.y = cAy - rA.height / 2;
          rB.height -= trimB;
          rB.y = cBy - rB.height / 2;
        }
      }

      // Recompute overlaps after trimming excess enlargement
      xOverlap = Math.min(rA.x + rA.width, rB.x + rB.width) - Math.max(rA.x, rB.x) + 2;
      yOverlap = Math.min(rA.y + rA.height, rB.y + rB.height) - Math.max(rA.y, rB.y) + 2;

      if (xOverlap > 0 && yOverlap > 0) {
        if (preferHorizontal) {
          const shift = Math.ceil(xOverlap / 2) + 1;
          if (dx >= 0) {
            if (!aFixed) rA.x = Math.max(0, rA.x - shift * multA);
            if (!bFixed) rB.x = Math.min(iw - rB.width, rB.x + shift * multB);
          } else {
            if (!aFixed) rA.x = Math.min(iw - rA.width, rA.x + shift * multA);
            if (!bFixed) rB.x = Math.max(0, rB.x - shift * multB);
          }
        } else {
          const shift = Math.ceil(yOverlap / 2) + 1;
          if (dy >= 0) {
            if (!aFixed) rA.y = Math.max(0, rA.y - shift * multA);
            if (!bFixed) rB.y = Math.min(ih - rB.height, rB.y + shift * multB);
          } else {
            if (!aFixed) rA.y = Math.min(ih - rA.height, rA.y + shift * multA);
            if (!bFixed) rB.y = Math.max(0, rB.y - shift * multB);
          }
        }
      }

      // If at borders and still overlapping, scale non-fixed boxes down slightly,
      // but NEVER below the readable floor width.
      if (iter > 22) {
        const shrinkFactor = 0.96;
        const minWA = Math.max(readableFloorW, Math.round(rawA.width * 0.92));
        const minHA = Math.max(50, Math.round(rawA.height * 0.82));
        const minWB = Math.max(readableFloorW, Math.round(rawB.width * 0.92));
        const minHB = Math.max(50, Math.round(rawB.height * 0.82));
        if (!aFixed) {
          rA.width = Math.max(minWA, Math.round(rA.width * shrinkFactor));
          rA.height = Math.max(minHA, Math.round(rA.height * shrinkFactor));
        }
        if (!bFixed) {
          rB.width = Math.max(minWB, Math.round(rB.width * shrinkFactor));
          rB.height = Math.max(minHB, Math.round(rB.height * shrinkFactor));
        }
      }

      // Clamp within image bounds and apply adjustments
      if (!aFixed) {
        rA.x = Math.max(0, Math.min(iw - rA.width, Math.round(rA.x)));
        rA.y = Math.max(0, Math.min(ih - rA.height, Math.round(rA.y)));
        active[idxA].layoutAdjustment = {
          bx: rA.x,
          by: rA.y,
          bw: rA.width,
          bh: rA.height,
          iw,
          ih,
          rotation: active[idxA].layoutAdjustment?.rotation ?? (active[idxA].rotation as number) ?? 0,
          targetFontSize: active[idxA].targetFontSize,
          fontSizeMultiplier: active[idxA].fontSizeMultiplier,
          isAutoOptimized: true,
          autoOptimizeVersion: AUTO_OPTIMIZE_VERSION,
        };
      }

      if (!bFixed) {
        rB.x = Math.max(0, Math.min(iw - rB.width, Math.round(rB.x)));
        rB.y = Math.max(0, Math.min(ih - rB.height, Math.round(rB.y)));
        active[idxB].layoutAdjustment = {
          bx: rB.x,
          by: rB.y,
          bw: rB.width,
          bh: rB.height,
          iw,
          ih,
          rotation: active[idxB].layoutAdjustment?.rotation ?? (active[idxB].rotation as number) ?? 0,
          targetFontSize: active[idxB].targetFontSize,
          fontSizeMultiplier: active[idxB].fontSizeMultiplier,
          isAutoOptimized: true,
          autoOptimizeVersion: AUTO_OPTIMIZE_VERSION,
        };
      }
    }
  }

  return active;
}

/**
 * Master automated organizer:
 * 1. Fits each bubble strictly to its bounds with neighbor-aware width/height capping and font scaling.
 * 2. Resolves collisions between overlapping bubbles (trimming excess enlargement first).
 * 3. Re-fits font size inside any frames that were shifted or shrunk during collision resolution.
 * 4. Harmonizes font sizes across adjacent cluster bubbles so neighboring lobes look balanced.
 */
export function autoOrganizePageBubbles(
  bubbles: TranslatedBubble[],
  iw: number,
  ih: number,
  options?: AutoOrganizeOptions,
): AutoOrganizeResult {
  if (!bubbles || bubbles.length === 0 || !iw || !ih) {
    return {
      optimizedBubbles: bubbles,
      adjustedCount: 0,
      resolvedCollisionCount: 0,
      unresolvedCollisionCount: 0,
    };
  }

  const hasCorrupted = bubbles.some(
    (b) => b && !b.deleted && isCorruptedAutoAdjustment(b, iw, ih),
  );
  const initialCollisions = detectBubbleCollisions(bubbles, iw, ih);
  const rawRects = bubbles.map((b) => getBubbleGeometry(b, iw, ih, true));

  // Step 1: Fit each bubble within its detected bounds (respecting neighbor width/height limits)
  let working = bubbles.map((b, idx) => {
    if (b.deleted || !(b.t || b.translated || "").trim()) return b;
    // If user explicitly modified this bubble manually, strictly preserve it unless overrideUserModified is set!
    if (b.layoutAdjustment?.userModified && !options?.overrideUserModified) {
      return b;
    }
    const corrupted = isCorruptedAutoAdjustment(b, iw, ih);
    // If already adjusted and forceRealign is false and no collisions/corruption exist, preserve
    if (b.layoutAdjustment && !corrupted && !options?.forceRealign && !options?.overrideUserModified && initialCollisions.length === 0 && !hasCorrupted) {
      return b;
    }
    const maxAllowedWidth = computeNeighborMaxWidth(idx, rawRects, iw);
    const maxAllowedHeight = computeNeighborMaxHeight(idx, rawRects, ih);
    return fitBubbleTextWithinBounds(b, iw, ih, {
      ...options,
      maxAllowedWidth,
      maxAllowedHeight,
      forceRealign: Boolean(options?.forceRealign || options?.overrideUserModified || initialCollisions.length > 0 || corrupted || hasCorrupted),
    });
  });

  // Step 2: Resolve collisions if any exist
  const postFitCollisions = detectBubbleCollisions(working, iw, ih);
  let resolvedCollisionCount = 0;

  if (postFitCollisions.length > 0) {
    working = resolveBubbleCollisions(working, iw, ih, options);
    const remaining = detectBubbleCollisions(working, iw, ih);
    resolvedCollisionCount = postFitCollisions.length - remaining.length;

    // Step 3: Re-verify font fit strictly within collision-resolved boxes (never re-expand bw/bh)
    working = working.map((b) => {
      if (b.deleted || !(b.t || b.translated || "").trim()) return b;
      if (b.layoutAdjustment?.userModified) return b;
      return refitFontInResolvedBox(b, iw, ih, options);
    });
  }

  // Step 4: Harmonize font sizes across adjacent cluster bubbles for visual consistency
  working = harmonizeClusterFontSizes(working, iw, ih, options);

  const finalCollisions = detectBubbleCollisions(working, iw, ih);

  // Count how many bubbles received new/modified adjustments
  let adjustedCount = 0;
  for (let i = 0; i < working.length; i++) {
    const original = bubbles[i];
    const current = working[i];
    if (
      current.targetFontSize !== original.targetFontSize ||
      current.layoutAdjustment?.bx !== original.layoutAdjustment?.bx ||
      current.layoutAdjustment?.by !== original.layoutAdjustment?.by ||
      current.layoutAdjustment?.bw !== original.layoutAdjustment?.bw ||
      current.layoutAdjustment?.bh !== original.layoutAdjustment?.bh
    ) {
      adjustedCount++;
    }
  }

  return {
    optimizedBubbles: working,
    adjustedCount,
    resolvedCollisionCount: Math.max(0, resolvedCollisionCount),
    unresolvedCollisionCount: finalCollisions.length,
  };
}

export interface PageToOrganize {
  pageUrl: string;
  bubbles: TranslatedBubble[];
  width?: number;
  height?: number;
}

export interface AutoOrganizeAllPagesResult {
  pageResults: Map<string, TranslatedBubble[]>;
  totalAdjustedCount: number;
  totalResolvedCollisions: number;
}

/**
 * Iterates across multiple pages in a book, organizing bubbles on each page
 * while strictly preserving manual user edits.
 */
export function autoOrganizeAllPagesBubbles(
  pages: PageToOrganize[],
  options?: AutoOrganizeOptions,
): AutoOrganizeAllPagesResult {
  const pageResults = new Map<string, TranslatedBubble[]>();
  let totalAdjustedCount = 0;
  let totalResolvedCollisions = 0;

  for (const p of pages) {
    const iw = p.width || 1200;
    const ih = p.height || 1800;
    const res = autoOrganizePageBubbles(p.bubbles, iw, ih, options);
    pageResults.set(p.pageUrl, res.optimizedBubbles);
    totalAdjustedCount += res.adjustedCount;
    totalResolvedCollisions += res.resolvedCollisionCount;
  }

  return {
    pageResults,
    totalAdjustedCount,
    totalResolvedCollisions,
  };
}

