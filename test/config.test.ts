import { describe, expect, it } from "vitest";

import { DEFAULT_AREA_SIZE, normalizeConfig } from "../src/config.js";

describe("normalizeConfig", () => {
  it("fills card defaults", () => {
    const c = normalizeConfig({ type: "custom:presence-map-card" });
    expect(c).toEqual({
      type: "custom:presence-map-card",
      title: undefined,
      hide_outside_area: true,
      show_fov: true,
      areas: [],
    });
  });

  it("respects explicit false flags", () => {
    const c = normalizeConfig({ type: "x", hide_outside_area: false, show_fov: false });
    expect(c.hide_outside_area).toBe(false);
    expect(c.show_fov).toBe(false);
  });

  it("fills area and sensor defaults", () => {
    const c = normalizeConfig({ type: "x", areas: [{ area: "living", sensors: [{}] }] });
    const a = c.areas[0]!;
    expect(a).toMatchObject({ area: "living", x: 0, y: 0, ...DEFAULT_AREA_SIZE });
    expect(a.sensors[0]).toEqual({
      type: "ld2450",
      device: undefined,
      name: undefined,
      x: 0,
      y: 0,
      rotation: 0,
      flip_x: false,
      color: undefined,
      targets: [],
    });
  });

  it("accepts numeric strings", () => {
    const c = normalizeConfig({ type: "x", areas: [{ area: "a", x: "1.5", width: "2" }] });
    expect(c.areas[0]!.x).toBe(1.5);
    expect(c.areas[0]!.width).toBe(2);
  });

  it("rejects a non-object config", () => {
    expect(() => normalizeConfig(null)).toThrow("Invalid configuration");
  });

  it("rejects areas that are not a list", () => {
    expect(() => normalizeConfig({ type: "x", areas: {} })).toThrow("areas must be a list");
  });

  it("requires an area id", () => {
    expect(() => normalizeConfig({ type: "x", areas: [{ x: 1 }] })).toThrow("areas[0].area is required");
  });

  it("rejects non-numeric positions with a path", () => {
    expect(() => normalizeConfig({ type: "x", areas: [{ area: "a", x: "abc" }] })).toThrow(
      "areas[0].x must be a number",
    );
  });

  it("rejects zero or negative sizes", () => {
    expect(() => normalizeConfig({ type: "x", areas: [{ area: "a", width: 0 }] })).toThrow(
      "width and height must be above 0",
    );
    expect(() => normalizeConfig({ type: "x", areas: [{ area: "a", height: -1 }] })).toThrow(
      "width and height must be above 0",
    );
  });

  it("rejects unknown sensor types", () => {
    expect(() =>
      normalizeConfig({ type: "x", areas: [{ area: "a", sensors: [{ type: "bermuda" }] }] }),
    ).toThrow('areas[0].sensors[0].type "bermuda" is not supported');
  });

  it("skips half-filled target pairs", () => {
    const c = normalizeConfig({
      type: "x",
      areas: [
        {
          area: "a",
          sensors: [
            {
              targets: [
                { x: "sensor.t1_x", y: "sensor.t1_y" },
                { x: "sensor.t2_x", y: "" },
                { y: "sensor.t3_y" },
                null,
              ],
            },
          ],
        },
      ],
    });
    expect(c.areas[0]!.sensors[0]!.targets).toEqual([{ x: "sensor.t1_x", y: "sensor.t1_y" }]);
  });

  it("keeps flip_x only when strictly true", () => {
    const c = normalizeConfig({
      type: "x",
      areas: [{ area: "a", sensors: [{ flip_x: true }, { flip_x: "yes" }] }],
    });
    expect(c.areas[0]!.sensors.map((s) => s.flip_x)).toEqual([true, false]);
  });
});
