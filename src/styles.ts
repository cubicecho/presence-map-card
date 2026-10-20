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
.empty, .error { padding: 16px; color: var(--secondary-text-color); }
.error { color: var(--error-color, #db4437); }
`;
