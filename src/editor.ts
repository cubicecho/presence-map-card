/**
 * Visual editor for the card.
 *
 * Built from Home Assistant's own `<ha-form>`, so the area, device and entity
 * pickers match every other card editor. Rendered in the light DOM so the
 * dialog's theme applies.
 *
 * It edits the raw config (not the normalized one) so saving doesn't write
 * defaults the user never chose. The DOM is rebuilt only when areas or
 * sensors are added or removed; otherwise each form's data is updated in
 * place, so typing doesn't lose focus.
 */
import { DEFAULT_AREA_SIZE } from "./config.js";
import { fireEvent } from "./dom.js";
import { getDriver } from "./sensors/registry.js";
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
];

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
}

export class PresenceMapCardEditor extends HTMLElement {
  private config: Raw = { type: "custom:presence-map-card" };
  private hassObj?: Hass;
  private structureKey: string | null = null;
  private forms: BoundForm[] = [];
  /** Header summaries, refreshed in place as fields change. */
  private summaries: Array<{ el: HTMLElement; text: () => string }> = [];
  /** Which sections are expanded: "area-i" and "sensor-i-j". */
  private open = new Set<string>();

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

  private currentKey(): string {
    return list(this.config.areas)
      .map((a) => list(a.sensors).length)
      .join(",");
  }

  // -- Rendering ----------------------------------------------------------

  private render(): void {
    if (!this.hassObj) return;
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
      f.el.data = f.data();
    }
    for (const s of this.summaries) s.el.textContent = s.text();
  }

  private build(): void {
    this.forms = [];
    this.summaries = [];
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

    list(this.config.areas).forEach((_, i) => root.append(this.areaSection(i)));

    root.append(this.button("Add area", "add-area", () => this.addArea()));
  }

  private areaSection(i: number): HTMLElement {
    const { section, body } = this.section(
      `area-${i}`,
      "pmc-area",
      `Area ${i + 1}`,
      () => this.areaSummary(i),
      `remove-area-${i}`,
      () => {
        this.areas().splice(i, 1);
        this.shiftOpen((k) => {
          const m = /^(area|sensor)-(\d+)(-\d+)?$/.exec(k);
          if (!m) return k;
          const n = Number(m[2]);
          if (n === i) return null;
          return n > i ? `${m[1]}-${n - 1}${m[3] || ""}` : k;
        });
        this.commit();
      },
    );

    body.append(
      this.form(`area-${i}`, AREA_SCHEMA, () => this.areaData(i), (before, after) => {
        const area = this.areas()[i];
        if (area) applyChanges(area, before, after);
      }),
    );

    const area = list(this.config.areas)[i];
    list(area && area.sensors).forEach((_, j) => body.append(this.sensorSection(i, j)));

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
      `remove-sensor-${i}-${j}`,
      () => {
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
      },
    );
    body.append(
      this.form(`sensor-${i}-${j}`, SENSOR_SCHEMA, () => this.sensorData(i, j), (before, after) =>
        this.changeSensor(i, j, before, after),
      ),
    );
    return section;
  }

  /** A collapsible section: header with title, live summary and Remove. */
  private section(
    key: string,
    kind: string,
    title: string,
    summary: () => string,
    removeAction: string,
    onRemove: () => void,
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

    const remove = this.button("Remove", removeAction, onRemove);
    remove.classList.add("pmc-remove");
    // A click inside <summary> would also toggle the section.
    remove.addEventListener("click", (e) => e.preventDefault());
    header.append(remove);

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
  ): HaFormElement {
    const el = document.createElement("ha-form") as HaFormElement;
    el.dataset.form = id;
    el.schema = schema;
    el.computeLabel = label;
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
    const width = Number(area.width) || DEFAULT_AREA_SIZE.width;
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
