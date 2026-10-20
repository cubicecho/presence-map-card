/** Minimal structural types for the parts of Home Assistant the card touches. */

export interface HassEntity {
  entity_id: string;
  state: string;
  last_changed: string;
  last_updated: string;
  attributes: Record<string, unknown> & {
    friendly_name?: string;
    unit_of_measurement?: string;
  };
}

export interface HassArea {
  area_id: string;
  name: string;
}

export interface HassDevice {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  area_id?: string | null;
}

/** An entry of `hass.entities` (the entity registry display list). */
export interface HassEntityEntry {
  entity_id: string;
  device_id?: string | null;
  area_id?: string | null;
}

export interface Hass {
  states: Record<string, HassEntity>;
  areas?: Record<string, HassArea>;
  devices?: Record<string, HassDevice>;
  entities?: Record<string, HassEntityEntry>;
}

/** A point in metres. */
export interface Point {
  x: number;
  y: number;
}
