/**
 * The seam for adding sensor kinds. A driver turns Home Assistant state into
 * target positions in the sensor's own frame; the card handles placing them
 * on the map. To add one (e.g. Bermuda), implement this interface and list it
 * in registry.ts.
 */
import type { SensorConfig, TargetConfig } from "../config.js";
import type { Hass, Point } from "../types.js";

export interface SensorDriver {
  type: string;
  /** Shown in the editor. */
  label: string;
  /** Detection wedge drawn when `show_fov` is on. */
  fov?: { halfAngle: number; range: number };
  /** The targets to draw, one dot each: configured ones, else discovered. */
  targets(hass: Hass | undefined, sensor: SensorConfig): TargetConfig[];
  /** One target's position in the sensor's frame (metres), or null if absent. */
  read(hass: Hass, target: TargetConfig): Point | null;
  /** Find a device's target entities, so users only have to pick the device. */
  discover?(hass: Hass, deviceId: string): TargetConfig[];
}
