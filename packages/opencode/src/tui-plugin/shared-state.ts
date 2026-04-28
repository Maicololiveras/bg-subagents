/**
 * SharedPluginState — Symbol.for globalThis singleton.
 *
 * Enables the server plugin and TUI plugin to share TaskRegistry and
 * TaskPolicyStore in the same Bun process without HTTP round-trips or
 * module-graph coupling.
 *
 * Pattern: `globalThis[Symbol.for("@maicolextic/bg-subagents/shared")]`
 *
 * Both plugins use the same symbol key — Symbol.for is process-global and
 * key-based, so the same string always resolves to the same Symbol instance
 * across any module boundary.
 *
 * Server plugin (boot): calls registerFromServer({ registry, policyStore })
 * TUI plugin (boot):    calls current() to read the state (may be undefined
 *                        if called before server plugin boots — handle gracefully)
 *
 * Zero-pollution: no console.log or process.stdout.write anywhere.
 * Debug logging only when BG_SUBAGENTS_DEBUG=true, routed to file via createLogger.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 11.2
 * Design: design.md "SharedPluginState — Symbol.for globalThis pattern"
 */

import { createLogger } from "@maicolextic/bg-subagents-core";
import type { TaskRegistry } from "@maicolextic/bg-subagents-core";
import type { TaskPolicyStore } from "../host-compat/v14/slash-commands.js";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export type SharedPluginState = {
  registry: TaskRegistry;
  policyStore: TaskPolicyStore;
};

// ---------------------------------------------------------------------------
// Symbol key — exact string; any module can reconstruct it independently
// ---------------------------------------------------------------------------

const SYMBOL_KEY = "@maicolextic/bg-subagents/shared";

// ---------------------------------------------------------------------------
// Logger — debug only, never writes to stdout in production
// ---------------------------------------------------------------------------

const log = createLogger("tui-plugin:shared-state");

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Register the shared state from the server plugin at boot.
 * Called once by buildV14Hooks after registry and policyStore are ready.
 * Overwrites any previously registered state (last-write wins).
 */
export function registerFromServer(state: SharedPluginState): void {
  (globalThis as Record<symbol, unknown>)[Symbol.for(SYMBOL_KEY)] = state;

  if (process.env["BG_SUBAGENTS_DEBUG"] === "true") {
    log.debug("SharedPluginState registered from server plugin");
  }
}

/**
 * Read the current shared state.
 * Called by the TUI plugin at boot and on each poll/render cycle.
 * Returns undefined if the server plugin has not yet called registerFromServer
 * (e.g. race at startup) — callers must handle gracefully (retry or skip).
 */
export function current(): SharedPluginState | undefined {
  return (globalThis as Record<symbol, unknown>)[
    Symbol.for(SYMBOL_KEY)
  ] as SharedPluginState | undefined;
}

/**
 * Remove the shared state from globalThis.
 * Primary use: test isolation. In production this is typically not called.
 */
export function clear(): void {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for(SYMBOL_KEY)];
}
