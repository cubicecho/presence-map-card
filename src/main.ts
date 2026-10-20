/** Bundle entry point: registers the card and its editor. */
import { PresenceMapCard } from "./card.js";
import { defineElement, registerCard } from "./dom.js";
import { PresenceMapCardEditor } from "./editor.js";

declare const __CARD_VERSION__: string;

defineElement("presence-map-card-editor", PresenceMapCardEditor);

registerCard(PresenceMapCard, {
  type: "presence-map-card",
  name: "Presence Map",
  description: "Draw areas as boxes and plot presence-sensor (LD2450) targets on them.",
  preview: true,
  documentationURL: "https://github.com/cubicecho/presence-map-card",
});

// eslint-disable-next-line no-console
console.info(
  `%c PRESENCE-MAP-CARD %c v${__CARD_VERSION__} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;",
);
