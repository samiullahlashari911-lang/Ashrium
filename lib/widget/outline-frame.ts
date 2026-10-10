import type { CaptureOutline } from '@/lib/widget/capture-outlines';
import type { OutlineFrame } from '@/lib/widget/pose-gates';

/**
 * The traced body sits this far inside the drawn stroke (OUTLINE_OFFSET_PX 9
 * at RENDER_HEIGHT_PX 1400 in gpu/tools/build_outlines.py), in viewBox units.
 */
const OUTLINE_INSET = (9 / 1400) * 1000;

export interface OutlineBodyBounds {
  viewBoxWidth: number;
  viewBoxHeight: number;
  /** Crown, soles and torso centre line, in viewBox units. */
  top: number;
  bottom: number;
  centerX: number;
}

/**
 * The generator writes absolute `M`/`C` commands only, so every number pair is
 * a point. Side outlines are padded to centre the torso and front outlines are
 * cropped symmetrically, so the torso centre is the viewBox centre.
 */
export function outlineBodyBounds(outline: CaptureOutline): OutlineBodyBounds {
  const [, , viewBoxWidth, viewBoxHeight] = outline.viewBox.split(/\s+/).map(Number);
  const numbers = outline.path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  let top = Infinity;
  let bottom = -Infinity;
  for (let index = 1; index < numbers.length; index += 2) {
    top = Math.min(top, numbers[index]);
    bottom = Math.max(bottom, numbers[index]);
  }
  return {
    viewBoxWidth,
    viewBoxHeight,
    top: top + OUTLINE_INSET,
    bottom: bottom - OUTLINE_INSET,
    centerX: viewBoxWidth / 2,
  };
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The outline body in view coordinates (0-1 of `view`), given where the SVG
 * element is laid out. The SVG uses `preserveAspectRatio="xMidYMid meet"`.
 */
export function outlineFrameInView(bounds: OutlineBodyBounds, svg: Rect, view: Rect): OutlineFrame | null {
  if (view.width <= 0 || view.height <= 0 || svg.width <= 0 || svg.height <= 0) {
    return null;
  }
  const scale = Math.min(svg.width / bounds.viewBoxWidth, svg.height / bounds.viewBoxHeight);
  const left = svg.left + (svg.width - bounds.viewBoxWidth * scale) / 2 - view.left;
  const top = svg.top + (svg.height - bounds.viewBoxHeight * scale) / 2 - view.top;
  return {
    top: (top + bounds.top * scale) / view.height,
    bottom: (top + bounds.bottom * scale) / view.height,
    centerX: (left + bounds.centerX * scale) / view.width,
  };
}
