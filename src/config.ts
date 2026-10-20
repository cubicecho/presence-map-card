/**
 * Card configuration: the shape users write in YAML (or the editor writes for
 * them), and `normalizeConfig`, which validates it and fills in defaults.
 *
 * All lengths are metres. The map's y axis points down the screen, like a
 * floor plan drawn on paper.
 */
import { isSensorType } from "./sensors/registry.js";

/** One tracked target: the entities reporting its x and y. */
export interface TargetConfig {
  x: string;
  y: string;
}

export interface SensorConfig {
  /** Which sensor driver reads this sensor. Only "ld2450" exists today. */
  type: string;
  /** Device the targets were discovered from (lets the card auto-find them). */
  device?: string;
  name?: string;
  /** Position relative to the area's origin. */
  x: number;
  y: number;
  /**
   * Which way the sensor faces, in degrees clockwise.
   * 0 = down the map (+y), 90 = left, 180 = up, 270 = right.
   */
  rotation: number;
  /** Mirror the sensor's own x axis (for sensors mounted upside down). */
  flip_x: boolean;
  color?: string;
  targets: TargetConfig[];
}

export interface AreaConfig {
  /** Home Assistant area id. */
  area: string;
  /** Label override; defaults to the area's name. */
  name?: string;
  /** Origin of the box on the map. */
  x: number;
  y: number;
  /** Extent of the box. */
  width: number;
  height: number;
  sensors: SensorConfig[];
}

/**
 * A device tracked at area level (which room, not where in it). Drawn as a
 * hollow dot beside its area's name and listed in the legend.
 */
export interface TrackerConfig {
  /** Only "bermuda" exists today. */
  type: string;
  /** Bermuda device; its `sensor.*_area` entity is found automatically. */
  device?: string;
  /** The Area sensor to read, when not using `device` (or to override it). */
  entity?: string;
  name?: string;
  color?: string;
}

export const TRACKER_TYPES = ["bermuda"];

export interface CardConfig {
  type: string;
  title?: string;
  /** Hide targets that fall outside their sensor's area (ghost readings). */
  hide_outside_area: boolean;
  /** Draw each sensor's field of view. */
  show_fov: boolean;
  /** Show the tracker legend under the map. */
  show_legend: boolean;
  areas: AreaConfig[];
  trackers: TrackerConfig[];
}

export const DEFAULT_AREA_SIZE = { width: 4, height: 3 };

function num(value: unknown, fallback: number, path: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!isFinite(n)) throw new Error(`${path} must be a number (got ${JSON.stringify(value)})`);
  return n;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function normalizeTargets(raw: unknown): TargetConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: TargetConfig[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const x = str((t as Record<string, unknown>).x);
    const y = str((t as Record<string, unknown>).y);
    // Half-filled pairs are skipped rather than rejected so the editor can
    // save while the user is still picking entities.
    if (x && y) out.push({ x, y });
  }
  return out;
}

function normalizeSensor(raw: unknown, path: string): SensorConfig {
  if (!raw || typeof raw !== "object") throw new Error(`${path} must be an object`);
  const s = raw as Record<string, unknown>;
  const type = str(s.type) || "ld2450";
  if (!isSensorType(type)) throw new Error(`${path}.type "${type}" is not supported`);
  return {
    type,
    device: str(s.device),
    name: str(s.name),
    x: num(s.x, 0, `${path}.x`),
    y: num(s.y, 0, `${path}.y`),
    rotation: num(s.rotation, 0, `${path}.rotation`),
    flip_x: s.flip_x === true,
    color: str(s.color),
    targets: normalizeTargets(s.targets),
  };
}

function normalizeArea(raw: unknown, path: string): AreaConfig {
  if (!raw || typeof raw !== "object") throw new Error(`${path} must be an object`);
  const a = raw as Record<string, unknown>;
  const area = str(a.area);
  if (!area) throw new Error(`${path}.area is required`);
  const width = num(a.width, DEFAULT_AREA_SIZE.width, `${path}.width`);
  const height = num(a.height, DEFAULT_AREA_SIZE.height, `${path}.height`);
  if (width <= 0 || height <= 0) throw new Error(`${path} width and height must be above 0`);
  const sensors = Array.isArray(a.sensors) ? a.sensors : [];
  return {
    area,
    name: str(a.name),
    x: num(a.x, 0, `${path}.x`),
    y: num(a.y, 0, `${path}.y`),
    width,
    height,
    sensors: sensors.map((s, i) => normalizeSensor(s, `${path}.sensors[${i}]`)),
  };
}

function normalizeTracker(raw: unknown, path: string): TrackerConfig {
  if (!raw || typeof raw !== "object") throw new Error(`${path} must be an object`);
  const t = raw as Record<string, unknown>;
  const type = str(t.type) || "bermuda";
  if (TRACKER_TYPES.indexOf(type) === -1) throw new Error(`${path}.type "${type}" is not supported`);
  // Neither device nor entity is allowed: the editor saves while the user
  // is still picking. Such a tracker just shows as "No sensor".
  return { type, device: str(t.device), entity: str(t.entity), name: str(t.name), color: str(t.color) };
}

export function normalizeConfig(raw: unknown): CardConfig {
  if (!raw || typeof raw !== "object") throw new Error("Invalid configuration");
  const c = raw as Record<string, unknown>;
  if (c.areas !== undefined && !Array.isArray(c.areas)) throw new Error("areas must be a list");
  if (c.trackers !== undefined && !Array.isArray(c.trackers)) throw new Error("trackers must be a list");
  const areas = (c.areas as unknown[] | undefined) || [];
  const trackers = (c.trackers as unknown[] | undefined) || [];
  return {
    type: String(c.type || ""),
    title: str(c.title),
    hide_outside_area: c.hide_outside_area !== false,
    show_fov: c.show_fov !== false,
    show_legend: c.show_legend !== false,
    areas: areas.map((a, i) => normalizeArea(a, `areas[${i}]`)),
    trackers: trackers.map((t, i) => normalizeTracker(t, `trackers[${i}]`)),
  };
}
