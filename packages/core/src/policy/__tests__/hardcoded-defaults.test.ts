/**
 * Tests for HARDCODED_DEFAULT_POLICY — the baseline object used when no
 * policy.jsonc exists on disk or fails to load.
 */
import { describe, expect, it } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

import { HARDCODED_DEFAULT_POLICY, resolveDefaultHistoryPath } from "../hardcoded-defaults.js";
import { PolicySchema } from "@maicolextic/bg-subagents-protocol";

describe("HARDCODED_DEFAULT_POLICY", () => {
  it("is schema-valid against PolicySchema", () => {
    expect(() => PolicySchema.parse(HARDCODED_DEFAULT_POLICY)).not.toThrow();
  });

  it("is permissive by default: no agent-name rules, no type rules → picker defaults to 'ask'", () => {
    expect(HARDCODED_DEFAULT_POLICY.default_mode_by_agent_type).toEqual({});
    expect(HARDCODED_DEFAULT_POLICY.default_mode_by_agent_name).toBeUndefined();
  });

  it("has telemetry disabled by default (NFR-9 opt-in only)", () => {
    expect(HARDCODED_DEFAULT_POLICY.telemetry.enabled).toBe(false);
  });

  it("has no security limits set by default (fields reserved for v0.2+ enforcement)", () => {
    expect(HARDCODED_DEFAULT_POLICY.security.max_concurrent_bg_tasks).toBeUndefined();
    expect(HARDCODED_DEFAULT_POLICY.security.timeout_per_task_ms).toBeUndefined();
    expect(HARDCODED_DEFAULT_POLICY.security.blocked_tools_in_bg).toBeUndefined();
  });

  it("has a 2000 ms default picker timeout (per spec §4 + scenario 3)", () => {
    expect(HARDCODED_DEFAULT_POLICY.timeout_ms).toBe(2000);
  });

  it("has sane history rotation defaults (10 MB, 30 days) per FR-16 + Q4", () => {
    expect(HARDCODED_DEFAULT_POLICY.history.rotation_size_mb).toBe(10);
    expect(HARDCODED_DEFAULT_POLICY.history.retention_days).toBe(30);
  });
});

describe("resolveDefaultHistoryPath", () => {
  it("returns an absolute path rooted under the user's home directory (POSIX + Windows)", () => {
    const p = resolveDefaultHistoryPath();
    expect(path.isAbsolute(p)).toBe(true);
    expect(p.endsWith("history.jsonl")).toBe(true);
  });

  it("includes the bg-subagents segment", () => {
    const p = resolveDefaultHistoryPath();
    expect(p).toContain("bg-subagents");
  });

  it("is under os.homedir() (XDG-aware fallback uses ~/.config/bg-subagents/)", () => {
    const home = os.homedir();
    const p = resolveDefaultHistoryPath();
    expect(p.startsWith(home)).toBe(true);
  });
});
