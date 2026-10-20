// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

import { PresenceMapCard } from "../src/card.js";
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

function makeHass(t1: [string, string], t2: [string, string] = ["0", "0"]): Hass {
  const ids = ["sensor.radar_target_1_x", "sensor.radar_target_1_y", "sensor.radar_target_2_x", "sensor.radar_target_2_y"];
  const values = [t1[0], t1[1], t2[0], t2[1]];
  const states: Record<string, HassEntity> = {};
  const entities: Hass["entities"] = {};
  ids.forEach((id, i) => {
    states[id] = state(id, values[i]!);
    entities![id] = { entity_id: id, device_id: "dev1" };
  });
  entities!["sensor.radar_target_1_speed"] = { entity_id: "sensor.radar_target_1_speed", device_id: "dev1" };
  return {
    states,
    entities,
    areas: { living_room: { area_id: "living_room", name: "Living Room" } },
  };
}

const CONFIG = {
  type: "custom:presence-map-card",
  title: "Home",
  areas: [
    {
      area: "living_room",
      x: 1,
      y: 2,
      width: 5,
      height: 4,
      sensors: [{ type: "ld2450", device: "dev1", x: 2.5, y: 0 }],
    },
  ],
};

beforeAll(() => {
  if (!customElements.get("presence-map-card")) customElements.define("presence-map-card", PresenceMapCard);
});

function mount(config: unknown, hass?: Hass): PresenceMapCard {
  const card = document.createElement("presence-map-card") as PresenceMapCard;
  card.setConfig(config);
  if (hass) card.hass = hass;
  document.body.append(card);
  return card;
}

const dots = (card: PresenceMapCard) =>
  Array.from(card.shadowRoot!.querySelectorAll<SVGCircleElement>(".target"));

describe("PresenceMapCard", () => {
  it("draws areas with their Home Assistant name", () => {
    const card = mount(CONFIG, makeHass(["0", "1000"]));
    const html = card.shadowRoot!.innerHTML;
    expect(html).toContain("Living Room");
    expect(html).toContain('class="area-box" x="1.000" y="2.000" width="5.000" height="4.000"');
    expect(html).toContain('<div class="header">Home</div>');
  });

  it("auto-discovers the device's targets and offsets by area + sensor", () => {
    const card = mount(CONFIG, makeHass(["500", "1500"]));
    const [d1, d2] = dots(card);
    expect(dots(card)).toHaveLength(2);
    // area (1,2) + sensor (2.5,0) + target (0.5,1.5) facing +y
    expect(d1!.style.transform).toBe("translate(4.000px, 3.500px)");
    expect(d1!.classList.contains("hidden")).toBe(false);
    // 0,0 means "no target"
    expect(d2!.classList.contains("hidden")).toBe(true);
  });

  it("moves dots without rebuilding the SVG", () => {
    const card = mount(CONFIG, makeHass(["0", "1000"]));
    const svg = card.shadowRoot!.querySelector("svg");
    card.hass = makeHass(["-1000", "2000"]);
    expect(card.shadowRoot!.querySelector("svg")).toBe(svg);
    expect(dots(card)[0]!.style.transform).toBe("translate(2.500px, 4.000px)");
  });

  it("hides targets outside the area unless told not to", () => {
    const far = makeHass(["0", "5500"]);
    expect(dots(mount(CONFIG, far))[0]!.classList.contains("hidden")).toBe(true);
    const shown = mount({ ...CONFIG, hide_outside_area: false }, far);
    expect(dots(shown)[0]!.classList.contains("hidden")).toBe(false);
  });

  it("uses explicit targets over discovery", () => {
    const config = {
      ...CONFIG,
      areas: [{ ...CONFIG.areas[0], sensors: [{ type: "ld2450", targets: [{ x: "sensor.radar_target_2_x", y: "sensor.radar_target_2_y" }] }] }],
    };
    const card = mount(config, makeHass(["0", "0"], ["100", "200"]));
    expect(dots(card)).toHaveLength(1);
    expect(dots(card)[0]!.style.transform).toBe("translate(1.100px, 2.200px)");
  });

  it("shows a hint when no areas are configured", () => {
    const card = mount({ type: "custom:presence-map-card" }, makeHass(["0", "0"]));
    expect(card.shadowRoot!.textContent).toContain("Add an area");
  });

  it("rejects invalid config", () => {
    const card = document.createElement("presence-map-card") as PresenceMapCard;
    expect(() => card.setConfig({ areas: [{ x: 1 }] })).toThrow(/area is required/);
  });

  it("builds a stub config from the first area", () => {
    expect(PresenceMapCard.getStubConfig(makeHass(["0", "0"]))).toMatchObject({
      areas: [{ area: "living_room", width: 4, height: 3 }],
    });
  });
});

describe("Bermuda trackers", () => {
  function trackerHass(): Hass {
    const hass = makeHass(["0", "0"]);
    hass.areas!.kitchen = { area_id: "kitchen", name: "Kitchen" };
    hass.devices = { phone: { id: "phone", name: "Ben's phone" } };
    hass.entities!["sensor.bens_phone_area"] = { entity_id: "sensor.bens_phone_area", device_id: "phone" };
    hass.entities!["sensor.bens_phone_area_last_seen"] = { entity_id: "sensor.bens_phone_area_last_seen", device_id: "phone" };
    hass.states["sensor.bens_phone_area"] = {
      ...state("sensor.bens_phone_area", "Living Room"),
      attributes: { area_id: "living_room" },
    };
    hass.states["sensor.watch_area"] = {
      ...state("sensor.watch_area", "Kitchen"),
      attributes: { friendly_name: "Watch Area" },
    };
    return hass;
  }

  const config = {
    ...CONFIG,
    areas: [
      { area: "living_room", x: 0, y: 0, width: 5, height: 4 },
      { area: "kitchen", x: 5, y: 0, width: 3, height: 4 },
    ],
    trackers: [{ device: "phone" }, { entity: "sensor.watch_area", color: "#123456" }, { entity: "sensor.gone_area" }],
  };

  it("puts a hollow ring beside the area each device is in", () => {
    const card = mount(config, trackerHass());
    const root = card.shadowRoot!;
    const living = root.querySelectorAll('[data-trackers="0"] .tracker');
    const kitchen = root.querySelectorAll('[data-trackers="1"] .tracker');
    expect(living).toHaveLength(1);
    expect(living[0]!.getAttribute("data-tracker-ring")).toBe("0");
    expect(kitchen).toHaveLength(1);
    expect(kitchen[0]!.getAttribute("stroke")).toBe("#123456");
  });

  it("lists every device with its area in the legend", () => {
    const card = mount(config, trackerHass());
    const items = Array.from(card.shadowRoot!.querySelectorAll(".legend-item")).map((el) => el.textContent);
    expect(items).toEqual(["Ben's phoneLiving Room", "WatchKitchen", "sensor.gone_areaUnavailable"]);
  });

  it("moves rings when a device changes area", () => {
    const card = mount(config, trackerHass());
    const hass = trackerHass();
    hass.states["sensor.bens_phone_area"] = {
      ...state("sensor.bens_phone_area", "Kitchen"),
      attributes: { area_id: "kitchen" },
    };
    card.hass = hass;
    const root = card.shadowRoot!;
    expect(root.querySelectorAll('[data-trackers="0"] .tracker')).toHaveLength(0);
    expect(root.querySelectorAll('[data-trackers="1"] .tracker')).toHaveLength(2);
    expect(root.querySelector('[data-tracker-area="0"]')!.textContent).toBe("Kitchen");
  });

  it("can hide the legend", () => {
    const card = mount({ ...config, show_legend: false }, trackerHass());
    expect(card.shadowRoot!.querySelector(".legend")).toBeNull();
    expect(card.shadowRoot!.querySelectorAll(".tracker")).toHaveLength(2);
  });
});
