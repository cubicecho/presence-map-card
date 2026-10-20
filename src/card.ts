/**
 * <presence-map-card>: draws each configured area as a box and plots the
 * targets its sensors report.
 *
 * The SVG skeleton (areas, sensors, one hidden dot per target) is rebuilt
 * only when it would look different. Sensor updates, which can arrive
 * several times a second, just move the dots.
 */
import { DEFAULT_AREA_SIZE, normalizeConfig, type CardConfig } from "./config.js";
import { escapeHtml } from "./dom.js";
import { fovPath, insideArea, mapBounds, sensorOrigin, sensorToMap } from "./geometry.js";
import { getDriver } from "./sensors/registry.js";
import { trackerLocation, trackerName } from "./trackers/bermuda.js";
import { STYLES } from "./styles.js";
import type { Hass } from "./types.js";

const PALETTE = ["#03a9f4", "#ff9800", "#4caf50", "#e91e63", "#9c27b0", "#009688"];
/** Kept apart from PALETTE so tracker rings don't read as sensor colours. */
const TRACKER_PALETTE = ["#e91e63", "#8bc34a", "#ffc107", "#3f51b5", "#ff5722", "#00bcd4", "#795548"];

/** Per-area layout the tracker rings are placed from. */
interface LabelBox {
  x: number;
  y: number;
  font: number;
  ring: number;
  right: number;
  name: string;
}

function prettify(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export class PresenceMapCard extends HTMLElement {
  private config?: CardConfig;
  private hassObj?: Hass;
  private root: ShadowRoot;
  private lastHtml = "";
  private error: string | null = null;
  private labels: LabelBox[] = [];

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  static getConfigElement(): HTMLElement {
    return document.createElement("presence-map-card-editor");
  }

  static getStubConfig(hass?: Hass): Record<string, unknown> {
    const first = hass && hass.areas ? Object.keys(hass.areas)[0] : undefined;
    return {
      areas: first ? [{ area: first, x: 0, y: 0, ...DEFAULT_AREA_SIZE, sensors: [] }] : [],
    };
  }

  setConfig(config: unknown): void {
    // Throwing makes Lovelace show its own error card with this message.
    this.config = normalizeConfig(config);
    this.render();
  }

  set hass(hass: Hass) {
    this.hassObj = hass;
    this.render();
  }

  get hass(): Hass | undefined {
    return this.hassObj;
  }

  getCardSize(): number {
    const b = this.config ? mapBounds(this.config.areas) : null;
    if (!b) return 2;
    const ratio = (b.maxY - b.minY) / Math.max(0.1, b.maxX - b.minX);
    return Math.min(12, Math.max(2, Math.round(1 + ratio * 6)));
  }

  connectedCallback(): void {
    this.render();
  }

  // -- rendering --------------------------------------------------------

  private render(): void {
    if (!this.config) return;
    let html: string;
    try {
      html = this.template(this.config);
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      html = `<style>${STYLES}</style><ha-card><div class="error">${escapeHtml(this.error)}</div></ha-card>`;
    }
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.root.innerHTML = html;
    }
    if (!this.error) {
      this.updateTargets(this.config);
      this.updateTrackers(this.config);
    }
  }

  private areaName(id: string, override?: string): string {
    if (override) return override;
    const a = this.hassObj && this.hassObj.areas ? this.hassObj.areas[id] : undefined;
    return a ? a.name : prettify(id);
  }

  private template(config: CardConfig): string {
    const header = config.title ? `<div class="header">${escapeHtml(config.title)}</div>` : "";
    const bounds = mapBounds(config.areas);
    if (!bounds) {
      return `<style>${STYLES}</style><ha-card>${header}<div class="empty">Add an area in the card editor to start the map.</div></ha-card>`;
    }

    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const span = Math.max(spanX, spanY);
    const pad = Math.max(0.1, span * 0.02);
    const font = Math.min(0.6, Math.max(0.12, span * 0.03));
    const dotR = Math.min(0.25, Math.max(0.08, span * 0.012));
    const f = (n: number) => n.toFixed(3);

    this.labels = [];
    const defs: string[] = [];
    const areas: string[] = [];
    const overlays: string[] = [];
    const dots: string[] = [];
    let sensorIndex = 0;

    config.areas.forEach((area, ai) => {
      const name = this.areaName(area.area, area.name);
      defs.push(
        `<clipPath id="clip-${ai}"><rect x="${f(area.x)}" y="${f(area.y)}" width="${f(area.width)}" height="${f(area.height)}"/></clipPath>`,
      );
      areas.push(
        `<g class="area" data-area="${escapeHtml(area.area)}"><title>${escapeHtml(name)}</title>` +
          `<rect class="area-box" x="${f(area.x)}" y="${f(area.y)}" width="${f(area.width)}" height="${f(area.height)}"/>` +
          `<text class="area-label" data-label="${ai}" x="${f(area.x + font * 0.5)}" y="${f(area.y + font * 1.3)}" font-size="${f(font)}">${escapeHtml(name)}</text>` +
          `<g class="trackers" data-trackers="${ai}"></g></g>`,
      );
      this.labels.push({
        x: area.x + font * 0.5,
        y: area.y + font * 1.3,
        font,
        ring: dotR * 0.75,
        right: area.x + area.width - font * 0.3,
        name,
      });

      area.sensors.forEach((sensor, si) => {
        const driver = getDriver(sensor.type);
        const color = escapeHtml(sensor.color || PALETTE[sensorIndex++ % PALETTE.length]);
        if (!driver) return;
        if (config.show_fov && driver.fov) {
          overlays.push(
            `<path class="fov" clip-path="url(#clip-${ai})" fill="${color}" d="${fovPath(area, sensor, driver.fov.halfAngle, driver.fov.range)}"/>`,
          );
        }
        const o = sensorOrigin(area, sensor);
        overlays.push(
          `<circle class="sensor" cx="${f(o.x)}" cy="${f(o.y)}" r="${f(dotR * 0.7)}" fill="${color}"><title>${escapeHtml(sensor.name || driver.label)}</title></circle>`,
        );
        driver.targets(this.hassObj, sensor).forEach((_t, ti) => {
          dots.push(
            `<circle class="target hidden" data-target="${ai}-${si}-${ti}" cx="0" cy="0" r="${f(dotR)}" fill="${color}"/>`,
          );
        });
      });
    });

    const viewBox = [bounds.minX - pad, bounds.minY - pad, spanX + pad * 2, spanY + pad * 2].map(f).join(" ");
    return (
      `<style>${STYLES}</style><ha-card>${header}<div class="map">` +
      `<svg viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Presence map">` +
      `<defs>${defs.join("")}</defs>${areas.join("")}${overlays.join("")}<g class="targets">${dots.join("")}</g>` +
      `</svg></div>${this.legend(config)}</ha-card>`
    );
  }

  private trackerColor(config: CardConfig, k: number): string {
    const t = config.trackers[k];
    return (t && t.color) || TRACKER_PALETTE[k % TRACKER_PALETTE.length]!;
  }

  private legend(config: CardConfig): string {
    if (!config.show_legend || !config.trackers.length) return "";
    const items = config.trackers.map((t, k) => {
      const color = escapeHtml(this.trackerColor(config, k));
      return (
        `<div class="legend-item" data-tracker="${k}">` +
        `<svg class="swatch" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" stroke="${color}"/></svg>` +
        `<span class="legend-name">${escapeHtml(trackerName(this.hassObj, t))}</span>` +
        `<span class="legend-area" data-tracker-area="${k}"></span></div>`
      );
    });
    return `<div class="legend">${items.join("")}</div>`;
  }

  /** Width of an area's label in map units; estimated where SVG can't measure. */
  private labelWidth(ai: number, box: LabelBox): number {
    const el = this.root.querySelector<SVGTextElement>(`[data-label="${ai}"]`);
    try {
      const w = el && typeof el.getComputedTextLength === "function" ? el.getComputedTextLength() : 0;
      if (w > 0) return w;
    } catch {
      // Not laid out yet (hidden card); fall back to the estimate.
    }
    return box.name.length * box.font * 0.55;
  }

  /** Place a hollow ring beside each area's name for every tracker in it. */
  private updateTrackers(config: CardConfig): void {
    const hass = this.hassObj;
    if (!hass || !config.trackers.length) return;
    const locations = config.trackers.map((t) => trackerLocation(hass, t));

    locations.forEach((loc, k) => {
      const el = this.root.querySelector(`[data-tracker-area="${k}"]`);
      if (el && el.textContent !== loc.label) el.textContent = loc.label;
    });

    const f = (n: number) => n.toFixed(3);
    config.areas.forEach((area, ai) => {
      const group = this.root.querySelector(`[data-trackers="${ai}"]`);
      const box = this.labels[ai];
      if (!group || !box) return;
      const inside: number[] = [];
      locations.forEach((loc, k) => {
        if (loc.areaId === area.area) inside.push(k);
      });

      const step = box.ring * 3.2;
      let x = box.x + this.labelWidth(ai, box) + box.font * 0.4 + box.ring;
      let y = box.y - box.font * 0.35;
      const rings = inside.map((k) => {
        if (x + box.ring > box.right && x > box.x + box.ring * 2) {
          // Out of room on this line: wrap below the label.
          x = box.x + box.ring;
          y += box.font * 1.1;
        }
        const name = escapeHtml(trackerName(hass, config.trackers[k]!));
        const ring =
          `<circle class="tracker" data-tracker-ring="${k}" cx="${f(x)}" cy="${f(y)}" r="${f(box.ring)}" stroke="${escapeHtml(this.trackerColor(config, k))}"><title>${name}</title></circle>`;
        x += step;
        return ring;
      });
      const html = rings.join("");
      if (group.getAttribute("data-html") !== html) {
        group.setAttribute("data-html", html);
        group.innerHTML = html;
      }
    });
  }

  private updateTargets(config: CardConfig): void {
    const hass = this.hassObj;
    if (!hass) return;
    config.areas.forEach((area, ai) => {
      area.sensors.forEach((sensor, si) => {
        const driver = getDriver(sensor.type);
        if (!driver) return;
        driver.targets(hass, sensor).forEach((target, ti) => {
          const dot = this.root.querySelector<SVGCircleElement>(`[data-target="${ai}-${si}-${ti}"]`);
          if (!dot) return;
          const local = driver.read(hass, target);
          const p = local ? sensorToMap(area, sensor, local) : null;
          const visible = !!p && (!config.hide_outside_area || insideArea(area, p));
          if (p && visible) {
            // CSS transform (not the attribute) so moves animate. A dot that
            // was hidden jumps straight to its spot instead of sliding there.
            const appearing = dot.classList.contains("hidden");
            if (appearing) dot.style.transition = "none";
            dot.style.transform = `translate(${p.x.toFixed(3)}px, ${p.y.toFixed(3)}px)`;
            if (appearing) {
              void dot.getBoundingClientRect();
              dot.style.transition = "";
            }
          }
          dot.classList.toggle("hidden", !visible);
        });
      });
    });
  }
}
