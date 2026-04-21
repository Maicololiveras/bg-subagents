/**
 * Public type surface for @maicolextic/bg-subagents-protocol.
 *
 * All types derive from the zod schemas in schemas.ts (SSOT). The re-exports
 * here give a stable, documented name for each shape without forcing consumers
 * to import zod directly.
 */
import type {
  CompletionEventInferred,
  HistoryConfigInferred,
  ModeInferred,
  PickerEventInferred,
  SecurityLimitsInferred,
  TaskEnvelopeInferred,
  TaskStatusInferred,
  TelemetryConfigInferred,
} from "./schemas.js";

// -----------------------------------------------------------------------------
// Branded nominal types
// -----------------------------------------------------------------------------

declare const TaskIdBrand: unique symbol;
/**
 * Branded nominal task identifier. Matches `^tsk_[A-Za-z0-9]{8,}$`.
 * Never assign an arbitrary `string` directly — cast only at the construction
 * boundary (generator / schema parse result).
 */
export type TaskId = string & { readonly [TaskIdBrand]: "TaskId" };

// -----------------------------------------------------------------------------
// Primitive unions
// -----------------------------------------------------------------------------

export type Mode = ModeInferred;
export type TaskStatus = TaskStatusInferred;

/** Terminal statuses surfaced on CompletionEvent. */
export type TerminalTaskStatus = "completed" | "killed" | "killed_on_disconnect" | "error";

// -----------------------------------------------------------------------------
// Core data contracts (envelope + policy + events)
// -----------------------------------------------------------------------------

/** Task envelope persisted to history.jsonl, one line per lifecycle transition. */
export type TaskEnvelope = Omit<TaskEnvelopeInferred, "task_id"> & {
  readonly task_id: TaskId;
};

/** Picker output — discriminated union keyed on `type`. */
export type PickerEvent = PickerEventInferred;

/** Parent-session completion notification. */
export type CompletionEvent = CompletionEventInferred;

/** Reserved-but-unenforced security limits (FR-13). */
export type SecurityLimits = SecurityLimitsInferred;

/** History JSONL rotation + retention knobs. */
export type HistoryConfig = HistoryConfigInferred;

/** Telemetry switch — always off by default (NFR-9). */
export type TelemetryConfig = TelemetryConfigInferred;

/**
 * User policy (post-parse). Optional fields in the schema default to empty
 * objects, so the public shape exposes them as required, strongly-typed values.
 */
export type Policy = {
  readonly $schema?: string;
  readonly default_mode_by_agent_type: Readonly<Record<string, Mode>>;
  readonly default_mode_by_agent_name?: Readonly<Record<string, Mode>>;
  readonly timeout_ms: number;
  readonly security: SecurityLimits;
  readonly history: HistoryConfig;
  readonly telemetry: TelemetryConfig;
};

// -----------------------------------------------------------------------------
// Host-facing supporting shapes (picker + invoker interfaces consume these)
// -----------------------------------------------------------------------------

/** Options passed to Picker.prompt(). */
export interface PickerOpts {
  readonly agentName: string;
  readonly agentType?: string;
  readonly defaultMode: Mode;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** Narrowed result returned by a Picker implementation. */
export type PickerResult =
  | { readonly kind: "picked"; readonly mode: Mode; readonly viaTimeout: boolean }
  | { readonly kind: "cancelled"; readonly reason: "user" | "signal" | "io-unavailable" };

// -----------------------------------------------------------------------------
// Type-level sanity helper: ensures the erased TaskId cast is the only
// stringy-to-nominal entry point in the codebase.
// -----------------------------------------------------------------------------

/**
 * Construct a branded TaskId from a plain string. Callers are responsible for
 * validating the input (via TaskIdSchema.parse) before calling this helper —
 * this function does NOT validate; it only casts at the nominal boundary.
 */
export function unsafeTaskId(raw: string): TaskId {
  return raw as TaskId;
}
