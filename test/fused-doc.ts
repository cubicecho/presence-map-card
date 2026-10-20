/** A small fused map document, as Map Fusion sends it. */
import type { FusedDoc } from "../src/mapfusion.js";

/** Two frames; the first has an L-shaped kitchen, a box office and an unlinked room. */
export function fusedDoc(): FusedDoc {
  return {
    version: 1,
    frames: [
      {
        frame_id: "vacuum.d10_plus:46",
        floor_id: null,
        name: "Map 1",
        areas: [
          {
            area_id: "kitchen",
            name: "Kitchen",
            polygons: [[[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]]],
            rect: { x: 0, y: 0, width: 4, height: 3 },
            label_point: [0.5, 1.5],
            origin: "vacuum",
            geometry: "pixels",
          },
          {
            area_id: "office",
            name: "Office",
            polygons: [[[5, 0], [8, 0], [8, 3], [5, 3]]],
            rect: { x: 5, y: 0, width: 3, height: 3 },
            label_point: [6.5, 1.5],
            origin: "manual",
            geometry: "manual",
          },
        ],
        unmapped_rooms: [
          { segment_id: "1_9", name: "Room 9", polygons: [[[0, 4], [2, 4], [2, 6], [0, 6]]], rect: { x: 0, y: 4, width: 2, height: 2 } },
        ],
      },
      { frame_id: "upstairs", floor_id: "upstairs", name: "Upstairs", areas: [], unmapped_rooms: [] },
    ],
    unplaced_areas: [{ area_id: "garage", name: "Garage" }],
  };
}
