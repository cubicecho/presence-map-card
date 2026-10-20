// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

import { PresenceMapCardEditor } from "../src/editor.js";
import type { Hass } from "../src/types.js";

import { fusedDoc } from "./fused-doc.js";

interface StubForm extends HTMLElement {
  data?: Record<string, unknown>;
  hass?: Hass;
}

beforeAll(() => {
  if (!customElements.get("ha-form")) {
    customElements.define("ha-form", class extends HTMLElement {});
  }
  if (!customElements.get("test-pmc-editor")) {
    customElements.define("test-pmc-editor", PresenceMapCardEditor);
  }
});

const hass: Hass = {
  states: {},
  areas: {
    living: { area_id: "living", name: "Living room" },
    kitchen: { area_id: "kitchen", name: "Kitchen" },
  },
  entities: {
    "sensor.radar_target_1_x": { entity_id: "sensor.radar_target_1_x", device_id: "dev1" },
    "sensor.radar_target_1_y": { entity_id: "sensor.radar_target_1_y", device_id: "dev1" },
    "sensor.radar_target_2_x": { entity_id: "sensor.radar_target_2_x", device_id: "dev1" },
    "sensor.radar_target_2_y": { entity_id: "sensor.radar_target_2_y", device_id: "dev1" },
    "sensor.phone_area_last_seen": { entity_id: "sensor.phone_area_last_seen", device_id: "phone" },
    "sensor.phone_area": { entity_id: "sensor.phone_area", device_id: "phone" },
  },
  devices: { phone: { id: "phone", name: "Pixel 9" } },
};

function makeEditor(config: Record<string, unknown>) {
  const editor = document.createElement("test-pmc-editor") as PresenceMapCardEditor;
  const events: Array<Record<string, unknown>> = [];
  editor.addEventListener("config-changed", (e) => {
    events.push((e as CustomEvent<{ config: Record<string, unknown> }>).detail.config);
  });
  document.body.append(editor);
  editor.setConfig(config);
  editor.hass = hass;
  return { editor, events, last: () => events[events.length - 1]! };
}

function form(editor: HTMLElement, id: string): StubForm {
  const el = editor.querySelector<StubForm>(`ha-form[data-form="${id}"]`);
  if (!el) throw new Error(`no form ${id}`);
  return el;
}

function change(el: StubForm, patch: Record<string, unknown>) {
  el.dispatchEvent(
    new CustomEvent("value-changed", { detail: { value: { ...el.data, ...patch } }, bubbles: true }),
  );
}

function click(editor: HTMLElement, action: string) {
  const b = editor.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
  if (!b) throw new Error(`no button ${action}`);
  b.click();
}

describe("PresenceMapCardEditor", () => {
  it("renders a form per area and sensor", () => {
    const { editor } = makeEditor({
      type: "custom:presence-map-card",
      areas: [{ area: "living", sensors: [{ type: "ld2450" }] }, { area: "kitchen" }],
    });
    expect(editor.querySelectorAll("ha-form").length).toBe(4);
    expect(form(editor, "area-0").data).toMatchObject({ area: "living" });
    expect(form(editor, "sensor-0-0").hass).toBe(hass);
  });

  it("adds an area to the right using the next unused HA area", () => {
    const { editor, last } = makeEditor({
      type: "custom:presence-map-card",
      areas: [{ area: "living", x: 1, width: 5 }],
    });
    click(editor, "add-area");
    expect(last().areas).toEqual([
      { area: "living", x: 1, width: 5 },
      { area: "kitchen", x: 6, y: 0, width: 4, height: 3, sensors: [] },
    ]);
    expect(editor.querySelectorAll(".pmc-area").length).toBe(2);
  });

  it("adds a sensor centred on the top wall", () => {
    const { editor, last } = makeEditor({ type: "x", areas: [{ area: "living", width: 5 }] });
    click(editor, "add-sensor-0");
    const areas = last().areas as Array<{ sensors: unknown[] }>;
    expect(areas[0]!.sensors).toEqual([{ type: "ld2450", x: 2.5, y: 0, rotation: 0 }]);
    expect(editor.querySelector('ha-form[data-form="sensor-0-0"]')).not.toBeNull();
  });

  it("writes only changed fields and keeps forms in place", () => {
    const { editor, last } = makeEditor({ type: "x", areas: [{ area: "living" }] });
    const before = form(editor, "general");
    change(before, { title: "Home" });
    expect(last()).toEqual({ type: "x", title: "Home", areas: [{ area: "living" }] });
    expect(form(editor, "general")).toBe(before);
  });

  it("discovers targets when a device is picked", () => {
    const { editor, last } = makeEditor({
      type: "x",
      areas: [{ area: "living", sensors: [{ type: "ld2450" }] }],
    });
    change(form(editor, "sensor-0-0"), { device: "dev1" });
    const sensor = (last().areas as Array<{ sensors: Array<Record<string, unknown>> }>)[0]!.sensors[0]!;
    expect(sensor.device).toBe("dev1");
    expect(sensor.targets).toEqual([
      { x: "sensor.radar_target_1_x", y: "sensor.radar_target_1_y" },
      { x: "sensor.radar_target_2_x", y: "sensor.radar_target_2_y" },
    ]);
    expect(form(editor, "sensor-0-0").data).toMatchObject({ target_2_y: "sensor.radar_target_2_y" });
  });

  it("maps flat target fields back to a trimmed list", () => {
    const { editor, last } = makeEditor({
      type: "x",
      areas: [{ area: "living", sensors: [{ type: "ld2450" }] }],
    });
    change(form(editor, "sensor-0-0"), { target_2_x: "sensor.a" });
    const sensor = (last().areas as Array<{ sensors: Array<Record<string, unknown>> }>)[0]!.sensors[0]!;
    expect(sensor.targets).toEqual([
      { x: "", y: "" },
      { x: "sensor.a", y: "" },
    ]);
    expect(sensor).not.toHaveProperty("flip_x");
  });

  it("removes areas", () => {
    const { editor, last } = makeEditor({ type: "x", areas: [{ area: "living" }, { area: "kitchen" }] });
    click(editor, "remove-area-0");
    expect(last().areas).toEqual([{ area: "kitchen" }]);
    expect(editor.querySelectorAll(".pmc-area").length).toBe(1);
  });
});

describe("collapsible sections", () => {
  const section = (editor: HTMLElement, key: string) =>
    editor.querySelector<HTMLDetailsElement>(`details[data-section="${key}"]`)!;

  it("starts existing sections collapsed with a summary", () => {
    const { editor } = makeEditor({
      type: "x",
      areas: [{ area: "living", x: 1, y: 2, width: 5, height: 4, sensors: [{ type: "ld2450", x: 2.5, rotation: 90, flip_x: true }] }],
    });
    expect(section(editor, "area-0").open).toBe(false);
    expect(section(editor, "sensor-0-0").open).toBe(false);
    expect(section(editor, "area-0").querySelector(".pmc-summary")!.textContent).toBe(
      "· Living room · 5 × 4 m at (1, 2)",
    );
    expect(section(editor, "sensor-0-0").querySelector(".pmc-summary")!.textContent).toBe(
      "· (2.5, 0) · 90° · mirrored",
    );
  });

  it("opens newly added areas and sensors", () => {
    const { editor } = makeEditor({ type: "x", areas: [{ area: "living" }] });
    click(editor, "add-sensor-0");
    expect(section(editor, "area-0").open).toBe(true);
    expect(section(editor, "sensor-0-0").open).toBe(true);
    click(editor, "add-area");
    expect(section(editor, "area-1").open).toBe(true);
  });

  it("keeps open state across rebuilds and removals", () => {
    const { editor } = makeEditor({ type: "x", areas: [{ area: "living" }, { area: "kitchen" }] });
    const kitchen = section(editor, "area-1");
    kitchen.open = true;
    kitchen.dispatchEvent(new Event("toggle"));
    click(editor, "remove-area-0");
    expect(section(editor, "area-0").open).toBe(true);
  });

  it("updates the summary without rebuilding", () => {
    const { editor } = makeEditor({ type: "x", areas: [{ area: "living" }] });
    const before = section(editor, "area-0");
    change(form(editor, "area-0"), { width: 6 });
    expect(section(editor, "area-0")).toBe(before);
    expect(before.querySelector(".pmc-summary")!.textContent).toContain("6 × 3 m");
  });

  it("Remove does not toggle the section", () => {
    const { editor } = makeEditor({ type: "x", areas: [{ area: "living", sensors: [{ type: "ld2450" }] }] });
    const btn = editor.querySelector<HTMLButtonElement>('button[data-action="remove-sensor-0-0"]')!;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("tracked devices", () => {
  const section = (editor: HTMLElement, key: string) =>
    editor.querySelector<HTMLDetailsElement>(`details[data-section="${key}"]`)!;

  it("shows the trackers section with a count and no Remove button", () => {
    const { editor } = makeEditor({ type: "x", trackers: [{ type: "bermuda" }, { type: "bermuda" }] });
    const s = section(editor, "trackers");
    expect(s.querySelector(".pmc-summary")!.textContent).toBe("· 2 devices");
    expect(s.querySelector(":scope > summary button")).toBeNull();
    expect(editor.querySelectorAll(".pmc-tracker").length).toBe(2);
  });

  it("adds a tracker and opens it", () => {
    const { editor, last } = makeEditor({ type: "x" });
    click(editor, "add-tracker");
    expect(last().trackers).toEqual([{ type: "bermuda" }]);
    expect(section(editor, "trackers").open).toBe(true);
    expect(section(editor, "tracker-0").open).toBe(true);
    expect(form(editor, "tracker-0")).toBeTruthy();
  });

  it("removes a tracker and re-keys open state", () => {
    const { editor, last } = makeEditor({
      type: "x",
      trackers: [{ type: "bermuda", name: "A" }, { type: "bermuda", name: "B" }],
    });
    const b = section(editor, "tracker-1");
    b.open = true;
    b.dispatchEvent(new Event("toggle"));
    click(editor, "remove-tracker-0");
    expect(last().trackers).toEqual([{ type: "bermuda", name: "B" }]);
    expect(section(editor, "tracker-0").open).toBe(true);
  });

  it("finds the Area sensor when a device is picked", () => {
    const { editor, last } = makeEditor({ type: "x", trackers: [{ type: "bermuda" }] });
    change(form(editor, "tracker-0"), { device: "phone" });
    expect(last().trackers).toEqual([{ type: "bermuda", device: "phone", entity: "sensor.phone_area" }]);
    expect(form(editor, "tracker-0").data).toMatchObject({ entity: "sensor.phone_area" });
    expect(section(editor, "tracker-0").querySelector(".pmc-summary")!.textContent).toBe(
      "· Pixel 9 · Unavailable",
    );
  });

  it("writes show_legend only when toggled", () => {
    const { editor, last } = makeEditor({ type: "x" });
    expect(form(editor, "general").data).toMatchObject({ show_legend: true });
    change(form(editor, "general"), { show_legend: false });
    expect(last()).toEqual({ type: "x", show_legend: false });
  });
});

describe("Map Fusion in the editor", () => {
  function fusionHass(callWS: (msg: Record<string, unknown>) => Promise<unknown>, admin = true): Hass {
    return { ...hass, config: { components: ["map_fusion"] }, user: { is_admin: admin }, callWS: callWS as never };
  }

  async function settle() {
    for (let k = 0; k < 5; k++) await Promise.resolve();
  }

  function editorWith(config: Record<string, unknown>, h: Hass) {
    const editor = document.createElement("test-pmc-editor") as PresenceMapCardEditor;
    const events: Array<Record<string, unknown>> = [];
    editor.addEventListener("config-changed", (e) => {
      events.push((e as CustomEvent<{ config: Record<string, unknown> }>).detail.config);
    });
    document.body.append(editor);
    editor.setConfig(config);
    editor.hass = h;
    return { editor, last: () => events[events.length - 1]! };
  }

  const button = (editor: HTMLElement, action: string) =>
    editor.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!;

  it("offers the toggle only when Map Fusion is installed", () => {
    const { editor } = makeEditor({ type: "custom:presence-map-card" });
    expect(editor.querySelector('ha-form[data-form="map_fusion"]')).toBeNull();
    const withMf = editorWith({ type: "custom:presence-map-card" }, fusionHass(() => Promise.resolve(fusedDoc())));
    expect(withMf.editor.querySelector('ha-form[data-form="map_fusion"]')).not.toBeNull();
  });

  it("writes map_fusion as true, or an object for non-defaults", async () => {
    const { editor, last } = editorWith({ type: "custom:presence-map-card" }, fusionHass(() => Promise.resolve(fusedDoc())));
    const mf = form(editor, "map_fusion") as StubForm & { schema?: Array<{ name: string }> };
    change(mf, { map_fusion: true });
    expect(last().map_fusion).toBe(true);
    await settle();
    // Two frames in the doc, so the frame picker appears.
    expect(mf.schema!.map((s) => s.name)).toEqual(["map_fusion", "map_fusion_frame", "map_fusion_all_areas"]);
    change(mf, { map_fusion_frame: "upstairs" });
    expect(last().map_fusion).toEqual({ frame: "upstairs" });
    change(mf, { map_fusion: false });
    expect(last().map_fusion).toBeUndefined();
  });

  it("summarises areas by their Map Fusion shape", async () => {
    const { editor } = editorWith(
      { type: "custom:presence-map-card", map_fusion: true, areas: [{ area: "kitchen" }, { area: "living" }] },
      fusionHass(() => Promise.resolve(fusedDoc())),
    );
    await settle();
    const summaries = Array.from(editor.querySelectorAll(".pmc-area > .pmc-header .pmc-summary")).map((e) => e.textContent);
    expect(summaries).toEqual(["· Kitchen · 4 × 3 m, from the vacuum map", "· Living room · not on the map yet"]);
    // Vacuum shapes can't be replaced from the card; unplaced areas can be placed.
    expect(button(editor, "place-area-0").hidden).toBe(true);
    expect(button(editor, "place-area-1").hidden).toBe(false);
  });

  it("places an area's box on the Map Fusion map", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const callWS = (msg: Record<string, unknown>) => {
      calls.push(msg);
      return Promise.resolve(msg.type === "map_fusion/get" ? fusedDoc() : {});
    };
    const { editor } = editorWith(
      { type: "custom:presence-map-card", map_fusion: true, areas: [{ area: "living", x: 9, y: 0, width: 2, height: 3 }] },
      fusionHass(callWS),
    );
    await settle();
    button(editor, "place-area-0").click();
    await settle();
    expect(calls.find((c) => c.type === "map_fusion/area/set")).toEqual({
      type: "map_fusion/area/set",
      frame_id: "vacuum.d10_plus:46",
      area_id: "living",
      rect: { x: 9, y: 0, width: 2, height: 3 },
    });
    expect(calls.filter((c) => c.type === "map_fusion/get")).toHaveLength(2); // refetched after saving
    expect(editor.querySelector('[data-status="place-area-0"]')!.textContent).toBe("Saved to Map Fusion (Map 1).");
  });

  it("hides placing from non-admins", async () => {
    const { editor } = editorWith(
      { type: "custom:presence-map-card", map_fusion: true, areas: [{ area: "living" }] },
      fusionHass(() => Promise.resolve(fusedDoc()), false),
    );
    await settle();
    expect(button(editor, "place-area-0").hidden).toBe(true);
  });

  it("adds areas without a box when Map Fusion is on", async () => {
    const { editor, last } = editorWith(
      { type: "custom:presence-map-card", map_fusion: true, areas: [] },
      fusionHass(() => Promise.resolve(fusedDoc())),
    );
    click(editor, "add-area");
    expect(last().areas).toEqual([{ area: "living", sensors: [] }]);
  });
});
