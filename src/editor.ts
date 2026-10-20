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
.pmc-section { border: 1px solid var(--divider-color, #e0e0e0); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.pmc-sensor { margin-left: 8px; background: var(--secondary-background-color, transparent); }
.pmc-header { display: flex; align-items: center; justify-content: space-between; font-weight: 500; }
.pmc-button { cursor: pointer; border: 1px solid var(--primary-color, #03a9f4); color: var(--primary-color, #03a9f4); background: transparent; border-radius: 6px; padding: 6px 12px; font: inherit; }
.pmc-button.pmc-remove { border-color: var(--error-color, #db4437); color: var(--error-color, #db4437); padding: 2px 8px; }
`;

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
  }

  private build(): void {
    this.forms = [];
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
    const section = document.createElement("div");
    section.className = "pmc-section pmc-area";
    section.append(this.header(`Area ${i + 1}`, `remove-area-${i}`, () => {
      this.areas().splice(i, 1);
      this.commit();
    }));

    section.append(
      this.form(`area-${i}`, AREA_SCHEMA, () => this.areaData(i), (before, after) => {
        const area = this.areas()[i];
        if (area) applyChanges(area, before, after);
      }),
    );

    const area = list(this.config.areas)[i];
    list(area && area.sensors).forEach((_, j) => section.append(this.sensorSection(i, j)));

    section.append(this.button("Add LD2450 sensor", `add-sensor-${i}`, () => this.addSensor(i)));
    return section;
  }

  private sensorSection(i: number, j: number): HTMLElement {
    const section = document.createElement("div");
    section.className = "pmc-section pmc-sensor";
    const sensor = this.sensorAt(i, j);
    const driver = getDriver(String((sensor && sensor.type) || "ld2450"));
    const title = `${driver ? driver.label : "Sensor"} ${j + 1}`;
    section.append(this.header(title, `remove-sensor-${i}-${j}`, () => {
      const area = this.areas()[i];
      if (area) this.sensors(area).splice(j, 1);
      this.commit();
    }));
    section.append(
      this.form(`sensor-${i}-${j}`, SENSOR_SCHEMA, () => this.sensorData(i, j), (before, after) =>
        this.changeSensor(i, j, before, after),
      ),
    );
    return section;
  }

  private header(text: string, action: string, onRemove: () => void): HTMLElement {
    const header = document.createElement("div");
    header.className = "pmc-header";
    const span = document.createElement("span");
    span.textContent = text;
    header.append(span);
    const remove = this.button("Remove", action, onRemove);
    remove.classList.add("pmc-remove");
    header.append(remove);
    return header;
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
    this.commit();
  }

  private addSensor(i: number): void {
    const area = this.areas()[i];
    if (!area) return;
    const width = Number(area.width) || DEFAULT_AREA_SIZE.width;
    // Default: middle of the top wall, facing into the room.
    this.sensors(area).push({ type: "ld2450", x: width / 2, y: 0, rotation: 0 });
    this.commit();
  }

  private commit(): void {
    fireEvent(this, "config-changed", { config: clone(this.config) });
    this.render();
  }
}
