/**
 * tsup config for @maicolextic/bg-subagents-control-tui
 *
 * Mirrors Joaquin's proven setup (opencode-subagent-statusline v0.4.1):
 * - bundle: true (single dist/tui.js)
 * - esbuild-plugin-solid in universal mode for OpenTUI compat
 * - external all OpenCode/OpenTUI/Solid peers (provided by host runtime)
 *
 * The bundling solves multi-file dist resolution issues we hit in v1.0
 * (Bun's TUI loader misresolves relative imports between dist files).
 *
 * Validated against OpenCode 1.14.28+. Requires Solid JSX components from
 * slot render functions (1.14.28 hard requirement, vs plain objects accepted
 * in 1.14.22 — that breaking change killed v1.0's TUI plugin).
 */
import { solidPlugin } from "esbuild-plugin-solid";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    tui: "src/tui.tsx",
  },
  format: ["esm"],
  target: "node20",
  bundle: true,
  splitting: false,
  clean: true,
  outDir: "dist",
  sourcemap: true,
  // DTS disabled for v0.1.0 — JSX type defs for @opentui/solid intrinsic
  // elements (box, text, group) need investigation. Runtime works without dts.
  // TODO v0.2: enable dts after wiring proper JSX types.
  dts: false,
  external: [
    // OpenCode runtime peers — provided by host
    "@opencode-ai/plugin",
    "@opencode-ai/plugin/tui",
    "@opencode-ai/sdk",
    // OpenTUI + Solid — provided by host runtime
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
    // Node built-ins
    "node:fs",
    "node:path",
    "node:os",
    "node:child_process",
    "node:crypto",
    "node:stream",
    "node:util",
  ],
  // Bundle our workspace packages so the TUI plugin is fully self-contained.
  // Without this, the bundler leaves them as external imports that Bun's TUI
  // loader has to resolve at runtime — re-introducing the multi-file dist
  // path issues we hit in v1.0.
  noExternal: [
    "@maicolextic/bg-subagents-core",
    "@maicolextic/bg-subagents-opencode",
    "@maicolextic/bg-subagents-protocol",
  ],
  esbuildPlugins: [
    solidPlugin({
      solid: {
        generate: "universal",
        moduleName: "@opentui/solid",
      },
    }),
  ],
});
