import { describe, expect, it } from "vitest";

import type { TrackerConfig } from "../src/config.js";
import {
  discoverBermudaAreaEntity,
  trackerEntity,
  trackerLocation,
  trackerName,
} from "../src/trackers/bermuda.js";
import type { Hass, HassEntity } from "../src/types.js";

function st(entity_id: string, state: string, attributes: Record<string, unknown> = {}): HassEntity {
  return { entity_id, state, last_changed: "", last_updated: "", attributes };
}

const tracker = (t: Partial<TrackerConfig>): TrackerConfig => ({ type: "bermuda", ...t });

function makeHass(states: HassEntity[] = []): Hass {
  const s: Record<string, HassEntity> = {};
  for (const e of states) s[e.entity_id] = e;
  return {
    states: s,
    areas: {
      living_room: { area_id: "living_room", name: "Living Room" },
      kitchen: { area_id: "kitchen", name: "Kitchen" },
    },
    devices: {
      phone: { id: "phone", name: "Pixel 9", name_by_user: null },
      watch: { id: "watch", name: "Watch", name_by_user: "Ben's watch" },
    },
    entities: {
      "sensor.pixel_9_area_last_seen": { entity_id: "sensor.pixel_9_area_last_seen", device_id: "phone" },
      "sensor.pixel_9_area_switch_reason": { entity_id: "sensor.pixel_9_area_switch_reason", device_id: "phone" },
      "sensor.pixel_9_distance": { entity_id: "sensor.pixel_9_distance", device_id: "phone" },
      "sensor.pixel_9_area": { entity_id: "sensor.pixel_9_area", device_id: "phone" },
      "sensor.watch_area": { entity_id: "sensor.watch_area", device_id: "watch" },
      "device_tracker.pixel_9_bermuda_tracker": { entity_id: "device_tracker.pixel_9_bermuda_tracker", device_id: "phone" },
    },
  };
}

describe("discoverBermudaAreaEntity", () => {
  it("picks the device's _area sensor", () => {
    expect(discoverBermudaAreaEntity(makeHass(), "phone")).toBe("sensor.pixel_9_area");
    expect(discoverBermudaAreaEntity(makeHass(), "watch")).toBe("sensor.watch_area");
  });

  it("ignores _area_last_seen / _area_switch_reason", () => {
    const hass = makeHass();
    delete hass.entities!["sensor.pixel_9_area"];
    expect(discoverBermudaAreaEntity(hass, "phone")).toBeUndefined();
  });

  it("returns undefined for unknown devices or no registry", () => {
    expect(discoverBermudaAreaEntity(makeHass(), "nope")).toBeUndefined();
    expect(discoverBermudaAreaEntity({ states: {} }, "phone")).toBeUndefined();
  });

  it("trackerEntity prefers the configured entity", () => {
    expect(trackerEntity(makeHass(), tracker({ device: "phone", entity: "sensor.custom" }))).toBe("sensor.custom");
    expect(trackerEntity(makeHass(), tracker({ device: "phone" }))).toBe("sensor.pixel_9_area");
    expect(trackerEntity(undefined, tracker({ device: "phone" }))).toBeUndefined();
  });
});

describe("trackerLocation", () => {
  it("uses the area_id attribute", () => {
    const hass = makeHass([st("sensor.pixel_9_area", "Lounge", { area_id: "living_room" })]);
    expect(trackerLocation(hass, tracker({ device: "phone" }))).toEqual({ areaId: "living_room", label: "Lounge" });
  });

  it("falls back to matching the area name case-insensitively", () => {
    const hass = makeHass([st("sensor.pixel_9_area", "living room")]);
    expect(trackerLocation(hass, tracker({ device: "phone" }))).toEqual({ areaId: "living_room", label: "Living Room" });
  });

  it("matches an area id given as state", () => {
    const hass = makeHass([st("sensor.pixel_9_area", "kitchen")]);
    expect(trackerLocation(hass, tracker({ device: "phone" })).areaId).toBe("kitchen");
  });

  it("reports an unmatched area name without an id", () => {
    const hass = makeHass([st("sensor.pixel_9_area", "Garage")]);
    expect(trackerLocation(hass, tracker({ device: "phone" }))).toEqual({ label: "Garage" });
  });

  it.each([
    ["unknown", "Away"],
    ["not_home", "Away"],
    ["", "Away"],
    ["unavailable", "Unavailable"],
  ])("state %j reads as %s", (state, label) => {
    const hass = makeHass([st("sensor.pixel_9_area", state)]);
    expect(trackerLocation(hass, tracker({ device: "phone" }))).toEqual({ label });
  });

  it("reports a missing state or missing sensor", () => {
    expect(trackerLocation(makeHass(), tracker({ device: "phone" }))).toEqual({ label: "Unavailable" });
    expect(trackerLocation(makeHass(), tracker({}))).toEqual({ label: "No sensor" });
  });
});

describe("trackerName", () => {
  it("prefers the configured name", () => {
    expect(trackerName(makeHass(), tracker({ device: "phone", name: "Mine" }))).toBe("Mine");
  });

  it("uses the device's user name, then its name", () => {
    expect(trackerName(makeHass(), tracker({ device: "watch" }))).toBe("Ben's watch");
    expect(trackerName(makeHass(), tracker({ device: "phone" }))).toBe("Pixel 9");
  });

  it("uses the sensor's friendly name minus ' Area'", () => {
    const hass = makeHass([st("sensor.tag_area", "Kitchen", { friendly_name: "Keys tag Area" })]);
    expect(trackerName(hass, tracker({ entity: "sensor.tag_area" }))).toBe("Keys tag");
  });

  it("falls back to the entity id, then 'Tracker'", () => {
    expect(trackerName(makeHass(), tracker({ entity: "sensor.tag_area" }))).toBe("sensor.tag_area");
    expect(trackerName(undefined, tracker({}))).toBe("Tracker");
  });
});
