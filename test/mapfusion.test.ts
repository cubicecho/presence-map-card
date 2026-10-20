import { describe, expect, it, vi } from "vitest";

import { normalizeConfig } from "../src/config.js";
import { insidePolygons, ringsPath } from "../src/geometry.js";
import { FusedMapSubscription, pickFrame, resolveAreas } from "../src/mapfusion.js";
import type { Hass } from "../src/types.js";

import { fusedDoc } from "./fused-doc.js";

describe("map_fusion config", () => {
  it("accepts true or an object", () => {
    expect(normalizeConfig({}).map_fusion).toBeUndefined();
    expect(normalizeConfig({ map_fusion: false }).map_fusion).toBeUndefined();
    expect(normalizeConfig({ map_fusion: true }).map_fusion).toEqual({ all_areas: true });
    expect(normalizeConfig({ map_fusion: { frame: "upstairs", all_areas: false } }).map_fusion).toEqual({
      frame: "upstairs",
      all_areas: false,
    });
    expect(() => normalizeConfig({ map_fusion: "yes" })).toThrow(/map_fusion/);
  });

  it("remembers whether an area's box was set", () => {
    const c = normalizeConfig({ areas: [{ area: "a" }, { area: "b", x: 0 }] });
    expect(c.areas.map((a) => a.placed)).toEqual([false, true]);
  });
});

describe("resolveAreas", () => {
  it("leaves areas alone without map_fusion", () => {
    const c = normalizeConfig({ areas: [{ area: "kitchen" }] });
    const r = resolveAreas(c, fusedDoc());
    expect(r.areas).toHaveLength(1);
    expect(r.areas[0]).toMatchObject({ shape: "card", x: 0, width: 4 });
  });

  it("takes shapes from the fused map and keeps the card's sensors", () => {
    const sensors = [{ type: "ld2450", x: 1, y: 0 }];
    const c = normalizeConfig({ map_fusion: true, areas: [{ area: "kitchen", name: "Cook", sensors }] });
    const r = resolveAreas(c, fusedDoc());
    expect(r.areas.map((a) => a.area)).toEqual(["kitchen", "office"]);
    const kitchen = r.areas[0]!;
    expect(kitchen).toMatchObject({ shape: "map_fusion", name: "Cook", x: 0, y: 0, width: 4, height: 3 });
    expect(kitchen.polygons![0]).toHaveLength(6);
    expect(kitchen.sensors).toHaveLength(1);
    expect(r.areas[1]).toMatchObject({ name: "Office", sensors: [] });
    expect(r.rooms).toHaveLength(1);
  });

  it("can show only the card's areas", () => {
    const c = normalizeConfig({ map_fusion: { all_areas: false }, areas: [{ area: "kitchen" }] });
    const r = resolveAreas(c, fusedDoc());
    expect(r.areas.map((a) => a.area)).toEqual(["kitchen"]);
    expect(r.rooms).toEqual([]);
  });

  it("falls back to the card's box, or lists the area as missing", () => {
    const c = normalizeConfig({
      map_fusion: true,
      areas: [{ area: "garage", x: 10, y: 0, width: 3, height: 5 }, { area: "porch" }],
    });
    const r = resolveAreas(c, fusedDoc());
    expect(r.areas.find((a) => a.area === "garage")).toMatchObject({ shape: "card", x: 10 });
    expect(r.missing).toEqual(["porch"]);
  });

  it("picks the configured frame and reports a missing one", () => {
    const doc = fusedDoc();
    expect(pickFrame(doc)!.frame_id).toBe("vacuum.d10_plus:46");
    expect(pickFrame(doc, "upstairs")!.name).toBe("Upstairs");
    const r = resolveAreas(normalizeConfig({ map_fusion: { frame: "attic" } }), doc);
    expect(r.frame).toBeNull();
    expect(r.problem).toMatch(/no map "attic".*vacuum.d10_plus:46, upstairs/);
  });

  it("refuses document versions it doesn't know", () => {
    const r = resolveAreas(normalizeConfig({ map_fusion: true }), { ...fusedDoc(), version: 2 });
    expect(r.areas).toEqual([]);
    expect(r.problem).toMatch(/version 2/);
  });
});

describe("polygon geometry", () => {
  const l = [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 3 }, { x: 0, y: 3 }]];

  it("tests points against the outline, not the box", () => {
    expect(insidePolygons(l, { x: 0.5, y: 2 })).toBe(true);
    expect(insidePolygons(l, { x: 3, y: 2 })).toBe(false); // in the box, outside the L
    expect(insidePolygons(l, { x: 1.05, y: 2 })).toBe(true); // within 10 cm of the edge
  });

  it("draws rings as one path", () => {
    expect(ringsPath(l)).toBe("M0.000 0.000 L4.000 0.000 L4.000 1.000 L1.000 1.000 L1.000 3.000 L0.000 3.000 Z");
  });
});

describe("FusedMapSubscription", () => {
  function fakeHass(subscribe: ReturnType<typeof vi.fn>): Hass {
    return { states: {}, connection: { subscribeMessage: subscribe as never } };
  }

  it("subscribes once per connection and unsubscribes on stop", async () => {
    const unsub = vi.fn();
    const subscribe = vi.fn().mockResolvedValue(unsub);
    const onChange = vi.fn();
    const sub = new FusedMapSubscription(onChange);
    const hass = fakeHass(subscribe);
    sub.update(hass, true);
    sub.update({ ...hass }, true); // new hass object, same connection
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0]![1]).toEqual({ type: "map_fusion/subscribe" });
    subscribe.mock.calls[0]![0](fusedDoc());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }), null);

    sub.update(hass, false);
    await Promise.resolve();
    await Promise.resolve();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("explains a missing integration", async () => {
    const subscribe = vi.fn().mockRejectedValue({ code: "unknown_command", message: "Unknown command." });
    const onChange = vi.fn();
    new FusedMapSubscription(onChange).update(fakeHass(subscribe), true);
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).toHaveBeenCalledWith(null, "Map Fusion isn't installed.");
  });
});
