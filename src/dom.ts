/** Small DOM helpers. */

export function escapeHtml(value: unknown): string {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fireEvent<T>(target: HTMLElement, type: string, detail?: T): void {
  target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}

/** Define an element; a failure is logged instead of breaking the bundle. */
export function defineElement(name: string, element: CustomElementConstructor): boolean {
  try {
    if (!customElements.get(name)) customElements.define(name, element);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`presence-map-card: could not define <${name}>`, err);
    return false;
  }
}

/** Define a card and list it in the Lovelace "Add card" picker. */
export function registerCard(element: CustomElementConstructor, entry: CustomCardEntry): void {
  if (!defineElement(entry.type, element)) return;
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === entry.type)) window.customCards.push(entry);
}
