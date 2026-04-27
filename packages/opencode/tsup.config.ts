/**
 * tsup config — bundles the TUI plugin into a single file (dist/tui-plugin/index.js).
 *
 * Why bundling: OpenCode 1.14.x TUI loader (Bun runtime) pre-walks string literals
 * in module source for caching. Multi-file dists with relative imports like
 * `./logger.js` between dist files were misresolved by Bun, causing ENOENT errors
 * on paths like dist/obs/obs/logger.js (discovered Phase 16, 2026-04-27).
 *
 * Single-file bundle eliminates the bug because there are no inter-dist imports
 * left to misresolve — everything is inlined into one module.
 *
 * Server runtime stays on `tsc -b` (multi-file) since it's loaded by Node directly,
 * not by Bun's TUI loader. Only the TUI plugin needs bundling.
 *
 * Externals = peer deps that must come from the OpenCode runtime, not bundled.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "tui-plugin/index": "src/tui-plugin/index.ts",
  },
  format: ["esm"],
  target: "node20",
  bundle: true,
  splitting: false,
  // Do NOT regenerate .d.ts — tsc -b owns that. Avoids conflict.
  dts: false,
  // Do NOT clean — tsc -b owns dist/. We only OVERWRITE tui-plugin/index.js.
  clean: false,
  outDir: "dist",
  // Keep .map files so OpenCode logs show readable stack traces.
  sourcemap: true,
  external: [
    // OpenCode plugin SDK — provided by host runtime
    "@opencode-ai/plugin",
    "@opencode-ai/plugin/tui",
    "@opencode-ai/sdk",
    // OpenTUI peers — provided by host (used when we adopt JSX in v2)
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
    // Node built-ins (tsup auto-externals these but explicit is safer)
    "node:fs",
    "node:path",
    "node:os",
    "node:child_process",
    "node:crypto",
    "node:stream",
    "node:util",
  ],
  // Force-bundle our workspace packages so the TUI plugin is fully self-contained.
  // Without this, tsup leaves them as external imports and Bun's TUI loader has
  // to resolve them at runtime — re-introducing the multi-file dist path issues.
  noExternal: [
    "@maicolextic/bg-subagents-core",
    "@maicolextic/bg-subagents-protocol",
  ],
});
