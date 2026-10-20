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

/** The websocket connection (home-assistant-js-websocket). */
export interface HassConnection {
  subscribeMessage<T>(callback: (message: T) => void, message: Record<string, unknown>): Promise<() => void>;
}

export interface Hass {
  states: Record<string, HassEntity>;
  areas?: Record<string, HassArea>;
  devices?: Record<string, HassDevice>;
  entities?: Record<string, HassEntityEntry>;
  connection?: HassConnection;
  callWS?<T>(message: Record<string, unknown>): Promise<T>;
  user?: { is_admin?: boolean } | null;
  config?: { components?: string[] };
}

/** A point in metres. */
export interface Point {
  x: number;
  y: number;
}
