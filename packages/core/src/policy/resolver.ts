/**
 * PolicyResolver — priority-chain resolver for a subagent invocation.
 *
 * Priority chain (FR-3):
 *   1. agent-name rule        (policy.default_mode_by_agent_name[name])
 *   2. agent-type rule        (policy.default_mode_by_agent_type[type])
 *   3. global default         (not exposed as top-level field in v0.1; reserved)
 *   4. hardcoded fallback     ("ask" — picker shows, no pre-selected default)
 *
 * Security helpers (FR-13 — fields accepted in v0.1, enforcement in v0.2+):
 *   - isAllowedInBackground(activeCount)     → respects max_concurrent_bg_tasks
 *   - canAgentRunInBackground(invocation)    → respects blocked_tools_in_bg
 *   - getTimeoutMs(invocation)               → policy default or 2000 fallback
 *
 * Hot-reload:
 *   - reload() re-invokes the injected loader and swaps the stored LoadedPolicy
 *     in a single assignment. Resolutions computed before reload() remain
 *     valid (values were copied into the returned ResolvedPolicy at resolve-time).
 */
import type { Mode } from "@maicolextic/bg-subagents-protocol";

import type { LoadedPolicy } from "./schema.js";

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface Invocation {
  readonly agent_name: string;
  readonly agent_type?: string;
  readonly tools?: readonly string[];
}

export type ResolvedPolicySource = "agent" | "type" | "global" | "fallback";

export interface ResolvedPolicy {
  readonly mode: Mode;
  readonly timeout_ms: number;
  readonly reason: string;
  readonly source: ResolvedPolicySource;
}

export type PolicyLoaderFn = () => Promise<LoadedPolicy>;

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const HARDCODED_FALLBACK_MODE: Mode = "ask";
const HARDCODED_FALLBACK_TIMEOUT_MS = 2000;

// -----------------------------------------------------------------------------
// PolicyResolver
// -----------------------------------------------------------------------------

export class PolicyResolver {
  readonly #loader: PolicyLoaderFn;
  // The `active` field is swapped atomically on reload() — a single assignment
  // ensures no torn reads mid-resolution. Using a private field keeps callers
  // from reaching in and mutating the snapshot.
  #active: LoadedPolicy | undefined;

  constructor(loader: PolicyLoaderFn) {
    this.#loader = loader;
  }

  /**
   * Initialize or re-initialize the resolver by invoking the loader. Safe to
   * call repeatedly — each call replaces the stored snapshot in a single
   * assignment after the loader resolves.
   */
  async reload(): Promise<void> {
    const next = await this.#loader();
    this.#active = next;
  }

  /**
   * Resolve the mode for a given invocation. Throws if reload() has never
   * been called (the resolver has no policy to consult). Callers MUST reload
   * at least once during plugin boot.
   */
  resolve(invocation: Invocation): ResolvedPolicy {
    const snapshot = this.#requireActive();
    const { policy } = snapshot;

    // Priority 1: agent-name rule
    const byName = policy.default_mode_by_agent_name?.[invocation.agent_name];
    if (byName !== undefined) {
      return {
        mode: byName,
        timeout_ms: policy.timeout_ms,
        reason: `agent-name rule matched "${invocation.agent_name}" → ${byName}`,
        source: "agent",
      };
    }

    // Priority 2: agent-type rule
    if (invocation.agent_type !== undefined) {
      const byType = policy.default_mode_by_agent_type[invocation.agent_type];
      if (byType !== undefined) {
        return {
          mode: byType,
          timeout_ms: policy.timeout_ms,
          reason: `agent-type rule matched "${invocation.agent_type}" → ${byType}`,
          source: "type",
        };
      }
    }

    // Priority 3: global default — reserved for future schema addition. The
    // v0.1 PolicySchema does not carry a top-level `default_mode` field, so
    // this branch is currently unreachable. We keep the `source: "global"`
    // value reserved so host adapters can distinguish "no rule matched" from
    // "global default applied" when v1.N adds the field.

    // Priority 4: hardcoded fallback
    return {
      mode: HARDCODED_FALLBACK_MODE,
      timeout_ms: policy.timeout_ms,
      reason:
        "no agent-name or agent-type rule matched; applying hardcoded fallback 'ask'",
      source: "fallback",
    };
  }

  /**
   * Merged mode resolution (exposed as a standalone helper for call sites
   * that don't need the whole ResolvedPolicy).
   */
  resolveMode(invocation: Invocation): Mode {
    return this.resolve(invocation).mode;
  }

  /**
   * Effective picker timeout in ms for a given invocation. Currently the
   * policy exposes a single `timeout_ms` — per-type/per-agent timeouts are a
   * reserved extension. Falls back to HARDCODED_FALLBACK_TIMEOUT_MS when the
   * policy snapshot is missing the field (defensive against future schema
   * evolution that makes the field optional).
   */
  getTimeoutMs(_invocation: Invocation): number {
    const snapshot = this.#requireActive();
    const ms = snapshot.policy.timeout_ms;
    return typeof ms === "number" && ms >= 0 ? ms : HARDCODED_FALLBACK_TIMEOUT_MS;
  }

  /**
   * Security helper (FR-13) — accepted in v0.1 schema, unenforced. Helper
   * exists so host adapters can consult it now; v0.2 activates enforcement
   * by refusing invocations when this returns false.
   */
  isAllowedInBackground(activeCount: number): boolean {
    const snapshot = this.#requireActive();
    const max = snapshot.policy.security.max_concurrent_bg_tasks;
    if (max === undefined) return true;
    return activeCount < max;
  }

  /**
   * Security helper (FR-13) — returns false when any tool in the invocation's
   * `tools` list is present in policy.security.blocked_tools_in_bg.
   */
  canAgentRunInBackground(invocation: Invocation): boolean {
    const snapshot = this.#requireActive();
    const blocked = snapshot.policy.security.blocked_tools_in_bg;
    if (!blocked || blocked.length === 0) return true;
    const tools = invocation.tools ?? [];
    if (tools.length === 0) return true;
    for (const t of tools) {
      if (blocked.includes(t)) return false;
    }
    return true;
  }

  #requireActive(): LoadedPolicy {
    if (!this.#active) {
      throw new Error(
        "PolicyResolver is uninitialized — call resolver.reload() at least once before resolve().",
      );
    }
    return this.#active;
  }
}
