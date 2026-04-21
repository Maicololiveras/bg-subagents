/**
 * Builds the opaque `host_context` object consumed by `core`'s
 * `BackgroundStrategy` chain. Memoized per `session_id` so repeated strategy
 * calls within a session observe identity-stable cache keys — matches the
 * cache semantics of `NativeBackgroundStrategy` (which is WeakMap-keyed).
 *
 * Shape is intentionally minimal:
 *   - `opencode_task_bg_registered` — flipped true once we register the
 *     `task_bg` tool so `OpenCodeTaskSwapStrategy.canInvokeInBackground` can
 *     short-circuit the chain.
 *   - `native_bg_supported` — OpenCode has no public per-call background
 *     field in v1 host-API, so always `false`. Kept in the shape so the
 *     NativeBackgroundStrategy's probe evaluates deterministically.
 *   - `agent_variants` — OpenCode does not ship *-bg sibling agents out of the
 *     box. Empty object until a user opts into a pairing generator.
 *   - `session_id` — retained for logging / telemetry; strategies ignore it.
 */

export interface OpenCodeHostContext {
  readonly opencode_task_bg_registered: boolean;
  readonly native_bg_supported: boolean;
  readonly agent_variants: Readonly<Record<string, boolean>>;
  readonly session_id: string;
}

export interface BuildHostContextCaps {
  readonly opencode_task_bg_registered?: boolean;
  readonly native_bg_supported?: boolean;
  readonly agent_variants?: Readonly<Record<string, boolean>>;
}

// Memoization cache — identity-keyed by session_id. Uses a plain Map (not
// WeakMap) because session_id is a string, not an object.
const CONTEXT_CACHE = new Map<string, OpenCodeHostContext>();

/**
 * Build (or return the memoized) host_context for a given OpenCode session.
 * Subsequent calls with the SAME session_id and SAME caps return the cached
 * instance — strategy capability caches stay warm.
 *
 * If `caps` differ on a subsequent call for the same session, the cache is
 * invalidated and a fresh context is built. Callers that want stable identity
 * across capability mutations should re-derive caps before calling.
 */
export function buildHostContext(
  session_id: string,
  caps: BuildHostContextCaps = {},
): OpenCodeHostContext {
  const existing = CONTEXT_CACHE.get(session_id);
  const candidate = materialize(session_id, caps);
  if (existing !== undefined && shallowEqual(existing, candidate)) {
    return existing;
  }
  CONTEXT_CACHE.set(session_id, candidate);
  return candidate;
}

/** Drop the memoized context for a session — invoked on session teardown. */
export function clearHostContext(session_id: string): void {
  CONTEXT_CACHE.delete(session_id);
}

/** Reset the entire cache. Test-only seam. */
export function __resetHostContextCacheForTests(): void {
  CONTEXT_CACHE.clear();
}

// -----------------------------------------------------------------------------
// Private
// -----------------------------------------------------------------------------

function materialize(
  session_id: string,
  caps: BuildHostContextCaps,
): OpenCodeHostContext {
  return Object.freeze({
    opencode_task_bg_registered: caps.opencode_task_bg_registered ?? false,
    native_bg_supported: caps.native_bg_supported ?? false,
    agent_variants: Object.freeze({ ...(caps.agent_variants ?? {}) }),
    session_id,
  });
}

function shallowEqual(a: OpenCodeHostContext, b: OpenCodeHostContext): boolean {
  if (a.session_id !== b.session_id) return false;
  if (a.opencode_task_bg_registered !== b.opencode_task_bg_registered) return false;
  if (a.native_bg_supported !== b.native_bg_supported) return false;
  const aKeys = Object.keys(a.agent_variants);
  const bKeys = Object.keys(b.agent_variants);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a.agent_variants[k] !== b.agent_variants[k]) return false;
  }
  return true;
}
