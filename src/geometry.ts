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
