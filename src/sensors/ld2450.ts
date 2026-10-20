/**
 * HLK-LD2450 mmWave radar, as exposed by ESPHome's `ld2450` component: up to
 * three targets, each with `target_N_x` / `target_N_y` sensors in millimetres.
 * The radar looks along +y; x is lateral (roughly ±6 m), y is distance.
 * A target that is not present reports 0,0.
 */
import type { SensorConfig, TargetConfig } from "../config.js";
import type { Hass, Point } from "../types.js";
import type { SensorDriver } from "./driver.js";

/** Matches `..._target_1_x`, `..._target1_y`, `..._target_2_x_coordinate`. */
const TARGET_ENTITY = /^sensor\..*target[_]?(\d+)_(x|y)(?:_coordinate)?$/;

/** Metres per unit of the entity's reported unit. ESPHome uses mm. */
export function unitScale(unit: unknown): number {
  switch (typeof unit === "string" ? unit.trim().toLowerCase() : "") {
    case "m":
      return 1;
    case "cm":
      return 0.01;
    case "in":
      return 0.0254;
    case "ft":
      return 0.3048;
    default:
      return 0.001;
  }
}

function readMetres(hass: Hass, entityId: string): number | null {
  const st = hass.states[entityId];
  if (!st) return null;
  const n = parseFloat(st.state);
  if (!isFinite(n)) return null;
  return n * unitScale(st.attributes.unit_of_measurement);
}

export function discoverLd2450Targets(hass: Hass, deviceId: string): TargetConfig[] {
  const found: Record<string, { x?: string; y?: string }> = {};
  const entries = hass.entities || {};
  for (const id of Object.keys(entries)) {
    const entry = entries[id];
    if (!entry || entry.device_id !== deviceId) continue;
    const m = TARGET_ENTITY.exec(id);
    if (!m) continue;
    const slot = (found[m[1]!] = found[m[1]!] || {});
    slot[m[2] as "x" | "y"] = id;
  }
  return Object.keys(found)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => found[k]!)
    .filter((t): t is TargetConfig => !!t.x && !!t.y);
}

export const ld2450: SensorDriver = {
  type: "ld2450",
  label: "LD2450 mmWave radar",
  fov: { halfAngle: 60, range: 6 },
  targets(hass, sensor: SensorConfig) {
    if (sensor.targets.length) return sensor.targets;
    if (hass && sensor.device) return discoverLd2450Targets(hass, sensor.device);
    return [];
  },
  read(hass, target): Point | null {
    const x = readMetres(hass, target.x);
    const y = readMetres(hass, target.y);
    if (x === null || y === null) return null;
    if (x === 0 && y === 0) return null;
    return { x, y };
  },
  discover: discoverLd2450Targets,
};
