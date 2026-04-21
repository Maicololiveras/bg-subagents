/**
 * Tests for the local policy schema re-exports + wrappers.
 *
 * Core does NOT redefine zod schemas — it re-exports from @maicolextic/bg-subagents-protocol
 * and adds a LoadedPolicy wrapper + parsePolicyFile sanity helper.
 */
import { describe, expect, it } from "vitest";
import {
  HistoryConfigSchema as ProtocolHistoryConfigSchema,
  PolicySchema as ProtocolPolicySchema,
  SecurityLimitsSchema as ProtocolSecurityLimitsSchema,
  TelemetryConfigSchema as ProtocolTelemetryConfigSchema,
} from "@maicolextic/bg-subagents-protocol";

import {
  HistoryConfigSchema,
  LoadedPolicySchema,
  parsePolicyFile,
  PolicySchema,
  SecurityLimitsSchema,
  TelemetryConfigSchema,
} from "../schema.js";

describe("core/policy/schema — re-exports from @maicolextic/bg-subagents-protocol", () => {
  it("PolicySchema is re-exported from protocol (same reference)", () => {
    expect(PolicySchema).toBe(ProtocolPolicySchema);
  });

  it("SecurityLimitsSchema is re-exported from protocol", () => {
    expect(SecurityLimitsSchema).toBe(ProtocolSecurityLimitsSchema);
  });

  it("HistoryConfigSchema is re-exported from protocol", () => {
    expect(HistoryConfigSchema).toBe(ProtocolHistoryConfigSchema);
  });

  it("TelemetryConfigSchema is re-exported from protocol", () => {
    expect(TelemetryConfigSchema).toBe(ProtocolTelemetryConfigSchema);
  });
});

describe("LoadedPolicySchema wrapper", () => {
  it("accepts a minimal valid LoadedPolicy shape", () => {
    const parsed = LoadedPolicySchema.parse({
      policy: {
        default_mode_by_agent_type: {},
        timeout_ms: 2000,
        security: {},
        history: { rotation_size_mb: 10, retention_days: 30 },
        telemetry: { enabled: false },
      },
      source: "file",
      warnings: [],
    });
    expect(parsed.source).toBe("file");
    expect(parsed.warnings).toEqual([]);
  });

  it("accepts the optional migrated flag", () => {
    const parsed = LoadedPolicySchema.parse({
      policy: {
        default_mode_by_agent_type: {},
        timeout_ms: 2000,
        security: {},
        history: { rotation_size_mb: 10, retention_days: 30 },
        telemetry: { enabled: false },
      },
      source: "file",
      migrated: true,
      warnings: ["minor schema bump auto-migrated"],
    });
    expect(parsed.migrated).toBe(true);
    expect(parsed.warnings).toHaveLength(1);
  });

  it("rejects unknown source values", () => {
    expect(() =>
      LoadedPolicySchema.parse({
        policy: {
          default_mode_by_agent_type: {},
          timeout_ms: 2000,
          security: {},
          history: { rotation_size_mb: 10, retention_days: 30 },
          telemetry: { enabled: false },
        },
        source: "network",
        warnings: [],
      }),
    ).toThrow();
  });
});

describe("parsePolicyFile", () => {
  it("validates + attaches source:'file' metadata", () => {
    const raw = {
      default_mode_by_agent_type: { research: "background" },
      timeout_ms: 1500,
      telemetry: { enabled: false },
    };
    const loaded = parsePolicyFile(raw);
    expect(loaded.source).toBe("file");
    expect(loaded.policy.default_mode_by_agent_type).toEqual({
      research: "background",
    });
    expect(loaded.warnings).toEqual([]);
  });

  it("throws on schema-invalid input", () => {
    expect(() => parsePolicyFile({ default_mode_by_agent_type: "oops" })).toThrow();
  });
});
