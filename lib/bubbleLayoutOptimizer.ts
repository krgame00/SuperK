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
}

export interface AutoOrganizeResult {
  optimizedBubbles: TranslatedBubble[];
  adjustedCount: number;
  resolvedCollisionCount: number;
  unresolvedCollisionCount: number;
}

/**
 * Detects whether a non-user-modified layoutAdjustment was corrupted (e.g. crushed into a narrow
 * strip < 52px or teleported far from its canonical box center by the prior id-less collision bug).
 */
export function isCorruptedAutoAdjustment(
  b: TranslatedBubble,
  iw: number,
  ih: number,
  adjOverride?: OverlayAdjustment,
): boolean {
  const adj = adjOverride ?? b.layoutAdjustment;
  if (!adj || adj.userModified || !adj.isAutoOptimized) return false;
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
 * double/triple speech balloon do not expand into each other and get shoved outside the balloon.
 */
function computeNeighborMaxWidth(
  targetIdx: number,
  rawRects: BubbleRect[],
  iw: number,
): number | undefined {
  const rA = rawRects[targetIdx];
  if (!rA) return undefined;
  const cxA = rA.x + rA.width / 2;
  let minCap: number | undefined;

  for (let j = 0; j < rawRects.length; j++) {
    if (j === targetIdx) continue;
    const rB = rawRects[j];
    const vOverlap = Math.min(rA.y + rA.height, rB.y + rB.height) - Math.max(rA.y, rB.y);
    const minH = Math.min(rA.height, rB.height);
    if (vOverlap <= minH * 0.20) continue;

    const cxB = rB.x + rB.width / 2;
    const dx = Math.abs(cxB - cxA);
    if (dx > 8 && dx < iw * 0.25) {
      // Allow moderate lobe expansion while preventing 600px-tall boxes from ballooning to 400px width
      const cap = Math.max(Math.round(rA.width * 1.85), Math.round(dx * 1.68));
      minCap = minCap === undefined ? cap : Math.min(minCap, cap);
    }
  }

  return minCap;
}

/**
 * Fits translated text cleanly inside the original bubble bounds by stepping down
 * font size rather than expanding the bubble to 2.5x-3.0x.
 */
export function fitBubbleTextWithinBounds(
  bubble: TranslatedBubble,
  iw: number,
  ih: number,
  options?: AutoOrganizeOptions,
): TranslatedBubble {
  const text = (bubble.t || bubble.translated || "").trim();
  if (!text) return bubble;
  if (bubble.layoutAdjustment?.userModified) return bubble;

  // Always derive from canonical raw box when forceRealign is requested, when
  // previous adjustment was auto-generated, or when previous adjustment was corrupted.
  const ignorePrevAdjustment = Boolean(
    options?.forceRealign ||
    bubble.layoutAdjustment?.isAutoOptimized ||
    isCorruptedAutoAdjustment(bubble, iw, ih),
  );
  const geom = getBubbleGeometry(bubble, iw, ih, ignorePrevAdjustment);
  const fontFamily = options?.fontFamily || "Itim, sans-serif";
  const locale = options?.locale || "th";
  const globalMult = options?.fontSizeMultiplier || 1.0;
  const bubbleMult = typeof bubble.fontSizeMultiplier === "number" ? bubble.fontSizeMultiplier : 1.0;
  const multiplier = globalMult * bubbleMult;

  // True manga readable floor: e.g. 13px on small screens, 15px-16px on 1280px, 18px-20px on 1600px+
  const minFs = options?.minFontSize ?? Math.max(13, Math.round(iw * 0.0115));
  const isOval = !bubble.isInvalidBox;
  const maxAllowedW = options?.maxAllowedWidth ?? Math.round(iw * 0.36);

  // 1. Aspect ratio adaptation for vertical Japanese text boxes:
  let curW = geom.width;
  let curH = geom.height;
  const aspectRatio = geom.width / Math.max(1, geom.height);

  // If this box is a narrow vertical slot:
  const isNarrowVertical = aspectRatio < 0.70 && !bubble.isInvalidBox;
  if (isNarrowVertical) {
    const area = geom.width * geom.height;
    const desiredW = Math.max(
      geom.width,
      Math.min(
        iw * 0.32,
        Math.round(geom.width * 2.15),
        Math.max(
          Math.round(geom.height * 0.68),
          Math.round(Math.sqrt(area * 0.95)),
        ),
      ),
    );
    curW = Math.max(geom.width, Math.min(maxAllowedW, desiredW));
    curH = Math.max(Math.round(geom.height * 0.85), Math.min(geom.height, Math.round(area / Math.max(1, curW))));
  }

  // 2. Initial fit attempt within adapted balloon bounds
  let fit = fitTextForBubble(
    text,
    curW,
    curH,
    fontFamily,
    isOval,
    multiplier,
    minFs,
    locale,
  );

  let finalWidth = curW;
  let finalHeight = curH;
  let targetFontSize = fit.fontSize;

  // 3. If text couldn't fit even at minFs, allow controlled expansion capped by maxAllowedW
  if (!fit.fits) {
    const maxEnlarge = options?.maxEnlargeRatio ?? 1.35;
    const enlargedW = Math.max(
      curW,
      Math.min(maxAllowedW, Math.round(iw * 0.36), Math.round(curW * maxEnlarge)),
    );
    const enlargedH = Math.min(Math.round(ih * 0.38), Math.round(curH * Math.min(1.25, maxEnlarge)));
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

  // 4. Synchronize height & font size with layoutBubbleAtFixedFont so applyTranslationOverlay
  // never expands currentBh or flags layoutOverflow at render time.
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

  // First step down down to minFs
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
    const snugH = Math.max(
      Math.round(geom.height * 0.55),
      Math.min(finalHeight, Math.max(Math.ceil(textH * 1.30), fixedRenderLayout.requiredHeightPx)),
    );
    finalHeight = Math.max(snugH, Math.min(finalHeight, fixedRenderLayout.requiredHeightPx));
  } else if (fixedRenderLayout.requiredHeightPx > finalHeight) {
    finalHeight = Math.min(Math.round(ih * 0.40), Math.max(finalHeight, fixedRenderLayout.requiredHeightPx));
  }

  // If oval word-chord or vertical constraint still overflows at minFs, step down until clean fit
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
  const minFs = options?.minFontSize ?? Math.max(12, Math.round(iw * 0.011));
  const isOval = !bubble.isInvalidBox;

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
  let targetFontSize = Math.min(bubble.targetFontSize ?? fit.fontSize, fit.fontSize);

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
    },
  };
  delete nextBubble.layoutSnapshot;
  return nextBubble;
}

/**
 * Resolves overlapping bubbles by applying repulsion separation vectors and
 * boundary clamping over iterative relaxation passes.
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
  const maxIterations = 40;

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

      const cAx = rA.x + rA.width / 2;
      const cAy = rA.y + rA.height / 2;
      const cBx = rB.x + rB.width / 2;
      const cBy = rB.y + rB.height / 2;

      const dx = cBx - cAx;
      const dy = cBy - cAy;

      const xOverlap = Math.min(rA.x + rA.width, rB.x + rB.width) - Math.max(rA.x, rB.x) + 2;
      const yOverlap = Math.min(rA.y + rA.height, rB.y + rB.height) - Math.max(rA.y, rB.y) + 2;

      if (xOverlap <= 0 || yOverlap <= 0) continue;

      const aFixed = Boolean(active[idxA].layoutAdjustment?.userModified);
      const bFixed = Boolean(active[idxB].layoutAdjustment?.userModified);
      if (aFixed && bFixed) continue;

      const multA = aFixed ? 0 : (bFixed ? 2 : 1);
      const multB = bFixed ? 0 : (aFixed ? 2 : 1);

      // Determine separation axis: separate along the axis with smaller penetration
      if (xOverlap < yOverlap || Math.abs(dx) > Math.abs(dy)) {
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

      // If at borders and still overlapping, scale non-fixed boxes down slightly,
      // but NEVER below a readable manga bubble width/height floor.
      if (iter > 10) {
        const shrinkFactor = 0.96;
        const minWA = Math.max(72, Math.round((rawRects[idxA]?.width ?? 80) * 0.82));
        const minHA = Math.max(48, Math.round((rawRects[idxA]?.height ?? 60) * 0.72));
        const minWB = Math.max(72, Math.round((rawRects[idxB]?.width ?? 80) * 0.82));
        const minHB = Math.max(48, Math.round((rawRects[idxB]?.height ?? 60) * 0.72));
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
        };
      }
    }
  }

  return active;
}

/**
 * Master automated organizer:
 * 1. Fits each bubble strictly to its bounds with neighbor-aware width capping and font scaling.
 * 2. Resolves collisions between overlapping bubbles.
 * 3. Re-fits font size inside any frames that were shifted or shrunk during collision resolution.
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

  // Step 1: Fit each bubble within its detected bounds (respecting neighbor width limits)
  let working = bubbles.map((b, idx) => {
    if (b.deleted || !(b.t || b.translated || "").trim()) return b;
    // If user explicitly modified this bubble manually, strictly preserve it!
    if (b.layoutAdjustment?.userModified) {
      return b;
    }
    const corrupted = isCorruptedAutoAdjustment(b, iw, ih);
    // If already adjusted and forceRealign is false and no collisions/corruption exist, preserve
    if (b.layoutAdjustment && !corrupted && !options?.forceRealign && initialCollisions.length === 0 && !hasCorrupted) {
      return b;
    }
    const maxAllowedWidth = computeNeighborMaxWidth(idx, rawRects, iw);
    return fitBubbleTextWithinBounds(b, iw, ih, {
      ...options,
      maxAllowedWidth,
      forceRealign: Boolean(options?.forceRealign || initialCollisions.length > 0 || corrupted || hasCorrupted),
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

