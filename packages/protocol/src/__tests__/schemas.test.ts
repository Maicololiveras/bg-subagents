import { describe, expect, it } from "vitest";
import {
  CompletionEventSchema,
  HistoryConfigSchema,
  PickerEventSchema,
  PolicySchema,
  SecurityLimitsSchema,
  TaskEnvelopeSchema,
} from "../schemas.js";

const baseEnvelope = {
  task_id: "tsk_ab12cd34",
  subagent_type: "code-researcher",
  prompt: "Find all usages of foo",
  started_at: "2026-04-20T12:00:00.000Z",
  status: "running" as const,
  log_path: "/tmp/tsk_ab12cd34.log",
};

describe("TaskEnvelopeSchema", () => {
  it("parses a minimal valid running envelope", () => {
    const parsed = TaskEnvelopeSchema.parse(baseEnvelope);
    expect(parsed.task_id).toBe("tsk_ab12cd34");
    expect(parsed.status).toBe("running");
  });

  it("rejects missing required fields", () => {
    expect(() => TaskEnvelopeSchema.parse({ ...baseEnvelope, task_id: undefined })).toThrow();
    expect(() => TaskEnvelopeSchema.parse({ ...baseEnvelope, status: undefined })).toThrow();
    expect(() => TaskEnvelopeSchema.parse({ ...baseEnvelope, log_path: undefined })).toThrow();
  });

  it("rejects invalid task_id shape", () => {
    // Missing tsk_ prefix
    expect(() => TaskEnvelopeSchema.parse({ ...baseEnvelope, task_id: "bad_id12345" })).toThrow();
    // Too short (spec requires at least 8 chars after prefix)
    expect(() => TaskEnvelopeSchema.parse({ ...baseEnvelope, task_id: "tsk_123" })).toThrow();
    // Exactly 8 chars after prefix — valid minimum
    expect(() =>
      TaskEnvelopeSchema.parse({ ...baseEnvelope, task_id: "tsk_12345678" }),
    ).not.toThrow();
  });

  it("accepts all v0.1 + v0.2 forward-contract status values", () => {
    const statuses = [
      "running",
      "completed",
      "killed",
      "killed_on_disconnect",
      "error",
      "cancelled",
      "passthrough",
      "rejected_limit",
    ] as const;
    for (const status of statuses) {
      expect(() => TaskEnvelopeSchema.parse({ ...baseEnvelope, status })).not.toThrow();
    }
  });

  it("rejects unknown status", () => {
    expect(() =>
      TaskEnvelopeSchema.parse({ ...baseEnvelope, status: "mystery_status" }),
    ).toThrow();
  });

  it("accepts optional terminal fields", () => {
    const parsed = TaskEnvelopeSchema.parse({
      ...baseEnvelope,
      status: "completed",
      completed_at: "2026-04-20T12:01:00.000Z",
      result: { summary: "done" },
      strategy_used: "official_background_field",
      policy_default_applied: true,
    });
    expect(parsed.completed_at).toBe("2026-04-20T12:01:00.000Z");
    expect(parsed.policy_default_applied).toBe(true);
  });

  it("roundtrips an error envelope", () => {
    const input = {
      ...baseEnvelope,
      status: "error" as const,
      error: { code: "BOOM", message: "it failed" },
    };
    const parsed = TaskEnvelopeSchema.parse(input);
    expect(parsed.error?.code).toBe("BOOM");
  });
});

describe("PolicySchema", () => {
  it("accepts an empty object and fills defaults", () => {
    const parsed = PolicySchema.parse({});
    expect(parsed.timeout_ms).toBe(2000);
    expect(parsed.default_mode_by_agent_type).toEqual({});
    expect(parsed.security).toEqual({});
    expect(parsed.telemetry.enabled).toBe(false);
  });

  it("accepts a full policy with all optional fields", () => {
    const parsed = PolicySchema.parse({
      $schema: "https://bg-subagents.dev/schema/policy-v1.json",
      default_mode_by_agent_type: { research: "background" },
      default_mode_by_agent_name: { "code-researcher": "background" },
      timeout_ms: 2000,
      security: {
        max_concurrent_bg_tasks: 5,
        timeout_per_task_ms: 600_000,
        blocked_tools_in_bg: ["shell"],
      },
      history: { rotation_size_mb: 10, retention_days: 30 },
      telemetry: { enabled: false },
    });
    expect(parsed.default_mode_by_agent_type.research).toBe("background");
    expect(parsed.security.max_concurrent_bg_tasks).toBe(5);
  });

  it("rejects invalid agent-type mode values", () => {
    expect(() =>
      PolicySchema.parse({ default_mode_by_agent_type: { research: "bogus" } }),
    ).toThrow();
  });

  it("rejects non-object shapes for default_mode_by_agent_type (Scenario 7)", () => {
    expect(() =>
      PolicySchema.parse({ default_mode_by_agent_type: "not-an-object" }),
    ).toThrow();
  });

  it("preserves reserved security fields round-trip", () => {
    const input = {
      security: {
        max_concurrent_bg_tasks: 3,
        timeout_per_task_ms: 120_000,
        blocked_tools_in_bg: ["shell", "file_write"],
      },
    };
    const parsed = PolicySchema.parse(input);
    expect(parsed.security).toEqual(input.security);
  });
});

describe("SecurityLimitsSchema", () => {
  it("defaults to an empty object that passes through unchanged", () => {
    const parsed = SecurityLimitsSchema.parse({});
    expect(parsed).toEqual({});
  });

  it("rejects negative or zero values", () => {
    expect(() => SecurityLimitsSchema.parse({ max_concurrent_bg_tasks: 0 })).toThrow();
    expect(() => SecurityLimitsSchema.parse({ timeout_per_task_ms: -1 })).toThrow();
  });
});

describe("HistoryConfigSchema", () => {
  it("applies defaults of 10 MB and 30 days when absent", () => {
    const parsed = HistoryConfigSchema.parse({});
    expect(parsed.rotation_size_mb).toBe(10);
    expect(parsed.retention_days).toBe(30);
  });

  it("rejects negative retention_days", () => {
    expect(() => HistoryConfigSchema.parse({ retention_days: -1 })).toThrow();
  });
});

describe("PickerEventSchema", () => {
  it("parses a choice event", () => {
    const parsed = PickerEventSchema.parse({ type: "choice", mode: "background" });
    expect(parsed.type).toBe("choice");
    if (parsed.type === "choice") {
      expect(parsed.mode).toBe("background");
    }
  });

  it("parses a cancel event", () => {
    const parsed = PickerEventSchema.parse({ type: "cancel" });
    expect(parsed.type).toBe("cancel");
  });

  it("parses a timeout event", () => {
    const parsed = PickerEventSchema.parse({ type: "timeout", default: "foreground" });
    expect(parsed.type).toBe("timeout");
  });

  it("rejects unknown discriminant type", () => {
    expect(() => PickerEventSchema.parse({ type: "bogus", mode: "background" })).toThrow();
  });

  it("rejects missing discriminant fields", () => {
    expect(() => PickerEventSchema.parse({ type: "choice" })).toThrow();
    expect(() => PickerEventSchema.parse({ type: "timeout" })).toThrow();
  });
});

describe("CompletionEventSchema", () => {
  it("parses a completed event", () => {
    const parsed = CompletionEventSchema.parse({
      task_id: "tsk_ab12cd34",
      status: "completed",
      result: { ok: true },
      completed_at: "2026-04-20T12:01:00.000Z",
    });
    expect(parsed.status).toBe("completed");
  });

  it("parses killed, killed_on_disconnect, and error statuses", () => {
    for (const status of ["killed", "killed_on_disconnect", "error"] as const) {
      expect(() =>
        CompletionEventSchema.parse({
          task_id: "tsk_ab12cd34",
          status,
          completed_at: "2026-04-20T12:01:00.000Z",
        }),
      ).not.toThrow();
    }
  });

  it("rejects non-terminal statuses like running", () => {
    expect(() =>
      CompletionEventSchema.parse({
        task_id: "tsk_ab12cd34",
        status: "running",
        completed_at: "2026-04-20T12:01:00.000Z",
      }),
    ).toThrow();
  });
});
