# Project: Presence Map Card

A Home Assistant Lovelace card, distributed through HACS as a **Dashboard/plugin** repository. It draws HA areas as boxes on a floor plan and plots presence-sensor targets on them.

- Areas: chosen HA areas, each a rectangle (`x`, `y`, `width`, `height`, in metres, y pointing down the screen).
- Sensors: children of an area, positioned relative to the area origin, with a `rotation` (clockwise, 0 = facing +y) and `flip_x`.
- Target map position = area origin + sensor offset + rotated/flipped sensor-frame point.
- MVP sensor type: HLK-LD2450 via ESPHome. Others (e.g. Bermuda BLE) come later through the driver seam.

## Layout

```
src/
  main.ts            # entry: registers card + editor, logs version
  card.ts            # <presence-map-card>: static SVG + per-update dot moves
  editor.ts          # <presence-map-card-editor>: visual editor built on ha-form
  config.ts          # config types + normalizeConfig (validation, defaults)
  geometry.ts        # frame transforms, bounds, FOV wedge path
  dom.ts             # escapeHtml, fireEvent, element registration
  types.ts           # minimal Home Assistant structural types
  sensors/
    driver.ts        # SensorDriver interface
    registry.ts      # list of drivers; getDriver / isSensorType
    ld2450.ts        # LD2450 driver + entity auto-discovery
test/                # vitest (jsdom where DOM is needed)
dist/presence-map-card.js   # committed build output; hacs.json `filename` points here
```

## Commands

```bash
npm install
npm run build      # esbuild → dist/presence-map-card.js
npm run dev        # watch
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

## Conventions

- **No runtime dependencies.** Vanilla custom elements, one IIFE bundle. No lit/React to keep in step with HA's frontend.
- **ES2015 build target.** Wall tablets and old WebViews must parse the bundle, and a syntax error breaks the whole card. Source may use modern syntax since esbuild lowers it. Don't add runtime APIs newer than ES2015 without a fallback.
- **Committed bundle.** Rebuild and commit `dist/` with every `src/` change. CI checks `git diff --exit-code -- dist`.
- **Units.** Everything inside the card is metres. Drivers convert from the entity's unit.
- **Render split.** The card rebuilds its SVG only when the structure changes (config, area names, target counts). State updates just move the target dots, because LD2450s update several times a second.
- **Validation.** `normalizeConfig` throws user-facing errors with a config path (`areas[0].x must be a number`). Half-filled target pairs are skipped, not rejected, so the editor can save mid-edit.
- **Editor.** Uses HA's `<ha-form>` in the light DOM. Rebuild forms only when the list structure changes, otherwise focus is lost while typing.

## Adding a sensor type

1. Create `src/sensors/<type>.ts` exporting a `SensorDriver`:
   - `type`, `label`, optional `fov` (`halfAngle` in degrees, `range` in metres)
   - `targets(hass, sensor)`: the targets to draw (configured, or discovered from `sensor.device`)
   - `read(hass, target)`: one target's position in the sensor's own frame, in metres, or `null`
   - optional `discover(hass, deviceId)`: used by the editor to auto-fill targets
2. Add it to `SENSOR_DRIVERS` in `src/sensors/registry.ts`.
3. Add tests in `test/`.

A source that already reports map-absolute positions can use a sensor at `x: 0, y: 0, rotation: 0` in an area at the map origin, or skip the transform in the driver.
