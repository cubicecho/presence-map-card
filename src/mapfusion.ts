/**
 * Map Fusion support: room shapes from the Map Fusion integration
 * (https://github.com/cubicecho/map_fusion_ha_integration).
 *
 * Map Fusion builds one map per floor (a "frame") from robot vacuum maps,
 * with each room tied to a Home Assistant area. It uses the same units and
 * axes as this card (metres, y down), so its shapes drop straight in:
 *
 * - An area's box (x, y, width, height) is Map Fusion's `rect`, the
 *   bounding box of its outline. Sensors stay relative to its top-left.
 * - The outline (`polygons`) is drawn instead of the box and used for
 *   "is this target inside the area".
 * - Card x/y/width/height are only a fallback for areas Map Fusion hasn't
 *   placed.
 */
import type { AreaConfig, CardConfig } from "./config.js";
import type { Hass, HassConnection, Point } from "./types.js";

/** Fused map document versions this card understands. */
export const SUPPORTED_VERSION = 1;

type Pair = [number, number];

export interface FusedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FusedArea {
  area_id: string;
  name: string;
  polygons: Pair[][];
  rect: FusedRect;
  label_point: Pair;
  origin: "vacuum" | "manual";
  geometry: "pixels" | "bbox" | "manual";
}

export interface FusedRoom {
  segment_id: string;
  name?: string | null;
  polygons: Pair[][];
  rect: FusedRect;
}

export interface FusedFrame {
  frame_id: string;
  floor_id: string | null;
  name: string;
  areas: FusedArea[];
  unmapped_rooms: FusedRoom[];
}

export interface FusedDoc {
  version: number;
  frames: FusedFrame[];
  unplaced_areas: Array<{ area_id: string; name: string }>;
}

/** An area as the card draws it: config plus where its shape came from. */
export interface MapArea extends AreaConfig {
  /** Outline pieces in map metres; absent for plain boxes. */
  polygons?: Point[][];
  /** Where to centre the label (outlines only). */
  label?: Point;
  shape: "card" | "map_fusion";
}

export interface ResolvedMap {
  areas: MapArea[];
  /** Vacuum rooms not linked to an area: drawn faintly, for context. */
  rooms: Point[][][];
  /** Configured areas with no shape from either Map Fusion or the card. */
  missing: string[];
  frame: FusedFrame | null;
  /** Something to tell the user (frame not found, unsupported version). */
  problem: string | null;
}

function points(rings: Pair[][]): Point[][] {
  return rings.map((ring) => ring.map((p) => ({ x: p[0], y: p[1] })));
}

/** The frame to show: the configured one, else the first. */
export function pickFrame(doc: FusedDoc | null, frameId?: string): FusedFrame | null {
  if (!doc || !doc.frames.length) return null;
  if (!frameId) return doc.frames[0]!;
  for (const f of doc.frames) if (f.frame_id === frameId) return f;
  return null;
}

/** Combine the card's areas with Map Fusion's shapes. */
export function resolveAreas(config: CardConfig, doc: FusedDoc | null): ResolvedMap {
  const mf = config.map_fusion;
  if (!mf) {
    return {
      areas: config.areas.map((a) => ({ ...a, shape: "card" as const })),
      rooms: [],
      missing: [],
      frame: null,
      problem: null,
    };
  }

  let problem: string | null = null;
  let frame: FusedFrame | null = null;
  if (doc && doc.version !== SUPPORTED_VERSION) {
    problem = `Map Fusion map version ${doc.version} isn't supported by this card version. Update the card.`;
  } else {
    frame = pickFrame(doc, mf.frame);
    if (doc && mf.frame && !frame) {
      const ids = doc.frames.map((f) => f.frame_id).join(", ") || "none";
      problem = `Map Fusion has no map "${mf.frame}" (available: ${ids}).`;
    }
  }

  const byId: Record<string, FusedArea> = {};
  if (frame) for (const a of frame.areas) byId[a.area_id] = a;

  const areas: MapArea[] = [];
  const missing: string[] = [];
  const configured: Record<string, true> = {};
  for (const area of config.areas) {
    configured[area.area] = true;
    const fused = byId[area.area];
    if (fused) {
      areas.push({
        ...area,
        x: fused.rect.x,
        y: fused.rect.y,
        width: fused.rect.width,
        height: fused.rect.height,
        polygons: points(fused.polygons),
        label: { x: fused.label_point[0], y: fused.label_point[1] },
        shape: "map_fusion",
      });
    } else if (area.placed) {
      areas.push({ ...area, shape: "card" });
    } else {
      missing.push(area.area);
    }
  }

  if (frame && mf.all_areas) {
    const rest = frame.areas.filter((a) => !configured[a.area_id]);
    rest.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
    for (const fused of rest) {
      areas.push({
        area: fused.area_id,
        name: fused.name,
        placed: true,
        x: fused.rect.x,
        y: fused.rect.y,
        width: fused.rect.width,
        height: fused.rect.height,
        sensors: [],
        polygons: points(fused.polygons),
        label: { x: fused.label_point[0], y: fused.label_point[1] },
        shape: "map_fusion",
      });
    }
  }

  const rooms = frame && mf.all_areas ? frame.unmapped_rooms.map((r) => points(r.polygons)) : [];
  return { areas, rooms, missing, frame, problem };
}

function errorText(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  if (e && e.code === "unknown_command") return "Map Fusion isn't installed.";
  if (e && e.code === "not_loaded") return "Map Fusion isn't set up. Add it under Settings → Devices & services.";
  return `Map Fusion: ${(e && e.message) || String(err)}`;
}

/** First retry after a failed subscribe; doubles up to RETRY_MAX_MS. */
export const RETRY_MIN_MS = 10_000;
export const RETRY_MAX_MS = 5 * 60_000;

/**
 * Keeps one `map_fusion/subscribe` open while the card wants it. Safe to
 * call `update` on every hass change: it only resubscribes when the
 * connection changes or Map Fusion is turned on.
 *
 * A failed subscribe (Map Fusion not loaded yet, restarting, not installed)
 * is retried with backoff, so the card recovers without a page reload.
 */
export class FusedMapSubscription {
  private unsubscribe: Promise<(() => void) | void> | null = null;
  private connection: HassConnection | null = null;
  private variant = "traced";
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_MIN_MS;

  constructor(private readonly onChange: (doc: FusedDoc | null, error: string | null) => void) {}

  update(hass: Hass | undefined, enabled: boolean, variant = "traced"): void {
    const connection = enabled && hass && hass.connection ? hass.connection : null;
    if (connection === this.connection && variant === this.variant) return;
    this.stop();
    this.variant = variant;
    if (!connection) return;
    this.connection = connection;
    this.subscribe(connection);
  }

  private subscribe(connection: HassConnection): void {
    // Older Map Fusion versions don't know `variant`; only send it when needed.
    const message: Record<string, unknown> = { type: "map_fusion/subscribe" };
    if (this.variant !== "traced") message.variant = this.variant;
    this.unsubscribe = connection
      .subscribeMessage<FusedDoc | null>((doc) => {
        this.retryDelay = RETRY_MIN_MS;
        this.onChange(doc, null);
      }, message)
      .catch((err: unknown) => {
        if (this.connection !== connection) return;
        this.unsubscribe = null;
        this.onChange(null, errorText(err));
        this.scheduleRetry(connection);
      });
  }

  private scheduleRetry(connection: HassConnection): void {
    const delay = this.retryDelay;
    this.retryDelay = Math.min(RETRY_MAX_MS, delay * 2);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.connection === connection) this.subscribe(connection);
    }, delay);
  }

  stop(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryDelay = RETRY_MIN_MS;
    const pending = this.unsubscribe;
    this.unsubscribe = null;
    this.connection = null;
    if (pending) {
      pending
        .then((unsub) => {
          if (unsub) unsub();
        })
        .catch(() => undefined);
    }
  }
}

/** Ask Map Fusion to place an area (admin only). */
export function placeArea(
  hass: Hass,
  frameId: string,
  areaId: string,
  rect: FusedRect,
): Promise<unknown> {
  if (!hass.callWS) return Promise.reject(new Error("No connection to Home Assistant"));
  return hass.callWS({ type: "map_fusion/area/set", frame_id: frameId, area_id: areaId, rect });
}

/** One-off fetch of the fused map (the editor uses this). */
export function fetchFusedMap(hass: Hass): Promise<FusedDoc | null> {
  if (!hass.callWS) return Promise.resolve(null);
  return hass.callWS<FusedDoc | null>({ type: "map_fusion/get" });
}

export function mapFusionInstalled(hass: Hass | undefined): boolean {
  return !!(hass && hass.config && hass.config.components && hass.config.components.indexOf("map_fusion") !== -1);
}
