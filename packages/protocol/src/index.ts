/**
 * Public barrel for @maicolextic/bg-subagents-protocol.
 *
 * Consumers MUST import from this entry point — never reach into subpaths.
 * NodeNext module resolution requires the `.js` extensions on internal
 * re-exports because we publish dual TS sources + compiled ESM.
 */

export {
  PROTOCOL_VERSION,
  isCompatibleProtocol,
  type ProtocolVersion,
  type ProtocolCompatibilityResult,
} from "./version.js";

export {
  // Schemas (SSOT for runtime validation)
  CompletionEventSchema,
  HistoryConfigSchema,
  ModeSchema,
  PickerEventSchema,
  PolicySchema,
  SecurityLimitsSchema,
  TaskEnvelopeSchema,
  TaskErrorSchema,
  TaskIdSchema,
  TaskStatusSchema,
  TelemetryConfigSchema,
} from "./schemas.js";

export {
  unsafeTaskId,
  type CompletionEvent,
  type HistoryConfig,
  type Mode,
  type PickerEvent,
  type PickerOpts,
  type PickerResult,
  type Policy,
  type SecurityLimits,
  type TaskEnvelope,
  type TaskId,
  type TaskStatus,
  type TelemetryConfig,
  type TerminalTaskStatus,
} from "./types.js";

export {
  BgLimitError,
  IncompatibleProtocolError,
  PolicyValidationError,
  type BgLimitContext,
  type IncompatibleProtocolCode,
  type IncompatibleProtocolContext,
  type PolicyValidationContext,
} from "./errors.js";
