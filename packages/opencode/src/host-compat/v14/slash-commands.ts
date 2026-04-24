/**
 * Server-side slash command interceptor — Phase 8.8 + Phase 12
 *
 * Intercepts `/task *` command patterns from the `chat.message` hook (or
 * equivalent server-side message handler). Two concerns handled here:
 *
 * 1. `/task policy <bg|fg|default>` (Phase 8.8)
 *    Sets a session-level policy override consumed by messagesTransformInterceptor.
 *    Stored in an in-memory Map<sessionID, SessionOverride>.
 *
 * 2. Live Control commands `/task list|show|logs|kill|move-bg` (Phase 12)
 *    Placeholder stubs — to be fully implemented in Phase 12.
 *
 * Zero-pollution: NO console.log or process.stdout.write anywhere.
 * All diagnostics via createLogger("v14:slash-commands").
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 8.7–8.8
 */

import { createLogger } from "@maicolextic/bg-subagents-core";

const log = createLogger("v14:slash-commands");

// ---------------------------------------------------------------------------
// Types — re-exported so consumers can import from one place
// ---------------------------------------------------------------------------

export type { SessionOverride } from "@maicolextic/bg-subagents-core";

/** Return type for interceptors — either handled (with reply) or not. */
export type InterceptResult =
  | { readonly handled: true; readonly reply: string }
  | { readonly handled: false };

// ---------------------------------------------------------------------------
// TaskPolicyStore — session-scoped session override storage
// ---------------------------------------------------------------------------

/**
 * In-memory store for per-session policy overrides.
 * Keyed by sessionID. Thread-safe within a single Node.js process (single-
 * threaded JS event loop guarantees atomic Map operations).
 *
 * "default" sets are normalized to undefined (cleared) — callers need not
 * distinguish between "never set" and "explicitly cleared to default".
 */
export interface TaskPolicyStore {
  /** Returns current override for the session, or undefined if none. */
  getSessionOverride(sessionID: string): "bg" | "fg" | undefined;
  /** Set override. "default" clears any existing override. */
  setSessionOverride(sessionID: string, mode: "bg" | "fg" | "default"): void;
}

/**
 * Create a new isolated TaskPolicyStore.
 * Each call returns a fresh Map — tests must use their own instance.
 * Production code should create ONE instance and share it across interceptors.
 */
export function createTaskPolicyStore(): TaskPolicyStore {
  const overrides = new Map<string, "bg" | "fg">();

  return {
    getSessionOverride(sessionID: string): "bg" | "fg" | undefined {
      return overrides.get(sessionID);
    },

    setSessionOverride(sessionID: string, mode: "bg" | "fg" | "default"): void {
      if (mode === "default") {
        overrides.delete(sessionID);
        log.debug("session policy override cleared", { sessionID });
      } else {
        overrides.set(sessionID, mode);
        log.debug("session policy override set", { sessionID, mode });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton store — shared between all interceptors in the same process
// ---------------------------------------------------------------------------

let _sharedStore: TaskPolicyStore | undefined;

/**
 * Get or create the shared singleton TaskPolicyStore.
 * Used by messagesTransformInterceptor and slash command interceptor to
 * share the same session override state without explicit DI.
 *
 * Tests should use createTaskPolicyStore() directly for isolation.
 */
export function getSharedPolicyStore(): TaskPolicyStore {
  if (!_sharedStore) {
    _sharedStore = createTaskPolicyStore();
  }
  return _sharedStore;
}

// ---------------------------------------------------------------------------
// /task policy interceptor
// ---------------------------------------------------------------------------

const VALID_MODES = new Set<string>(["bg", "fg", "default"]);

/**
 * Intercept a `/task policy <mode>` message.
 *
 * @param text - Raw message text from the user.
 * @param sessionID - Current session identifier.
 * @param store - The TaskPolicyStore to update.
 * @returns InterceptResult — handled: true + reply if matched, false otherwise.
 */
export function interceptTaskPolicyCommand(
  text: string,
  sessionID: string,
  store: TaskPolicyStore,
): InterceptResult {
  const trimmed = text.trim();

  // Match: /task policy <mode>
  const match = /^\/task\s+policy\s+(\S+)$/i.exec(trimmed);
  if (!match) {
    return { handled: false };
  }

  const mode = match[1]!.toLowerCase();

  if (!VALID_MODES.has(mode)) {
    log.warn("invalid /task policy mode", { sessionID, mode });
    return {
      handled: true,
      reply: `**[bg-subagents]** Invalid mode \`${mode}\`. Valid modes: \`bg\`, \`fg\`, \`default\`.`,
    };
  }

  store.setSessionOverride(sessionID, mode as "bg" | "fg" | "default");

  let reply: string;
  if (mode === "default") {
    reply =
      "**[bg-subagents]** Policy override cleared. Per-agent config defaults restored for next turn.";
  } else {
    const label = mode === "bg" ? "background" : "foreground";
    reply = `**[bg-subagents]** Policy override set to \`${mode}\`. All task calls next turn → **${label}**.`;
  }

  log.info("task policy command handled", { sessionID, mode });
  return { handled: true, reply };
}

// ---------------------------------------------------------------------------
// Live Control commands — Phase 12 stubs
// ---------------------------------------------------------------------------

/**
 * Intercept a `/task <subcommand>` Live Control message.
 * Returns handled: false for commands not yet implemented (Phase 12).
 *
 * Implemented in Phase 12: list, show, logs, kill, move-bg.
 */
export function interceptLiveControlCommand(
  _text: string,
  _sessionID: string,
): InterceptResult {
  // Phase 12 implementation goes here.
  // For now, return handled: false so the message passes through.
  return { handled: false };
}

/**
 * Unified /task interceptor entry point.
 * Checks /task policy first, then defers to Live Control interceptor.
 *
 * @param text - Raw user message text.
 * @param sessionID - Current session ID.
 * @param store - Shared or test-injected policy store.
 * @returns InterceptResult
 */
export function interceptTaskCommand(
  text: string,
  sessionID: string,
  store: TaskPolicyStore = getSharedPolicyStore(),
): InterceptResult {
  // Check /task policy first (Phase 8.8)
  const policyResult = interceptTaskPolicyCommand(text, sessionID, store);
  if (policyResult.handled) return policyResult;

  // Defer to live control (Phase 12)
  return interceptLiveControlCommand(text, sessionID);
}
