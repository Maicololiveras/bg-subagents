/**
 * Runtime validation schemas (SSOT). Types are inferred from these via z.infer.
 *
 * DO NOT declare types in parallel — always reuse the inferred type to keep the
 * wire/disk contract identical to the TS surface.
 */
import { z } from "zod";

// -----------------------------------------------------------------------------
// Mode + TaskStatus primitives
// -----------------------------------------------------------------------------

export const ModeSchema = z.enum(["background", "foreground", "ask"]);

/**
 * All task status values accepted by the schema. Includes the v0.2
 * forward-contract value "rejected_limit" (FR-13, Scenario 16) so v0.1 parsers
 * do not reject history lines written by a future v0.2 release.
 */
export const TaskStatusSchema = z.enum([
  "running",
  "completed",
  "killed",
  "killed_on_disconnect",
  "error",
  "cancelled",
  "passthrough",
  "rejected_limit",
]);

// -----------------------------------------------------------------------------
// TaskEnvelope
// -----------------------------------------------------------------------------

const TASK_ID_REGEX = /^tsk_[A-Za-z0-9]{8,}$/;

export const TaskIdSchema = z.string().regex(TASK_ID_REGEX);

export const TaskErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  stack: z.string().optional(),
});

export const TaskEnvelopeSchema = z.object({
  task_id: TaskIdSchema,
  subagent_type: z.string(),
  subagent_name: z.string().optional(),
  prompt: z.string(),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  status: TaskStatusSchema,
  log_path: z.string(),
  result: z.unknown().optional(),
  error: TaskErrorSchema.optional(),
  strategy_used: z.string().optional(),
  policy_default_applied: z.boolean().optional(),
  picker_skipped_reason: z.string().optional(),
});

// -----------------------------------------------------------------------------
// Picker events (discriminated union)
// -----------------------------------------------------------------------------

export const PickerEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    mode: z.enum(["background", "foreground"]),
  }),
  z.object({
    type: z.literal("cancel"),
  }),
  z.object({
    type: z.literal("timeout"),
    default: z.enum(["background", "foreground"]),
  }),
]);

// -----------------------------------------------------------------------------
// CompletionEvent (terminal statuses only)
// -----------------------------------------------------------------------------

export const CompletionEventSchema = z.object({
  task_id: z.string(),
  status: z.enum(["completed", "killed", "killed_on_disconnect", "error"]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  completed_at: z.string().datetime(),
});

// -----------------------------------------------------------------------------
// Policy + sub-schemas
// -----------------------------------------------------------------------------

export const SecurityLimitsSchema = z.object({
  max_concurrent_bg_tasks: z.number().int().positive().optional(),
  timeout_per_task_ms: z.number().int().positive().optional(),
  blocked_tools_in_bg: z.array(z.string()).optional(),
});

export const HistoryConfigSchema = z.object({
  rotation_size_mb: z.number().positive().default(10),
  retention_days: z.number().int().positive().default(30),
});

export const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(false),
});

export const PolicySchema = z.object({
  $schema: z.string().url().optional(),
  default_mode_by_agent_type: z.record(z.string(), ModeSchema).default({}),
  default_mode_by_agent_name: z.record(z.string(), ModeSchema).optional(),
  timeout_ms: z.number().int().nonnegative().default(2000),
  security: SecurityLimitsSchema.default({}),
  history: HistoryConfigSchema.default({ rotation_size_mb: 10, retention_days: 30 }),
  telemetry: TelemetryConfigSchema.default({ enabled: false }),
});

// -----------------------------------------------------------------------------
// Schema-inferred raw types (internal). Public types re-exported from types.ts
// -----------------------------------------------------------------------------

export type ModeInferred = z.infer<typeof ModeSchema>;
export type TaskStatusInferred = z.infer<typeof TaskStatusSchema>;
export type TaskEnvelopeInferred = z.infer<typeof TaskEnvelopeSchema>;
export type PickerEventInferred = z.infer<typeof PickerEventSchema>;
export type CompletionEventInferred = z.infer<typeof CompletionEventSchema>;
export type SecurityLimitsInferred = z.infer<typeof SecurityLimitsSchema>;
export type HistoryConfigInferred = z.infer<typeof HistoryConfigSchema>;
export type TelemetryConfigInferred = z.infer<typeof TelemetryConfigSchema>;
export type PolicyInferred = z.infer<typeof PolicySchema>;
