/**
 * Process-level singleton bridging server plugin and TUI plugin.
 *
 * The server plugin (in @maicolextic/bg-subagents-opencode) writes to the
 * same Symbol.for key on globalThis. Both processes (when run in same Bun
 * runtime) see the same registered value.
 *
 * This is a copy of the original v1.0 implementation (Phase 11), kept here
 * to keep this package self-contained and independent from the v1.0 dist
 * structure that may change.
 */

import type { TaskRegistry, TaskPolicyStore } from "@maicolextic/bg-subagents-core";

const SHARED_KEY = Symbol.for("@maicolextic/bg-subagents/shared");

export interface SharedPluginState {
  readonly registry: TaskRegistry;
  readonly policyStore: TaskPolicyStore;
}

/** Read the current shared state. Returns undefined if server plugin hasn't booted yet. */
export function current(): SharedPluginState | undefined {
  return (globalThis as Record<symbol, unknown>)[SHARED_KEY] as
    | SharedPluginState
    | undefined;
}
