import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Dashboards run on old tablets and WebViews; syntax they cannot parse kills
// the whole bundle. Check the committed file, not just the build config.
const BUNDLE = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../dist/presence-map-card.js"), "utf8");

const FORBIDDEN_JS: Array<[string, string]> = [
  ["??=", "logical assignment (ES2021)"],
  ["||=", "logical assignment (ES2021)"],
  ["&&=", "logical assignment (ES2021)"],
  ["?.", "optional chaining (ES2020)"],
  ["??", "nullish coalescing (ES2020)"],
  [".flat(", "Array.prototype.flat (ES2019)"],
  [".flatMap(", "Array.prototype.flatMap (ES2019)"],
  [".replaceAll(", "String.prototype.replaceAll (ES2021)"],
  ["structuredClone(", "structuredClone (2022)"],
  ["Object.hasOwn(", "Object.hasOwn (ES2022)"],
];

describe("the committed bundle", () => {
  it.each(FORBIDDEN_JS)("does not use %s (%s)", (token) => {
    expect(BUNDLE).not.toContain(token);
  });

  it("carries the build banner", () => {
    expect(BUNDLE.startsWith("/*! presence-map-card v")).toBe(true);
  });
});
