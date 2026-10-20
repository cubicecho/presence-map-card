// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

import { PresenceMapCardEditor } from "../src/editor.js";
import type { Hass } from "../src/types.js";

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
  },
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
