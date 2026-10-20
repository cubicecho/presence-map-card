/**
 * Visual editor for the card.
 *
 * Built from Home Assistant's own `<ha-form>`, so the area, device and entity
 * pickers match every other card editor. Rendered in the light DOM so the
 * dialog's theme applies.
 *
 * It edits the raw config (not the normalized one) so saving doesn't write
 * defaults the user never chose. The DOM is rebuilt only when areas,
 * sensors or trackers are added or removed; otherwise each form's data is updated in
 * place, so typing doesn't lose focus.
 *
 * With Map Fusion on, the editor fetches the fused map to offer its frames,
 * show which areas already have a shape, and save an area's box to Map
 * Fusion ("Place on Map Fusion map").
 */
import { DEFAULT_AREA_SIZE } from "./config.js";
import { fireEvent } from "./dom.js";
import { fetchFusedMap, mapFusionInstalled, pickFrame, placeArea, type FusedDoc, type FusedFrame } from "./mapfusion.js";
import { getDriver } from "./sensors/registry.js";
import { discoverBermudaAreaEntity, trackerLocation, trackerName } from "./trackers/bermuda.js";
import type { Hass } from "./types.js";

type Raw = Record<string, unknown>;

interface FormSchemaItem {
  name: string;
  required?: boolean;
  selector: Record<string, unknown>;
}

interface HaFormElement extends HTMLElement {
  hass?: Hass;
  data?: Raw;
  schema?: FormSchemaItem[];
  computeLabel?: (item: FormSchemaItem) => string;
}

/** Target slots shown per sensor (the LD2450 tracks up to three). */
const TARGET_SLOTS = 3;

const METRES = { number: { mode: "box", step: 0.1, unit_of_measurement: "m" } };
const SENSOR_ENTITY = { entity: { domain: "sensor" } };

const GENERAL_SCHEMA: FormSchemaItem[] = [
  { name: "title", selector: { text: {} } },
  { name: "hide_outside_area", selector: { boolean: {} } },
  { name: "show_fov", selector: { boolean: {} } },
  { name: "show_legend", selector: { boolean: {} } },
];

/** Shown when Map Fusion is installed or already configured. */
function mapFusionSchema(enabled: boolean, frames: FusedFrame[]): FormSchemaItem[] {
  const out: FormSchemaItem[] = [{ name: "map_fusion", selector: { boolean: {} } }];
  if (!enabled) return out;
  if (frames.length > 1) {
    out.push({
      name: "map_fusion_frame",
      selector: { select: { mode: "dropdown", options: frames.map((f) => ({ value: f.frame_id, label: f.name })) } },
    });
  }
  out.push({ name: "map_fusion_all_areas", selector: { boolean: {} } });
  out.push({ name: "map_fusion_filled", selector: { boolean: {} } });
  return out;
}

const TRACKER_SCHEMA: FormSchemaItem[] = [
  { name: "device", selector: { device: { filter: { integration: "bermuda" } } } },
  { name: "entity", selector: { entity: { filter: { integration: "bermuda", domain: "sensor" } } } },
  { name: "name", selector: { text: {} } },
  { name: "color", selector: { text: {} } },
];

const TRACKER_LABELS: Record<string, string> = {
  device: "Bermuda device",
  entity: "Area sensor (found from device)",
};

const AREA_SCHEMA: FormSchemaItem[] = [
  { name: "area", required: true, selector: { area: {} } },
  { name: "name", selector: { text: {} } },
  { name: "x", selector: METRES },
  { name: "y", selector: METRES },
  { name: "width", selector: METRES },
  { name: "height", selector: METRES },
];

function targetSchema(): FormSchemaItem[] {
  const out: FormSchemaItem[] = [];
  for (let k = 1; k <= TARGET_SLOTS; k++) {
    out.push({ name: `target_${k}_x`, selector: SENSOR_ENTITY });
    out.push({ name: `target_${k}_y`, selector: SENSOR_ENTITY });
  }
  return out;
}

const SENSOR_SCHEMA: FormSchemaItem[] = [
  { name: "device", selector: { device: {} } },
  { name: "name", selector: { text: {} } },
  { name: "x", selector: METRES },
  { name: "y", selector: METRES },
  {
    name: "rotation",
    selector: { number: { mode: "box", min: 0, max: 359, step: 1, unit_of_measurement: "°" } },
  },
  { name: "flip_x", selector: { boolean: {} } },
  { name: "color", selector: { text: {} } },
  ...targetSchema(),
];

const LABELS: Record<string, string> = {
  title: "Card title",
  hide_outside_area: "Hide targets outside their area",
  show_fov: "Show sensor field of view",
  show_legend: "Show tracked-device legend",
  map_fusion: "Use room shapes from Map Fusion",
  map_fusion_frame: "Map Fusion map",
  map_fusion_all_areas: "Show every Map Fusion room, not only the areas below",
  map_fusion_filled: "Fill in furniture gaps (rooms closer to their real walls)",
  area: "Area",
  name: "Label (optional)",
  x: "X position",
  y: "Y position",
  width: "Width",
  height: "Height",
  device: "Device (fills in target entities)",
  rotation: "Facing (0 = down, 90 = left, 180 = up, 270 = right)",
  flip_x: "Mirror sensor X axis",
  color: "Dot color (optional)",
};

function label(item: FormSchemaItem): string {
  const known = LABELS[item.name];
  if (known) return known;
  const m = /^target_(\d+)_(x|y)$/.exec(item.name);
  if (m) return `Target ${m[1]} ${m[2]!.toUpperCase()}`;
  return item.name;
}

const STYLES = `
.pmc-editor { display: flex; flex-direction: column; gap: 16px; }
.pmc-section { border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px; }
.pmc-sensor { margin-left: 8px; background: var(--secondary-background-color, transparent); }
.pmc-body { display: flex; flex-direction: column; gap: 12px; padding: 0 12px 12px; }
.pmc-header { display: flex; align-items: center; gap: 8px; padding: 12px; cursor: pointer; list-style: none; font-weight: 500; }
.pmc-header::-webkit-details-marker { display: none; }
.pmc-header::before { content: "\\25B8"; display: inline-block; transition: transform 0.15s; color: var(--secondary-text-color); }
details[open] > .pmc-header::before { transform: rotate(90deg); }
.pmc-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmc-summary { font-weight: 400; color: var(--secondary-text-color); }
.pmc-button { cursor: pointer; border: 1px solid var(--primary-color, #03a9f4); color: var(--primary-color, #03a9f4); background: transparent; border-radius: 6px; padding: 6px 12px; font: inherit; }
.pmc-status { color: var(--secondary-text-color); font-size: 0.9em; }
.pmc-button[hidden], .pmc-status:empty { display: none; }
.pmc-button.pmc-remove { border-color: var(--error-color, #db4437); color: var(--error-color, #db4437); padding: 2px 8px; }
`;

/** Short number for summaries: 2.5, 4, 0.25. */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function list(value: unknown): Raw[] {
  return Array.isArray(value) ? (value as Raw[]) : [];
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** Copy only the fields the user changed, so untouched defaults stay unwritten. */
function applyChanges(target: Raw, before: Raw, after: Raw, skip?: (key: string) => boolean): string[] {
  const changed: string[] = [];
  const keys = Object.keys(before).concat(Object.keys(after));
  for (const key of keys) {
    if (skip && skip(key)) continue;
    if (changed.indexOf(key) !== -1 || before[key] === after[key]) continue;
    changed.push(key);
    if (isEmpty(after[key])) delete target[key];
    else target[key] = after[key];
  }
  return changed;
}

interface BoundForm {
  el: HaFormElement;
  data: () => Raw;
  /** For forms whose fields change without a rebuild. */
  schema?: () => FormSchemaItem[];
}

/** Things refreshed in place on every update (button visibility, status). */
type Refresher = () => void;

export class PresenceMapCardEditor extends HTMLElement {
  private config: Raw = { type: "custom:presence-map-card" };
  private hassObj?: Hass;
  private structureKey: string | null = null;
  private forms: BoundForm[] = [];
  /** Header summaries, refreshed in place as fields change. */
  private summaries: Array<{ el: HTMLElement; text: () => string }> = [];
  /** Which sections are expanded: "area-i" and "sensor-i-j". */
  private open = new Set<string>();
  private refreshers: Refresher[] = [];
  /** The fused map, fetched once Map Fusion is turned on. */
  private fused: FusedDoc | null = null;
  private fusedFetch: Promise<void> | null = null;
  /** Result of the last "Place on Map Fusion map", by area index. */
  private placeStatus: Record<number, string> = {};

  setConfig(config: Raw): void {
    this.config = clone(config || {});
    this.render();
  }

  set hass(hass: Hass) {
    this.hassObj = hass;
    this.render();
  }

  get hass(): Hass | undefined {
    return this.hassObj;
  }

  connectedCallback(): void {
    this.render();
  }

  // -- Raw config access --------------------------------------------------

  private areas(): Raw[] {
    if (!Array.isArray(this.config.areas)) this.config.areas = [];
    return this.config.areas as Raw[];
  }

  private sensors(area: Raw): Raw[] {
    if (!Array.isArray(area.sensors)) area.sensors = [];
    return area.sensors as Raw[];
  }

  private trackers(): Raw[] {
    if (!Array.isArray(this.config.trackers)) this.config.trackers = [];
    return this.config.trackers as Raw[];
  }

  private currentKey(): string {
    const areas = list(this.config.areas)
      .map((a) => list(a.sensors).length)
      .join(",");
    return `${areas}|${list(this.config.trackers).length}`;
  }

  // -- Rendering ----------------------------------------------------------

  private render(): void {
    if (!this.hassObj) return;
    this.ensureFused();
    const key = this.currentKey();
    if (key !== this.structureKey) {
      this.structureKey = key;
      this.build();
    }
    this.update();
  }

  private update(): void {
    for (const f of this.forms) {
      f.el.hass = this.hassObj;
      if (f.schema) f.el.schema = f.schema();
      f.el.data = f.data();
    }
    for (const s of this.summaries) s.el.textContent = s.text();
    for (const r of this.refreshers) r();
  }

  // -- Map Fusion ---------------------------------------------------------

  private mapFusionOn(): boolean {
    return !!this.config.map_fusion;
  }

  private mapFusionFrame(): FusedFrame | null {
    const mf = this.config.map_fusion;
    const id = mf && typeof mf === "object" ? (mf as Raw).frame : undefined;
    return pickFrame(this.fused, typeof id === "string" && id ? id : undefined);
  }

  private ensureFused(force = false): void {
    const hass = this.hassObj;
    if (!hass || !this.mapFusionOn() || (this.fusedFetch && !force)) return;
    this.fusedFetch = fetchFusedMap(hass)
      .then((doc) => {
        this.fused = doc;
      })
      .catch(() => {
        this.fused = null; // the card itself explains what's wrong
      })
      .then(() => this.update());
  }

  private mapFusionData(): Raw {
    const mf = this.config.map_fusion;
    const obj = mf && typeof mf === "object" ? (mf as Raw) : {};
    return {
      map_fusion: !!mf,
      map_fusion_frame: obj.frame,
      map_fusion_all_areas: obj.all_areas !== false,
      map_fusion_filled: obj.variant === "filled",
    };
  }

  private changeMapFusion(after: Raw): void {
    if (!after.map_fusion) {
      delete this.config.map_fusion;
      return;
    }
    const obj: Raw = {};
    if (typeof after.map_fusion_frame === "string" && after.map_fusion_frame) obj.frame = after.map_fusion_frame;
    if (after.map_fusion_all_areas === false) obj.all_areas = false;
    if (after.map_fusion_filled === true) obj.variant = "filled";
    // Plain `true` unless something non-default is set.
    this.config.map_fusion = Object.keys(obj).length ? obj : true;
    this.ensureFused();
  }

  /** The area's shape in the shown Map Fusion map, if any. */
  private fusedArea(i: number) {
    const frame = this.mapFusionFrame();
    const a = list(this.config.areas)[i];
    const id = a && typeof a.area === "string" ? a.area : "";
    return frame && id ? frame.areas.find((x) => x.area_id === id) : undefined;
  }

  /** Save this area's card box to Map Fusion as a hand placement. */
  private placeOnMap(i: number): void {
    const hass = this.hassObj;
    const frame = this.mapFusionFrame();
    const a = list(this.config.areas)[i];
    if (!hass || !frame || !a || typeof a.area !== "string" || !a.area) return;
    const rect = {
      x: Number(a.x) || 0,
      y: Number(a.y) || 0,
      width: Number(a.width) || DEFAULT_AREA_SIZE.width,
      height: Number(a.height) || DEFAULT_AREA_SIZE.height,
    };
    this.placeStatus[i] = "Saving…";
    this.update();
    placeArea(hass, frame.frame_id, a.area, rect)
      .then(() => {
        this.placeStatus[i] = `Saved to Map Fusion (${frame.name}).`;
        this.ensureFused(true);
      })
      .catch((err: { message?: string }) => {
        this.placeStatus[i] = `Couldn't save: ${(err && err.message) || String(err)}`;
        this.update();
      });
  }

  /** Button + status line under an area, shown when placing makes sense. */
  private placeControls(i: number): HTMLElement[] {
    const button = this.button("Place on Map Fusion map", `place-area-${i}`, () => this.placeOnMap(i));
    const status = document.createElement("div");
    status.className = "pmc-status";
    status.dataset.status = `place-area-${i}`;
    this.refreshers.push(() => {
      const a = list(this.config.areas)[i] || {};
      const admin = !!(this.hassObj && this.hassObj.user && this.hassObj.user.is_admin);
      const fused = this.fusedArea(i);
      const show = this.mapFusionOn() && admin && !!this.mapFusionFrame() && !!a.area && (!fused || fused.origin === "manual");
      button.hidden = !show;
      button.textContent = fused ? "Update Map Fusion shape from this box" : "Place on Map Fusion map";
      const text = this.placeStatus[i] || "";
      if (status.textContent !== text) status.textContent = text;
    });
    return [button, status];
  }

  private build(): void {
    this.forms = [];
    this.summaries = [];
    this.refreshers = [];
    this.placeStatus = {};
    this.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = STYLES;
    this.append(style);

    const root = document.createElement("div");
    root.className = "pmc-editor";
    this.append(root);

    root.append(
      this.form("general", GENERAL_SCHEMA, () => this.generalData(), (before, after) => {
        applyChanges(this.config, before, after);
      }),
    );
    if (this.mapFusionOn() || mapFusionInstalled(this.hassObj)) {
      const mf = this.form("map_fusion", [], () => this.mapFusionData(), (_before, after) => this.changeMapFusion(after));
      this.forms[this.forms.length - 1]!.schema = () =>
        mapFusionSchema(this.mapFusionOn(), this.fused ? this.fused.frames : []);
      root.append(mf);
    }

    list(this.config.areas).forEach((_, i) => root.append(this.areaSection(i)));

    root.append(this.button("Add area", "add-area", () => this.addArea()));
    root.append(this.trackersSection());
  }

  private trackersSection(): HTMLElement {
    const { section, body } = this.section("trackers", "pmc-trackers", "Tracked devices (Bermuda)", () => {
      const n = list(this.config.trackers).length;
      return `· ${n} ${n === 1 ? "device" : "devices"}`;
    });
    list(this.config.trackers).forEach((_, k) => body.append(this.trackerSection(k)));
    body.append(this.button("Add Bermuda device", "add-tracker", () => this.addTracker()));
    return section;
  }

  private trackerSection(k: number): HTMLElement {
    const { section, body } = this.section(
      `tracker-${k}`,
      "pmc-tracker",
      `Device ${k + 1}`,
      () => this.trackerSummary(k),
      {
        action: `remove-tracker-${k}`,
        onRemove: () => {
          this.trackers().splice(k, 1);
          this.shiftOpen((key) => {
            const m = /^tracker-(\d+)$/.exec(key);
            if (!m) return key;
            const n = Number(m[1]);
            if (n === k) return null;
            return n > k ? `tracker-${n - 1}` : key;
          });
          this.commit();
        },
      },
    );
    body.append(
      this.form(
        `tracker-${k}`,
        TRACKER_SCHEMA,
        () => this.trackerData(k),
        (before, after) => this.changeTracker(k, before, after),
        TRACKER_LABELS,
      ),
    );
    return section;
  }

  private trackerData(k: number): Raw {
    const t = list(this.config.trackers)[k] || {};
    return { device: t.device, entity: t.entity, name: t.name, color: t.color };
  }

  private changeTracker(k: number, before: Raw, after: Raw): void {
    const tracker = this.trackers()[k];
    if (!tracker) return;
    applyChanges(tracker, before, after);
    const device = after.device;
    if (typeof device === "string" && device !== "" && device !== before.device && this.hassObj) {
      const entity = discoverBermudaAreaEntity(this.hassObj, device);
      if (entity) tracker.entity = entity;
    }
  }

  private trackerSummary(k: number): string {
    const raw = list(this.config.trackers)[k] || {};
    const t = {
      type: "bermuda",
      device: typeof raw.device === "string" && raw.device ? raw.device : undefined,
      entity: typeof raw.entity === "string" && raw.entity ? raw.entity : undefined,
      name: typeof raw.name === "string" && raw.name ? raw.name : undefined,
    };
    const name = trackerName(this.hassObj, t);
    if (!this.hassObj) return `· ${name}`;
    return `· ${name} · ${trackerLocation(this.hassObj, t).label}`;
  }

  private addTracker(): void {
    const trackers = this.trackers();
    trackers.push({ type: "bermuda" });
    this.open.add("trackers");
    this.open.add(`tracker-${trackers.length - 1}`);
    this.commit();
  }

  private areaSection(i: number): HTMLElement {
    const { section, body } = this.section(
      `area-${i}`,
      "pmc-area",
      `Area ${i + 1}`,
      () => this.areaSummary(i),
      { action: `remove-area-${i}`, onRemove: () => {
        this.areas().splice(i, 1);
        this.shiftOpen((k) => {
          const m = /^(area|sensor)-(\d+)(-\d+)?$/.exec(k);
          if (!m) return k;
          const n = Number(m[2]);
          if (n === i) return null;
          return n > i ? `${m[1]}-${n - 1}${m[3] || ""}` : k;
        });
        this.commit();
      } },
    );

    body.append(
      this.form(`area-${i}`, AREA_SCHEMA, () => this.areaData(i), (before, after) => {
        const area = this.areas()[i];
        if (area) applyChanges(area, before, after);
      }),
    );

    const area = list(this.config.areas)[i];
    list(area && area.sensors).forEach((_, j) => body.append(this.sensorSection(i, j)));

    for (const el of this.placeControls(i)) body.append(el);
    body.append(this.button("Add LD2450 sensor", `add-sensor-${i}`, () => this.addSensor(i)));
    return section;
  }

  private sensorSection(i: number, j: number): HTMLElement {
    const sensor = this.sensorAt(i, j);
    const driver = getDriver(String((sensor && sensor.type) || "ld2450"));
    const title = `${driver ? driver.label : "Sensor"} ${j + 1}`;
    const { section, body } = this.section(
      `sensor-${i}-${j}`,
      "pmc-sensor",
      title,
      () => this.sensorSummary(i, j),
      { action: `remove-sensor-${i}-${j}`, onRemove: () => {
        const area = this.areas()[i];
        if (area) this.sensors(area).splice(j, 1);
        this.shiftOpen((k) => {
          const m = /^sensor-(\d+)-(\d+)$/.exec(k);
          if (!m || Number(m[1]) !== i) return k;
          const n = Number(m[2]);
          if (n === j) return null;
          return n > j ? `sensor-${i}-${n - 1}` : k;
        });
        this.commit();
      } },
    );
    body.append(
      this.form(`sensor-${i}-${j}`, SENSOR_SCHEMA, () => this.sensorData(i, j), (before, after) =>
        this.changeSensor(i, j, before, after),
      ),
    );
    return section;
  }

  /** A collapsible section: header with title, live summary and optional Remove. */
  private section(
    key: string,
    kind: string,
    title: string,
    summary: () => string,
    remove?: { action: string; onRemove: () => void },
  ): { section: HTMLDetailsElement; body: HTMLElement } {
    const section = document.createElement("details");
    section.className = `pmc-section ${kind}`;
    section.dataset.section = key;
    section.open = this.open.has(key);
    section.addEventListener("toggle", () => {
      if (section.open) this.open.add(key);
      else this.open.delete(key);
    });

    const header = document.createElement("summary");
    header.className = "pmc-header";
    const titleEl = document.createElement("span");
    titleEl.className = "pmc-title";
    titleEl.textContent = title;
    const summaryEl = document.createElement("span");
    summaryEl.className = "pmc-summary";
    titleEl.append(" ", summaryEl);
    this.summaries.push({ el: summaryEl, text: summary });
    header.append(titleEl);

    if (remove) {
      const button = this.button("Remove", remove.action, remove.onRemove);
      button.classList.add("pmc-remove");
      // A click inside <summary> would also toggle the section.
      button.addEventListener("click", (e) => e.preventDefault());
      header.append(button);
    }

    const body = document.createElement("div");
    body.className = "pmc-body";
    section.append(header, body);
    return { section, body };
  }

  /** Re-key open sections after a removal; null drops the key. */
  private shiftOpen(map: (key: string) => string | null): void {
    const next = new Set<string>();
    this.open.forEach((k) => {
      const m = map(k);
      if (m !== null) next.add(m);
    });
    this.open = next;
  }

  private areaSummary(i: number): string {
    const a = list(this.config.areas)[i] || {};
    const id = typeof a.area === "string" ? a.area : "";
    const ha = id && this.hassObj && this.hassObj.areas ? this.hassObj.areas[id] : undefined;
    const name = (typeof a.name === "string" && a.name) || (ha && ha.name) || id || "No area picked";
    if (this.mapFusionOn()) {
      const fused = this.fusedArea(i);
      if (fused) {
        const how = fused.origin === "manual" ? "placed in Map Fusion" : "from the vacuum map";
        return `· ${name} · ${fmt(fused.rect.width)} × ${fmt(fused.rect.height)} m, ${how}`;
      }
      const placed = ["x", "y", "width", "height"].some((k) => !isEmpty(a[k]));
      if (!placed) return `· ${name} · not on the map yet`;
    }
    const w = Number(a.width) || DEFAULT_AREA_SIZE.width;
    const h = Number(a.height) || DEFAULT_AREA_SIZE.height;
    return `· ${name} · ${fmt(w)} × ${fmt(h)} m at (${fmt(Number(a.x) || 0)}, ${fmt(Number(a.y) || 0)})`;
  }

  private sensorSummary(i: number, j: number): string {
    const s = this.sensorAt(i, j) || {};
    const parts: string[] = [];
    if (typeof s.name === "string" && s.name) parts.push(s.name);
    parts.push(`(${fmt(Number(s.x) || 0)}, ${fmt(Number(s.y) || 0)})`);
    parts.push(`${fmt(Number(s.rotation) || 0)}°`);
    if (s.flip_x === true) parts.push("mirrored");
    return `· ${parts.join(" · ")}`;
  }

  private button(text: string, action: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pmc-button";
    button.textContent = text;
    button.dataset.action = action;
    button.addEventListener("click", onClick);
    return button;
  }

  private form(
    id: string,
    schema: FormSchemaItem[],
    data: () => Raw,
    onChange: (before: Raw, after: Raw) => void,
    labels?: Record<string, string>,
  ): HaFormElement {
    const el = document.createElement("ha-form") as HaFormElement;
    el.dataset.form = id;
    el.schema = schema;
    el.computeLabel = (item) => (labels && labels[item.name]) || label(item);
    el.addEventListener("value-changed", (event) => {
      event.stopPropagation();
      const detail = (event as CustomEvent<{ value?: Raw }>).detail;
      onChange(data(), (detail && detail.value) || {});
      this.commit();
    });
    this.forms.push({ el, data });
    return el;
  }

  // -- Form data ----------------------------------------------------------

  private generalData(): Raw {
    return {
      title: this.config.title,
      hide_outside_area: this.config.hide_outside_area !== false,
      show_fov: this.config.show_fov !== false,
      show_legend: this.config.show_legend !== false,
    };
  }

  private areaData(i: number): Raw {
    const area = list(this.config.areas)[i] || {};
    return {
      area: area.area,
      name: area.name,
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    };
  }

  private sensorAt(i: number, j: number): Raw | undefined {
    const area = list(this.config.areas)[i];
    return area ? list(area.sensors)[j] : undefined;
  }

  private sensorData(i: number, j: number): Raw {
    const s = this.sensorAt(i, j) || {};
    const data: Raw = {
      device: s.device,
      name: s.name,
      x: s.x,
      y: s.y,
      rotation: s.rotation,
      flip_x: s.flip_x === true,
      color: s.color,
    };
    const targets = list(s.targets);
    for (let k = 0; k < TARGET_SLOTS; k++) {
      const t = targets[k] || {};
      data[`target_${k + 1}_x`] = isEmpty(t.x) ? undefined : t.x;
      data[`target_${k + 1}_y`] = isEmpty(t.y) ? undefined : t.y;
    }
    return data;
  }

  private changeSensor(i: number, j: number, before: Raw, after: Raw): void {
    const sensor = this.sensorAt(i, j);
    if (!sensor) return;
    const isTarget = (key: string) => /^target_\d+_(x|y)$/.test(key);

    applyChanges(sensor, before, after, isTarget);
    // flip_x is shown as false by default; don't write `flip_x: false` back.
    if (sensor.flip_x === false) delete sensor.flip_x;

    const targetsChanged = Object.keys(after)
      .concat(Object.keys(before))
      .some((key) => isTarget(key) && before[key] !== after[key]);
    if (targetsChanged) {
      const targets: Raw[] = [];
      for (let k = 0; k < TARGET_SLOTS; k++) {
        const x = after[`target_${k + 1}_x`];
        const y = after[`target_${k + 1}_y`];
        targets.push({ x: isEmpty(x) ? "" : x, y: isEmpty(y) ? "" : y });
      }
      while (targets.length && isEmpty(targets[targets.length - 1]!.x) && isEmpty(targets[targets.length - 1]!.y)) {
        targets.pop();
      }
      if (targets.length) sensor.targets = targets;
      else delete sensor.targets;
    }

    const device = after.device;
    if (typeof device === "string" && device !== "" && device !== before.device && this.hassObj) {
      const driver = getDriver(String(sensor.type || "ld2450"));
      const found = driver && driver.discover ? driver.discover(this.hassObj, device) : [];
      if (found.length) sensor.targets = found.map((t) => ({ x: t.x, y: t.y }));
    }
  }

  // -- Structure changes --------------------------------------------------

  private addArea(): void {
    const areas = this.areas();
    const used = areas.map((a) => a.area);
    const ids = Object.keys((this.hassObj && this.hassObj.areas) || {});
    let id = "";
    for (const candidate of ids) {
      if (used.indexOf(candidate) === -1) {
        id = candidate;
        break;
      }
    }
    if (this.mapFusionOn()) {
      // Map Fusion supplies the shape; a box can still be added by hand.
      areas.push({ area: id, sensors: [] });
      this.open.add(`area-${areas.length - 1}`);
      this.commit();
      return;
    }
    let x = 0;
    for (const a of areas) {
      const right = (Number(a.x) || 0) + (Number(a.width) || DEFAULT_AREA_SIZE.width);
      if (right > x) x = right;
    }
    areas.push({
      area: id,
      x,
      y: 0,
      width: DEFAULT_AREA_SIZE.width,
      height: DEFAULT_AREA_SIZE.height,
      sensors: [],
    });
    this.open.add(`area-${areas.length - 1}`);
    this.commit();
  }

  private addSensor(i: number): void {
    const area = this.areas()[i];
    if (!area) return;
    const fused = this.mapFusionOn() ? this.fusedArea(i) : undefined;
    const width = fused ? fused.rect.width : Number(area.width) || DEFAULT_AREA_SIZE.width;
    // Default: middle of the top wall, facing into the room.
    const sensors = this.sensors(area);
    sensors.push({ type: "ld2450", x: width / 2, y: 0, rotation: 0 });
    this.open.add(`area-${i}`);
    this.open.add(`sensor-${i}-${sensors.length - 1}`);
    this.commit();
  }

  private commit(): void {
    fireEvent(this, "config-changed", { config: clone(this.config) });
    this.render();
  }
}
