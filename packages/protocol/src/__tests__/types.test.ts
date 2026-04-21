import { describe, expectTypeOf, it } from "vitest";
import type {
  CompletionEvent,
  HistoryConfig,
  Mode,
  PickerEvent,
  Policy,
  SecurityLimits,
  TaskEnvelope,
  TaskId,
  TaskStatus,
} from "../types.js";

describe("inferred types", () => {
  it("Mode is the union 'background' | 'foreground' | 'ask'", () => {
    expectTypeOf<Mode>().toEqualTypeOf<"background" | "foreground" | "ask">();
  });

  it("TaskStatus includes all v0.1 + v0.2 forward-contract values", () => {
    type Expected =
      | "running"
      | "completed"
      | "killed"
      | "killed_on_disconnect"
      | "error"
      | "cancelled"
      | "passthrough"
      | "rejected_limit";
    expectTypeOf<TaskStatus>().toEqualTypeOf<Expected>();
  });

  it("TaskEnvelope infers from schema with required fields", () => {
    expectTypeOf<TaskEnvelope>().toHaveProperty("task_id").toEqualTypeOf<TaskId>();
    expectTypeOf<TaskEnvelope>().toHaveProperty("status").toEqualTypeOf<TaskStatus>();
    expectTypeOf<TaskEnvelope>().toHaveProperty("prompt").toEqualTypeOf<string>();
  });

  it("Policy has defaulted fields typed as required (post-parse)", () => {
    expectTypeOf<Policy>().toHaveProperty("timeout_ms").toEqualTypeOf<number>();
    expectTypeOf<Policy>().toHaveProperty("default_mode_by_agent_type").toEqualTypeOf<
      Readonly<Record<string, Mode>>
    >();
    expectTypeOf<Policy>().toHaveProperty("security").toEqualTypeOf<SecurityLimits>();
  });

  it("PickerEvent is a discriminated union keyed on 'type'", () => {
    type ChoiceEvent = Extract<PickerEvent, { type: "choice" }>;
    type CancelEvent = Extract<PickerEvent, { type: "cancel" }>;
    type TimeoutEvent = Extract<PickerEvent, { type: "timeout" }>;
    expectTypeOf<ChoiceEvent>().toHaveProperty("mode");
    expectTypeOf<CancelEvent>().not.toHaveProperty("mode");
    expectTypeOf<TimeoutEvent>().toHaveProperty("default");
  });

  it("CompletionEvent narrows status to terminal values only", () => {
    expectTypeOf<CompletionEvent>()
      .toHaveProperty("status")
      .toEqualTypeOf<"completed" | "killed" | "killed_on_disconnect" | "error">();
  });

  it("HistoryConfig has numeric rotation + retention", () => {
    expectTypeOf<HistoryConfig>().toHaveProperty("rotation_size_mb").toEqualTypeOf<number>();
    expectTypeOf<HistoryConfig>().toHaveProperty("retention_days").toEqualTypeOf<number>();
  });

  it("TaskId is a branded nominal string (not widened to string)", () => {
    expectTypeOf<TaskId>().not.toEqualTypeOf<string>();
    expectTypeOf<TaskId>().toMatchTypeOf<string>();
  });
});
