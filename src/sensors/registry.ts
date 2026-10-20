/** Every supported sensor type. Add new drivers here. */
import type { SensorDriver } from "./driver.js";
import { ld2450 } from "./ld2450.js";

export const SENSOR_DRIVERS: SensorDriver[] = [ld2450];

export function getDriver(type: string): SensorDriver | undefined {
  for (const d of SENSOR_DRIVERS) if (d.type === type) return d;
  return undefined;
}

export function isSensorType(type: string): boolean {
  return getDriver(type) !== undefined;
}
