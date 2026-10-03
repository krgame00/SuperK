export interface SelectionRect { x: number; y: number; width: number; height: number }

/** Bounds in canvas source pixels, using the same center/middle text alignment as the renderer. */
export function measureTextSelection(
  context: CanvasRenderingContext2D, lines: string[], fontSize: number,
  lineHeight: number, width: number, height: number,
): SelectionRect {
  const full = { x: 0, y: 0, width, height };
  if (!lines.some(line => line.trim()) || !(width > 0 && height > 0)) return full;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const startY = height / 2 - (lines.length - 1) * lineHeight / 2;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const metrics = context.measureText(line);
    const finite = (value: number) => typeof value === "number" && Number.isFinite(value);
    const hasHorizontal = finite(metrics.actualBoundingBoxLeft) && finite(metrics.actualBoundingBoxRight);
    const hasVertical = finite(metrics.actualBoundingBoxAscent) && finite(metrics.actualBoundingBoxDescent);
    if (!hasHorizontal && !finite(metrics.width)) return full;
    const y = startY + index * lineHeight;
    left = Math.min(left, width / 2 - (hasHorizontal ? metrics.actualBoundingBoxLeft : metrics.width / 2));
    right = Math.max(right, width / 2 + (hasHorizontal ? metrics.actualBoundingBoxRight : metrics.width / 2));
    top = Math.min(top, y - (hasVertical ? metrics.actualBoundingBoxAscent : fontSize * .8));
    bottom = Math.max(bottom, y + (hasVertical ? metrics.actualBoundingBoxDescent : fontSize * .4));
  }
  // A conservative blur envelope plus the stroke keeps effects inside the frame.
  const stroke = context.lineWidth > 0 ? context.lineWidth / 2 : 0;
  const shadow = context.shadowColor !== "rgba(0,0,0,0)" && context.shadowColor !== "rgba(0, 0, 0, 0)";
  const blur = shadow ? (context.shadowBlur || 0) * 2 : 0;
  const offsetX = shadow ? (context.shadowOffsetX || 0) : 0;
  const offsetY = shadow ? (context.shadowOffsetY || 0) : 0;
  const pad = 3 + stroke;
  const x = Math.max(0, left - pad - blur + Math.min(0, offsetX));
  const y = Math.max(0, top - pad - blur + Math.min(0, offsetY));
  const r = Math.min(width, right + pad + blur + Math.max(0, offsetX));
  const b = Math.min(height, bottom + pad + blur + Math.max(0, offsetY));
  return r > x && b > y ? { x, y, width: r - x, height: b - y } : full;
}

export function rotateLocalPoint(x: number, y: number, width: number, height: number, degrees: number) {
  const angle = degrees * Math.PI / 180;
  const dx = x - width / 2, dy = y - height / 2;
  return { x: width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) };
}
