/**
 * detectHostVersion — unit tests covering spec scenarios:
 *   - v14 detection (client field, no legacy fields)
 *   - legacy detection (session_id + bus.emit + session fields)
 *   - unknown detection (neither shape)
 *   - env override BG_SUBAGENTS_FORCE_COMPAT (legacy | v14)
 *   - invalid env value → auto-detect + warn
 *   - detection <50ms
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/host-compat/spec.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectHostVersion,
  type HostVersion,
} from "../../host-compat/version-detect.js";

const ENV_KEY = "BG_SUBAGENTS_FORCE_COMPAT";

function makeLoggerSpy() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function v14Ctx() {
  // OpenCode 1.14+ shape: client + project + directory + worktree + serverUrl + $.
  return {
    client: { session: {} },
    project: { id: "proj_1" },
    directory: "/tmp/work",
    worktree: "/tmp/work",
    serverUrl: new URL("http://localhost:4096"),
  };
}

function legacyCtx() {
  // Legacy shape: session_id + bus + session (SessionApi surface).
  return {
    session_id: "sess_abc",
    bus: { emit: vi.fn() },
    session: {
      create: vi.fn(),
      prompt: vi.fn(),
      writeAssistantMessage: vi.fn(),
    },
  };
}

describe("detectHostVersion — auto detection", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 'v14' for a ctx with client and no legacy fields", () => {
    expect(detectHostVersion(v14Ctx())).toBe("v14");
  });

  it("returns 'legacy' for a ctx with session_id + bus + session", () => {
    expect(detectHostVersion(legacyCtx())).toBe("legacy");
  });

  it("returns 'unknown' for a ctx with neither shape", () => {
    expect(detectHostVersion({})).toBe("unknown");
    expect(detectHostVersion({ foo: "bar" })).toBe("unknown");
  });

  it("returns 'unknown' for null or non-object ctx", () => {
    expect(detectHostVersion(null)).toBe("unknown");
    expect(detectHostVersion(undefined)).toBe("unknown");
    expect(detectHostVersion("not-a-ctx")).toBe("unknown");
  });

  it("treats ctx with only session_id (no bus/session) as 'unknown'", () => {
    expect(detectHostVersion({ session_id: "sess_x" })).toBe("unknown");
  });

  it("treats ctx with bus but no session_id/session as 'unknown'", () => {
    expect(detectHostVersion({ bus: { emit: vi.fn() } })).toBe("unknown");
  });

  it("completes detection in under 50ms for legacy ctx", () => {
    const t0 = performance.now();
    detectHostVersion(legacyCtx());
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(50);
  });

  it("completes detection in under 50ms for v14 ctx", () => {
    const t0 = performance.now();
    detectHostVersion(v14Ctx());
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(50);
  });
});

describe("detectHostVersion — env override", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("forces 'legacy' when env var is 'legacy' even with v14-shaped ctx", () => {
    vi.stubEnv(ENV_KEY, "legacy");
    const logger = makeLoggerSpy();
    expect(detectHostVersion(v14Ctx(), { logger })).toBe("legacy");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "host-compat:forced",
        value: "legacy",
      }),
    );
  });

  it("forces 'v14' when env var is 'v14' even with legacy-shaped ctx", () => {
    vi.stubEnv(ENV_KEY, "v14");
    const logger = makeLoggerSpy();
    expect(detectHostVersion(legacyCtx(), { logger })).toBe("v14");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "host-compat:forced",
        value: "v14",
      }),
    );
  });

  it("ignores invalid env value, falls back to auto-detect, and emits warn", () => {
    vi.stubEnv(ENV_KEY, "not-a-version");
    const logger = makeLoggerSpy();
    expect(detectHostVersion(v14Ctx(), { logger })).toBe("v14");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "host-compat:bad-force-value",
        value: "not-a-version",
      }),
    );
  });

  it("ignores empty-string env value and uses auto-detect", () => {
    vi.stubEnv(ENV_KEY, "");
    expect(detectHostVersion(legacyCtx())).toBe("legacy");
  });

  it("HostVersion type accepts the three literal values", () => {
    const values: HostVersion[] = ["v14", "legacy", "unknown"];
    expect(values).toHaveLength(3);
  });
});
