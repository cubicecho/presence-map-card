import { describe, expect, it } from "vitest";

import type { SensorConfig } from "../src/config.js";
import { discoverLd2450Targets, ld2450, unitScale } from "../src/sensors/ld2450.js";
import { getDriver, isSensorType } from "../src/sensors/registry.js";
import type { Hass, HassEntity } from "../src/types.js";

function state(entity_id: string, value: string, unit = "mm"): HassEntity {
  return {
    entity_id,
    state: value,
    last_changed: "",
    last_updated: "",
    attributes: { unit_of_measurement: unit },
  };
}

function hassWith(states: HassEntity[], entities: Record<string, string> = {}): Hass {
  const s: Record<string, HassEntity> = {};
  for (const st of states) s[st.entity_id] = st;
  const e: Hass["entities"] = {};
  for (const id of Object.keys(entities)) e[id] = { entity_id: id, device_id: entities[id] };
  return { states: s, entities: e };
}

function sensor(over: Partial<SensorConfig> = {}): SensorConfig {
  return { type: "ld2450", x: 0, y: 0, rotation: 0, flip_x: false, targets: [], ...over };
}

describe("unitScale", () => {
  it.each([
    ["mm", 0.001],
    ["cm", 0.01],
    ["m", 1],
    [" M ", 1],
    ["in", 0.0254],
    ["ft", 0.3048],
    [undefined, 0.001],
    ["", 0.001],
  ])("%s → %s", (unit, scale) => {
    expect(unitScale(unit)).toBe(scale);
  });
});

describe("discoverLd2450Targets", () => {
  const entities = {
    "sensor.radar_target_2_x": "dev1",
    "sensor.radar_target_2_y": "dev1",
    "sensor.radar_target_1_x": "dev1",
    "sensor.radar_target_1_y": "dev1",
    "sensor.radar_target3_x": "dev1",
    "sensor.radar_target3_y": "dev1",
    "sensor.radar_target_1_speed": "dev1",
    "sensor.radar_target_1_distance": "dev1",
    "sensor.radar_target_1_angle": "dev1",
    "sensor.radar_target_4_x": "dev1", // no y → dropped
    "binary_sensor.radar_target_1_x": "dev1", // wrong domain
    "sensor.other_target_1_x": "dev2",
    "sensor.other_target_1_y": "dev2",
  };

  it("finds x/y pairs on the device, sorted by target number", () => {
    expect(discoverLd2450Targets(hassWith([], entities), "dev1")).toEqual([
      { x: "sensor.radar_target_1_x", y: "sensor.radar_target_1_y" },
      { x: "sensor.radar_target_2_x", y: "sensor.radar_target_2_y" },
      { x: "sensor.radar_target3_x", y: "sensor.radar_target3_y" },
    ]);
  });

  it("only looks at the chosen device", () => {
    expect(discoverLd2450Targets(hassWith([], entities), "dev2")).toEqual([
      { x: "sensor.other_target_1_x", y: "sensor.other_target_1_y" },
    ]);
  });

  it("accepts a _coordinate suffix", () => {
    const h = hassWith([], {
      "sensor.r_target_1_x_coordinate": "d",
      "sensor.r_target_1_y_coordinate": "d",
    });
    expect(discoverLd2450Targets(h, "d")).toEqual([
      { x: "sensor.r_target_1_x_coordinate", y: "sensor.r_target_1_y_coordinate" },
    ]);
  });

  it("copes with no entity registry", () => {
    expect(discoverLd2450Targets({ states: {} }, "dev1")).toEqual([]);
  });
});

describe("ld2450 driver", () => {
  const t = { x: "sensor.t_x", y: "sensor.t_y" };

  it("is registered", () => {
    expect(isSensorType("ld2450")).toBe(true);
    expect(getDriver("ld2450")).toBe(ld2450);
    expect(isSensorType("nope")).toBe(false);
  });

  it("converts millimetres to metres", () => {
    const h = hassWith([state(t.x, "-1250"), state(t.y, "3000")]);
    expect(ld2450.read(h, t)).toEqual({ x: -1.25, y: 3 });
  });

  it("honours other units", () => {
    const h = hassWith([state(t.x, "50", "cm"), state(t.y, "2", "m")]);
    expect(ld2450.read(h, t)).toEqual({ x: 0.5, y: 2 });
  });

  it("treats 0,0 as no target", () => {
    expect(ld2450.read(hassWith([state(t.x, "0"), state(t.y, "0")]), t)).toBeNull();
  });

  it("keeps a target on one axis at 0", () => {
    expect(ld2450.read(hassWith([state(t.x, "0"), state(t.y, "1000")]), t)).toEqual({ x: 0, y: 1 });
  });

  it.each(["unavailable", "unknown", "abc"])("returns null for %s", (bad) => {
    expect(ld2450.read(hassWith([state(t.x, bad), state(t.y, "1000")]), t)).toBeNull();
  });

  it("returns null for missing entities", () => {
    expect(ld2450.read(hassWith([]), t)).toBeNull();
  });

  it("prefers configured targets over discovery", () => {
    const h = hassWith([], { "sensor.r_target_1_x": "d", "sensor.r_target_1_y": "d" });
    expect(ld2450.targets(h, sensor({ device: "d", targets: [t] }))).toEqual([t]);
  });

  it("discovers targets from the device when none are configured", () => {
    const h = hassWith([], { "sensor.r_target_1_x": "d", "sensor.r_target_1_y": "d" });
    expect(ld2450.targets(h, sensor({ device: "d" }))).toEqual([
      { x: "sensor.r_target_1_x", y: "sensor.r_target_1_y" },
    ]);
    expect(ld2450.targets(undefined, sensor({ device: "d" }))).toEqual([]);
  });
});
