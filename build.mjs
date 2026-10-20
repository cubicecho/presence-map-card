// Bundles the card into dist/presence-map-card.js, the file HACS installs.
// The bundle is committed so installs need no Node toolchain.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "package.json"), "utf8"));

const options = {
  entryPoints: [resolve(here, "src/main.ts")],
  outfile: resolve(here, "dist/presence-map-card.js"),
  bundle: true,
  format: "iife",
  // Deliberately old: wall tablets and embedded WebViews choke on newer
  // syntax, and a syntax error kills the whole bundle.
  target: "es2015",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  banner: {
    js: `/*! presence-map-card v${pkg.version} built from src/, do not edit */`,
  },
  define: { __CARD_VERSION__: JSON.stringify(pkg.version) },
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log(`watching… → ${options.outfile}`);
} else {
  await esbuild.build(options);
  console.log(`built v${pkg.version} → ${options.outfile}`);
}
