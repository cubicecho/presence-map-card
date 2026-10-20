# Presence Map Card

A Home Assistant Lovelace card that draws your areas as boxes on a floor plan and plots live presence-sensor targets on it.

- Pick the Home Assistant **areas** to show and place each one as a box (origin and size).
- Add **presence sensors** to an area at a position and rotation inside it.
- Each detected target is drawn as a dot at **area origin + sensor offset + the target's position (rotated to match the sensor)**.

Only the **HLK-LD2450** mmWave radar (via ESPHome) is supported for now. Other sensor types can be added later (see [Roadmap](#roadmap)).

## Installation

### HACS (recommended)

1. In HACS, open the menu (⋮) → **Custom repositories**.
2. Add this repository's URL with category **Dashboard**.
3. Find **Presence Map Card** in HACS, install it, then reload the browser.

HACS adds the resource for you (`/hacsfiles/presence-map-card/presence-map-card.js`).

### Manual

1. Copy `dist/presence-map-card.js` to `<config>/www/presence-map-card.js`.
2. Go to **Settings → Dashboards → ⋮ → Resources** and add `/local/presence-map-card.js` as a **JavaScript module**.
3. Reload the browser.

## Usage

Add the card from the dashboard's **Add card** picker ("Presence Map"). The visual editor lets you:

- choose areas and set each box's `x`, `y`, `width` and `height`,
- add LD2450 sensors to an area, pick the sensor's device, and set its position and rotation.

Picking a device fills in its target entities automatically.

### YAML example

```yaml
type: custom:presence-map-card
title: Downstairs
hide_outside_area: true
show_fov: true
areas:
  - area: living_room
    x: 0
    y: 0
    width: 5
    height: 4
    sensors:
      - type: ld2450
        device: 0123456789abcdef0123456789abcdef   # optional, enables auto-discovery
        name: Living radar
        x: 2.5          # middle of the top wall
        y: 0
        rotation: 0     # facing down the map, into the room
        targets:        # optional when `device` is set
          - x: sensor.living_radar_target_1_x
            y: sensor.living_radar_target_1_y
          - x: sensor.living_radar_target_2_x
            y: sensor.living_radar_target_2_y
          - x: sensor.living_radar_target_3_x
            y: sensor.living_radar_target_3_y
  - area: kitchen
    x: 5
    y: 0
    width: 3
    height: 4
    sensors:
      - type: ld2450
        device: fedcba9876543210fedcba9876543210
        x: 3            # right wall
        y: 2
        rotation: 90    # facing left, into the room
```

## Configuration reference

### Card

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | **required** | `custom:presence-map-card` |
| `title` | string | none | Card header |
| `hide_outside_area` | boolean | `true` | Hide targets that fall outside their sensor's area (ghost readings through walls) |
| `show_fov` | boolean | `true` | Draw each sensor's field-of-view wedge |
| `areas` | list | `[]` | Areas to draw (see below) |

### Area

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `area` | string | **required** | Home Assistant area id |
| `name` | string | area name | Label override |
| `x`, `y` | number (m) | `0` | Box origin (top-left corner) on the map |
| `width`, `height` | number (m) | `4`, `3` | Box extent; must be above 0 |
| `sensors` | list | `[]` | Sensors in this area |

### Sensor

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | `ld2450` | Sensor type. Only `ld2450` today |
| `device` | string | none | Device id. If `targets` is empty, targets are discovered from this device |
| `name` | string | none | Label |
| `x`, `y` | number (m) | `0` | Position **relative to the area's origin** |
| `rotation` | number (°) | `0` | Facing direction, clockwise (see below) |
| `flip_x` | boolean | `false` | Mirror the sensor's lateral axis (for sensors mounted upside down) |
| `color` | string | palette | Dot colour (any CSS colour) |
| `targets` | list | `[]` | Explicit target entities |

### Target

| Option | Type | Description |
| --- | --- | --- |
| `x` | entity id | Entity reporting the target's lateral position |
| `y` | entity id | Entity reporting the target's distance from the sensor |

A target with only one of `x`/`y` set is ignored.

## Coordinate system

- All lengths are **metres**.
- The map's **x** axis points right and its **y** axis points **down** the screen, like a floor plan drawn on paper. An area at `x: 0, y: 0` sits at the top-left.
- A sensor's `x`/`y` are measured from its area's origin, so moving an area moves its sensors with it.
- An LD2450 looks along its own +y axis. `rotation` turns it clockwise:

| `rotation` | Sensor faces | Typical mounting |
| --- | --- | --- |
| `0` | down (+y) | top wall |
| `90` | left (−x) | right wall |
| `180` | up (−y) | bottom wall |
| `270` | right (+x) | left wall |

Any angle works, e.g. `45` for a corner mount.

- `flip_x: true` mirrors the sensor's lateral axis. Use it if dots move left when you walk right.

## LD2450 auto-discovery

The card expects the ESPHome [`ld2450`](https://esphome.io/components/sensor/ld2450.html) component with the per-target X/Y sensors enabled. ESPHome names these entities like `sensor.<node>_target_1_x` / `sensor.<node>_target_1_y`.

When a sensor has a `device` and no `targets`, the card looks through the entities on that device. It picks up every `sensor.*target_N_x` / `sensor.*target_N_y` pair (also `targetN_x` and `..._x_coordinate`), ordered by `N`. Other target sensors (speed, distance, angle, resolution) are ignored.

Values are converted from the entity's `unit_of_measurement` (`mm`, `cm`, `m`, `in`, `ft`; mm if missing). A target reporting `0, 0` is treated as "no target" and hidden.

## Calibration tips

1. Measure the room and set the area's `width`/`height` first.
2. Place the sensor where it is physically mounted, measured from the area's top-left corner.
3. Set `rotation` so the field-of-view wedge points into the room.
4. Walk straight away from the sensor. The dot should move along the wedge's centre line. If it moves sideways, adjust `rotation`.
5. Walk left to right in front of it. If the dot moves the opposite way, enable `flip_x`.
6. Turn `hide_outside_area` off temporarily to see readings that land outside the box.

## Roadmap

- More sensor types, e.g. Bermuda BLE trilateration, or anything else that reports an x/y position. Sensor types are pluggable: each implements the `SensorDriver` interface in [`src/sensors/driver.ts`](src/sensors/driver.ts) and is listed in [`src/sensors/registry.ts`](src/sensors/registry.ts). The map code handles placing whatever points a driver returns.
- Non-rectangular areas.

## Development

```bash
npm install
npm run build      # bundle → dist/presence-map-card.js
npm run dev        # rebuild on change
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

The bundle in `dist/` is committed so HACS installs need no toolchain. Rebuild and commit it whenever `src/` changes. CI fails if it is stale.

## License

MIT
