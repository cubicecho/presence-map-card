/**
 * Coordinate maths. Three frames are involved:
 *
 *   sensor frame: what the sensor reports; it looks along its own +y axis
 *   area frame:   sensor frame rotated by `rotation`, offset by the sensor's x,y
 *   map frame:    area frame offset by the area's origin
 */
import type { AreaConfig, SensorConfig } from "./config.js";
import type { Point } from "./types.js";

/** Convert a point in the sensor's own frame to map coordinates. */
export function sensorToMap(area: AreaConfig, sensor: SensorConfig, local: Point): Point {
  const lx = sensor.flip_x ? -local.x : local.x;
  const rad = (sensor.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // With y pointing down the screen this matrix turns clockwise.
  return {
    x: area.x + sensor.x + lx * cos - local.y * sin,
    y: area.y + sensor.y + lx * sin + local.y * cos,
  };
}

/** Where the sensor itself sits on the map. */
export function sensorOrigin(area: AreaConfig, sensor: SensorConfig): Point {
  return { x: area.x + sensor.x, y: area.y + sensor.y };
}

export function insideArea(area: AreaConfig, p: Point, tolerance = 0.05): boolean {
  return (
    p.x >= area.x - tolerance &&
    p.x <= area.x + area.width + tolerance &&
    p.y >= area.y - tolerance &&
    p.y <= area.y + area.height + tolerance
  );
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of every area, or null when there are none. */
export function mapBounds(areas: AreaConfig[]): Bounds | null {
  if (!areas.length) return null;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const a of areas) {
    b.minX = Math.min(b.minX, a.x);
    b.minY = Math.min(b.minY, a.y);
    b.maxX = Math.max(b.maxX, a.x + a.width);
    b.maxY = Math.max(b.maxY, a.y + a.height);
  }
  return b;
}

/** SVG path for a field-of-view wedge, in map coordinates. */
export function fovPath(
  area: AreaConfig,
  sensor: SensorConfig,
  halfAngleDeg: number,
  range: number,
): string {
  const at = (deg: number): Point => {
    const r = (deg * Math.PI) / 180;
    // flip_x is a mirror, so the wedge stays symmetric either way.
    return sensorToMap(area, { ...sensor, flip_x: false }, {
      x: range * Math.sin(r),
      y: range * Math.cos(r),
    });
  };
  const o = sensorOrigin(area, sensor);
  const a = at(-halfAngleDeg);
  const b = at(halfAngleDeg);
  const f = (n: number) => n.toFixed(3);
  // Sweep flag 0: from -angle to +angle runs counter-clockwise on screen.
  return `M${f(o.x)} ${f(o.y)} L${f(a.x)} ${f(a.y)} A${f(range)} ${f(range)} 0 0 0 ${f(b.x)} ${f(b.y)} Z`;
}

/** Even-odd ray cast: is `p` inside the ring? */
export function pointInRing(p: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance from `p` to the ring's edge. */
export function distanceToRing(p: Point, ring: Point[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, distanceToSegment(p, ring[j]!, ring[i]!));
  }
  return best;
}

/**
 * Inside an outline (any piece), or within `tolerance` of its edge. Vacuum
 * outlines stop short of walls and doorways, hence the 10 cm default.
 */
export function insidePolygons(rings: Point[][], p: Point, tolerance = 0.1): boolean {
  for (const ring of rings) {
    if (pointInRing(p, ring) || distanceToRing(p, ring) <= tolerance) return true;
  }
  return false;
}

/** SVG path data for one or more closed rings. */
export function ringsPath(rings: Point[][]): string {
  const f = (n: number) => n.toFixed(3);
  return rings
    .filter((r) => r.length >= 3)
    .map((r) => "M" + r.map((p) => `${f(p.x)} ${f(p.y)}`).join(" L") + " Z")
    .join(" ");
}

/** Bounding box of rings, merged into `into` (or a new one). */
export function extendBounds(into: Bounds | null, rings: Point[][]): Bounds | null {
  let b = into;
  for (const ring of rings) {
    for (const p of ring) {
      if (!b) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  return b;
}
