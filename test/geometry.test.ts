import { describe, expect, it } from "vitest";

import type { AreaConfig, SensorConfig } from "../src/config.js";
import { fovPath, insideArea, mapBounds, sensorOrigin, sensorToMap } from "../src/geometry.js";

function area(over: Partial<AreaConfig> = {}): AreaConfig {
  return { area: "a", x: 0, y: 0, width: 4, height: 3, sensors: [], ...over };
}

function sensor(over: Partial<SensorConfig> = {}): SensorConfig {
  return { type: "ld2450", x: 0, y: 0, rotation: 0, flip_x: false, targets: [], ...over };
}

function close(p: { x: number; y: number }, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
}

describe("sensorToMap", () => {
  // A target 2 m straight ahead of the sensor and 1 m to its +x side.
  const local = { x: 1, y: 2 };

  it("rotation 0 faces down the map (+y)", () => {
    close(sensorToMap(area(), sensor(), { x: 0, y: 2 }), 0, 2);
    close(sensorToMap(area(), sensor(), local), 1, 2);
  });

  it("rotation 90 faces left (-x)", () => {
    close(sensorToMap(area(), sensor({ rotation: 90 }), { x: 0, y: 2 }), -2, 0);
    close(sensorToMap(area(), sensor({ rotation: 90 }), local), -2, 1);
  });

  it("rotation 180 faces up (-y)", () => {
    close(sensorToMap(area(), sensor({ rotation: 180 }), { x: 0, y: 2 }), 0, -2);
    close(sensorToMap(area(), sensor({ rotation: 180 }), local), -1, -2);
  });

  it("rotation 270 faces right (+x)", () => {
    close(sensorToMap(area(), sensor({ rotation: 270 }), { x: 0, y: 2 }), 2, 0);
    close(sensorToMap(area(), sensor({ rotation: 270 }), local), 2, -1);
  });

  it("flip_x mirrors the lateral axis", () => {
    close(sensorToMap(area(), sensor({ flip_x: true }), local), -1, 2);
  });

  it("adds the area origin and sensor offset", () => {
    const a = area({ x: 10, y: 5 });
    const s = sensor({ x: 2, y: 0.5 });
    close(sensorToMap(a, s, local), 13, 7.5);
    close(sensorOrigin(a, s), 12, 5.5);
  });
});

describe("insideArea", () => {
  const a = area({ x: 1, y: 1, width: 2, height: 2 });

  it("accepts points inside and on the edge", () => {
    expect(insideArea(a, { x: 2, y: 2 })).toBe(true);
    expect(insideArea(a, { x: 1, y: 3 })).toBe(true);
  });

  it("allows a small tolerance", () => {
    expect(insideArea(a, { x: 0.97, y: 2 })).toBe(true);
    expect(insideArea(a, { x: 0.9, y: 2 })).toBe(false);
  });

  it("rejects points outside", () => {
    expect(insideArea(a, { x: 5, y: 2 })).toBe(false);
    expect(insideArea(a, { x: 2, y: -1 })).toBe(false);
  });
});

describe("mapBounds", () => {
  it("returns null for no areas", () => {
    expect(mapBounds([])).toBeNull();
  });

  it("covers every area", () => {
    expect(
      mapBounds([area({ x: -1, y: 0, width: 2, height: 2 }), area({ x: 3, y: 4, width: 1, height: 1 })]),
    ).toEqual({ minX: -1, minY: 0, maxX: 4, maxY: 5 });
  });
});

describe("fovPath", () => {
  it("draws a closed wedge from the sensor", () => {
    const p = fovPath(area({ x: 1, y: 1 }), sensor({ x: 1 }), 60, 6);
    expect(p).toMatch(
      /^M-?\d+\.\d{3} -?\d+\.\d{3} L-?\d+\.\d{3} -?\d+\.\d{3} A6\.000 6\.000 0 0 0 -?\d+\.\d{3} -?\d+\.\d{3} Z$/,
    );
    expect(p.startsWith("M2.000 1.000")).toBe(true);
  });

  it("puts both edges at ±halfAngle around the facing direction", () => {
    // Rotation 0 faces +y: edges at (∓range·sin60, range·cos60).
    const p = fovPath(area(), sensor(), 60, 6);
    expect(p).toContain("L-5.196 3.000");
    expect(p).toContain("5.196 3.000 Z");
  });

  it("is symmetric under flip_x", () => {
    expect(fovPath(area(), sensor({ flip_x: true, rotation: 30 }), 60, 6)).toBe(
      fovPath(area(), sensor({ rotation: 30 }), 60, 6),
    );
  });
});
