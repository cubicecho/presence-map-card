/**
 * Bermuda BLE Trilateration, used for area-level presence: which area a
 * tracked device is in, not where in the area. Each Bermuda device has a
 * `sensor.<device>_area` entity whose state is the area name and whose
 * `area_id` attribute is the Home Assistant area id.
 *
 * When Bermuda gains real x,y positions, those belong in a sensor driver
 * (src/sensors/) instead.
 */
import type { TrackerConfig } from "../config.js";
import type { Hass } from "../types.js";

/** The device's "Area" sensor: `sensor.*_area`, not `_area_last_seen` etc. */
const AREA_ENTITY = /^sensor\..+_area$/;

export function discoverBermudaAreaEntity(hass: Hass, deviceId: string): string | undefined {
  const entries = hass.entities || {};
  for (const id of Object.keys(entries)) {
    const entry = entries[id];
    if (entry && entry.device_id === deviceId && AREA_ENTITY.test(id)) return id;
  }
  return undefined;
}

/** The Area sensor this tracker reads: configured, else found on its device. */
export function trackerEntity(hass: Hass | undefined, tracker: TrackerConfig): string | undefined {
  if (tracker.entity) return tracker.entity;
  if (hass && tracker.device) return discoverBermudaAreaEntity(hass, tracker.device);
  return undefined;
}

export interface TrackerLocation {
  /** HA area id, when the device is in a known area. */
  areaId?: string;
  /** Text for the legend: the area name, or why there is none. */
  label: string;
}

const NOT_HOME = ["unknown", "unavailable", "not_home", "none", ""];

export function trackerLocation(hass: Hass, tracker: TrackerConfig): TrackerLocation {
  const id = trackerEntity(hass, tracker);
  const st = id ? hass.states[id] : undefined;
  if (!st) return { label: id ? "Unavailable" : "No sensor" };

  const state = String(st.state || "").trim();
  if (NOT_HOME.indexOf(state.toLowerCase()) !== -1) {
    return { label: state.toLowerCase() === "unavailable" ? "Unavailable" : "Away" };
  }

  const attrId = st.attributes.area_id;
  if (typeof attrId === "string" && attrId) return { areaId: attrId, label: state };

  // Older Bermuda versions only report the name; match it to an HA area.
  const areas = hass.areas || {};
  const lower = state.toLowerCase();
  for (const key of Object.keys(areas)) {
    const a = areas[key]!;
    if (a.area_id === state || a.name.toLowerCase() === lower) return { areaId: a.area_id, label: a.name };
  }
  return { label: state };
}

/** Display name: configured, device name, or the sensor's name minus " Area". */
export function trackerName(hass: Hass | undefined, tracker: TrackerConfig): string {
  if (tracker.name) return tracker.name;
  const device = hass && tracker.device && hass.devices ? hass.devices[tracker.device] : undefined;
  if (device && (device.name_by_user || device.name)) return String(device.name_by_user || device.name);
  const id = trackerEntity(hass, tracker);
  const st = id && hass ? hass.states[id] : undefined;
  const friendly = st && st.attributes.friendly_name;
  if (typeof friendly === "string" && friendly) return friendly.replace(/\s+area$/i, "");
  return id || "Tracker";
}
