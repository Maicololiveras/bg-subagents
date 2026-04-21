import { describe, expect, it } from "vitest";
import {
  BgLimitError,
  IncompatibleProtocolError,
  PolicyValidationError,
} from "../errors.js";

describe("IncompatibleProtocolError", () => {
  it("constructs with required fields, defaults to MAJOR code", () => {
    const err = new IncompatibleProtocolError({
      required: "^1.0.0",
      installed: "2.0.0",
      adapter: "@maicolextic/bg-subagents-opencode",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("IncompatibleProtocolError");
    expect(err.code).toBe("INCOMPATIBLE_PROTOCOL_MAJOR");
    expect(err.required).toBe("^1.0.0");
    expect(err.installed).toBe("2.0.0");
    expect(err.adapter).toBe("@maicolextic/bg-subagents-opencode");
  });

  it("constructs with MINOR code when severity=minor", () => {
    const err = new IncompatibleProtocolError({
      required: "^1.0.0",
      installed: "1.3.0",
      adapter: "@maicolextic/bg-subagents-opencode",
      severity: "minor",
    });
    expect(err.code).toBe("INCOMPATIBLE_PROTOCOL_MINOR");
  });

  it("carries a descriptive message referencing versions", () => {
    const err = new IncompatibleProtocolError({
      required: "^1.0.0",
      installed: "2.0.0",
      adapter: "opencode",
    });
    expect(err.message).toContain("^1.0.0");
    expect(err.message).toContain("2.0.0");
    expect(err.message).toContain("opencode");
  });
});

describe("PolicyValidationError", () => {
  it("constructs with required shape and code", () => {
    const err = new PolicyValidationError({
      path: "default_mode_by_agent_type",
      expected: "Record<string, Mode>",
      got: "string",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyValidationError");
    expect(err.code).toBe("POLICY_VALIDATION_FAILED");
    expect(err.path).toBe("default_mode_by_agent_type");
    expect(err.expected).toBe("Record<string, Mode>");
    expect(err.got).toBe("string");
  });

  it("preserves optional approx_line / approx_col", () => {
    const err = new PolicyValidationError({
      path: "security.max_concurrent_bg_tasks",
      expected: "number",
      got: "string",
      approx_line: 12,
      approx_col: 5,
    });
    expect(err.approx_line).toBe(12);
    expect(err.approx_col).toBe(5);
  });

  it("builds a readable message", () => {
    const err = new PolicyValidationError({
      path: "default_mode_by_agent_type",
      expected: "Record<string, Mode>",
      got: "string",
      approx_line: 12,
      approx_col: 5,
    });
    expect(err.message).toContain("default_mode_by_agent_type");
    expect(err.message).toContain("12");
  });
});

describe("BgLimitError", () => {
  it("constructs with required limit+running", () => {
    const err = new BgLimitError({ limit: 5, running: 5 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("BgLimitError");
    expect(err.code).toBe("BG_LIMIT_REACHED");
    expect(err.limit).toBe(5);
    expect(err.running).toBe(5);
    expect(err.retry_after_hint_ms).toBeUndefined();
  });

  it("preserves retry_after_hint_ms when provided", () => {
    const err = new BgLimitError({ limit: 5, running: 5, retry_after_hint_ms: 30_000 });
    expect(err.retry_after_hint_ms).toBe(30_000);
  });

  it("carries a message mentioning the limit", () => {
    const err = new BgLimitError({ limit: 5, running: 5 });
    expect(err.message).toContain("5");
  });
});
