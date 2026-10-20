export const STYLES = `
:host { display: block; }
ha-card { overflow: hidden; }
.header {
  padding: 16px 16px 0;
  font-size: 1.25em;
  font-weight: 500;
  color: var(--ha-card-header-color, var(--primary-text-color));
}
.map { padding: 12px 16px 16px; }
svg { display: block; width: 100%; height: auto; max-height: 70vh; }
.area-box {
  fill: var(--secondary-background-color, rgba(127,127,127,0.08));
  stroke: var(--divider-color, rgba(127,127,127,0.5));
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.room-unlinked {
  fill: none;
  stroke: var(--divider-color, rgba(127,127,127,0.5));
  stroke-width: 1;
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
}
.area-label {
  fill: var(--secondary-text-color, #727272);
  font-family: var(--paper-font-body1_-_font-family, sans-serif);
}
.fov { fill-opacity: 0.10; stroke: none; }
.sensor { stroke: var(--card-background-color, #fff); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.target {
  stroke: var(--card-background-color, #fff);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  transition: transform 0.35s linear, opacity 0.35s;
}
.target.hidden { opacity: 0; }
.tracker { fill: none; stroke-width: 2.5; vector-effect: non-scaling-stroke; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 0 16px 16px; font-size: 0.9em; }
.legend-item { display: flex; align-items: center; gap: 6px; min-width: 0; }
.swatch { width: 12px; height: 12px; flex: none; }
.swatch circle { fill: none; stroke-width: 2; }
.legend-name { color: var(--primary-text-color); }
.legend-area { color: var(--secondary-text-color); }
.notice { padding: 0 16px 12px; font-size: 0.85em; color: var(--secondary-text-color); }
.empty, .error { padding: 16px; color: var(--secondary-text-color); }
.error { color: var(--error-color, #db4437); }
`;
