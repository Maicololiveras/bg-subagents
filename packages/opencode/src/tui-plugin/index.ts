/**
 * TUI plugin entry point — Phase 13.2 GREEN.
 *
 * Wires together:
 *   - SharedPluginState (Phase 11) via `current()` — reads TaskRegistry + TaskPolicyStore.
 *   - buildSidebarSlotPlugin (Phase 12.7) — registers the `sidebar_content` slot.
 *   - api.lifecycle.onDispose — clears the polling interval on shutdown.
 *
 * ## Critical: `id` field is MANDATORY
 *
 * The TUI runtime (OpenCode 1.14.23+) throws `TypeError: Path plugin ... must export id`
 * if the default export lacks `id`. The SDK type `TuiPluginModule.id?: string` (optional)
 * is a TYPE-vs-RUNTIME mismatch discovered in spike TQ-1 (2026-04-24). Always keep `id`.
 *
 * ## Install — two entries in opencode config
 *
 * Users must declare this plugin in BOTH:
 *   - `opencode.json` plugin array: `"@maicolextic/bg-subagents-opencode"` (server plugin)
 *   - `tui.json` plugin array: `"@maicolextic/bg-subagents-opencode/tui"` (THIS file, TUI plugin)
 *
 * ## Polling design
 *
 * `buildSidebarSlotPlugin({ pollIntervalMs: 1000 })` stores the poll interval config.
 * The sidebar render function calls `getSidebarData()` on every invocation — the TUI
 * host drives rendering via its own scheduler. Our setInterval here is a heartbeat that
 * could trigger reactive signals in future SolidJS-native upgrades. For now it is wired
 * to the lifecycle for correct cleanup semantics.
 *
 * ## Sidebar JSX decision (Phase 13 finding)
 *
 * `buildSidebarSlotPlugin` currently returns a plain data object from its render function
 * instead of a real SolidJS JSX element. @opentui/solid is an optional peer dependency
 * not installed in this dev package — importing it at build time would break `tsc`.
 * The render body returns `getSidebarData()` (plain object); the TUI host ignores unknown
 * render types gracefully. A future phase (v1.1) will upgrade to a real SolidJS component
 * once @opentui/solid is available as a dev dep.
 *
 * ## Keybinds (Phase 13.5)
 *
 * Per ADR-9, v1.0 includes Ctrl+B (focus BG task), Ctrl+F (focus FG task), and ↓
 * (open management panel) keybinds. Implemented in Phase 13.5 via `registerKeybinds(api)`
 * from `./keybinds.ts`. Uses `api.command.register(() => TuiCommand[])` with `keybind`
 * field on each command.
 *
 * ## Zero stdout guarantee
 *
 * All diagnostics route through `createLogger("tui-plugin:boot")`.
 * No `console.log`, `console.error`, or `process.stdout.write` anywhere in this file.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 13.2
 * Design: design.md ADR-9 + TUI entry point + id requirement (spike TQ-1)
 */

import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { createLogger } from "@maicolextic/bg-subagents-core";
import { current } from "./shared-state.js";
import { buildSidebarSlotPlugin } from "./sidebar.js";
import { registerKeybinds } from "./keybinds.js";
// Reserved for future plan-review trigger wiring (Phase v1.1):
// import { createTuiPlanPicker } from "./plan-review-dialog.js";

// ---------------------------------------------------------------------------
// Logger — file-routed, zero stdout in production
// ---------------------------------------------------------------------------

const logger = createLogger("tui-plugin:boot");

// ---------------------------------------------------------------------------
// TUI plugin function
// ---------------------------------------------------------------------------

const Tui: TuiPlugin = async (api, _options, _meta) => {
  // -------------------------------------------------------------------------
  // 1. Read SharedPluginState — may be undefined if server plugin hasn't booted yet.
  //    This is a known race at startup; the sidebar render re-reads current() on
  //    every call so it will pick up the state once the server plugin registers it.
  // -------------------------------------------------------------------------

  const state = current();
  if (!state) {
    logger.warn(
      "SharedPluginState not yet available at TUI boot — sidebar will render empty until server plugin registers",
    );
  } else {
    logger.info("TUI plugin boot: SharedPluginState found", {
      registry_size: state.registry.size(),
    });
  }

  // -------------------------------------------------------------------------
  // 2. Register sidebar slot plugin
  // -------------------------------------------------------------------------

  const sidebarPlugin = buildSidebarSlotPlugin({ pollIntervalMs: 1_000 });
  api.slots.register(sidebarPlugin as never);

  logger.info("TUI plugin boot: sidebar_content slot registered");

  // -------------------------------------------------------------------------
  // 3. Register TUI keybinds (Phase 13.5)
  //
  //    Ctrl+B → Focus BG task dialog
  //    Ctrl+F → Focus FG task dialog
  //    ↓      → Open task management panel (all tasks)
  //
  //    Uses api.command.register(() => TuiCommand[]). All handlers read
  //    SharedPluginState.current() at invocation time — no stale state.
  // -------------------------------------------------------------------------

  registerKeybinds(api);

  logger.info("TUI plugin boot: keybinds registered (ctrl+b, ctrl+f, down)");

  // -------------------------------------------------------------------------
  // 4. Polling heartbeat + lifecycle cleanup
  //
  //    The interval is a best-effort heartbeat for future reactive signal
  //    integration. For now the sidebar render function re-reads getSidebarData()
  //    on each host-driven render cycle without needing this interval.
  //    However, wiring it to onDispose ensures correct cleanup semantics when
  //    the TUI host disposes the plugin.
  // -------------------------------------------------------------------------

  const intervalId = setInterval(() => {
    // Heartbeat — getSidebarData() is re-read on each render call automatically.
    // This interval is reserved for future SolidJS signal trigger integration
    // (Phase v1.1 upgrade to real JSX component).
    logger.debug("TUI plugin heartbeat");
  }, sidebarPlugin.pollIntervalMs);

  api.lifecycle.onDispose(() => {
    clearInterval(intervalId);
    logger.info("TUI plugin disposed");
  });

  logger.info("TUI plugin boot complete");
};

// ---------------------------------------------------------------------------
// Default export — `id` is REQUIRED by the TUI runtime.
//
// IMPORTANT: Never remove `id`. The SDK type declares it optional but the
// runtime enforces it. Removing `id` causes:
//   TypeError: Path plugin <path> must export id
// See spike TQ-1 (engram #1235, topic sdd/opencode-plan-review-live-control/spike/tq1-runtime-result).
// ---------------------------------------------------------------------------

export default { id: "bg-subagents-tui", tui: Tui };
