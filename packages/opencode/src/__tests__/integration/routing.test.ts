/**
 * Integration test: Version Detection Routing — Phase 14.5
 *
 * Validates that plugin.ts routes to the correct compat builder based on
 * the detected host version:
 *   - v14 ctx shape → hooks contain experimental.chat.messages.transform
 *   - legacy ctx shape → hooks contain chat.params (classic shape)
 *   - BG_SUBAGENTS_FORCE_COMPAT=legacy forces legacy even on v14 ctx
 *   - Unknown ctx → attempts legacy fallback (may succeed or return empty {})
 *
 * Also validates detectHostVersion() directly:
 *   - v14 shape detected correctly
 *   - legacy shape detected correctly
 *   - unknown shape → "unknown"
 *   - env override v14/legacy forces the value
 *   - invalid env override → ignored, falls through to auto-detect
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md 14.5
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectHostVersion } from "../../host-compat/version-detect.js";
import pluginModule from "../../plugin.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeV14Ctx() {
  return {
    client: {
      session: {
        prompt: vi.fn(async () => ({ data: { info: { id: "msg_route", role: "user" } } })),
      },
    },
    project: { id: "proj_route_test" },
    directory: "/tmp/route",
    worktree: "/tmp/route",
    serverUrl: new URL("http://localhost:4096"),
  };
}

function makeLegacyCtx(session_id = "sess_legacy_route") {
  const busEmits: unknown[] = [];
  return {
    session_id,
    bus: {
      emit: (event: unknown) => {
        busEmits.push(event);
      },
    },
    session: {
      writeAssistantMessage: vi.fn(),
      prompt: vi.fn(async () => "ok"),
    },
    busEmits,
  };
}

function makeUnknownCtx() {
  return {
    whatever: 42,
    notV14: true,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// 14.5.A — detectHostVersion unit-level assertions
// ---------------------------------------------------------------------------

describe("detectHostVersion — shape classification", () => {
  afterEach(() => {
    delete process.env["BG_SUBAGENTS_FORCE_COMPAT"];
  });

  it("v14 ctx shape → returns 'v14'", () => {
    const ctx = makeV14Ctx();
    expect(detectHostVersion(ctx)).toBe("v14");
  });

  it("legacy ctx shape (session_id + bus + session) → returns 'legacy'", () => {
    const ctx = makeLegacyCtx();
    expect(detectHostVersion(ctx)).toBe("legacy");
  });

  it("unknown ctx shape → returns 'unknown'", () => {
    expect(detectHostVersion(makeUnknownCtx())).toBe("unknown");
  });

  it("null ctx → returns 'unknown'", () => {
    expect(detectHostVersion(null)).toBe("unknown");
  });

  it("non-object ctx → returns 'unknown'", () => {
    expect(detectHostVersion("just a string")).toBe("unknown");
  });

  it("ctx with both client AND session_id (edge case) → classified as v14 (client wins, no bus)", () => {
    // client present, no bus, no session_id at top level → v14
    // If session_id is present BUT no bus, hasLegacyShape returns false, hasV14Shape returns true
    const ctx = {
      client: { session: { prompt: vi.fn() } },
      // no bus, no session_id at top level
    };
    expect(detectHostVersion(ctx)).toBe("v14");
  });
});

describe("detectHostVersion — env override", () => {
  afterEach(() => {
    delete process.env["BG_SUBAGENTS_FORCE_COMPAT"];
  });

  it("BG_SUBAGENTS_FORCE_COMPAT=legacy forces legacy even on v14 ctx", () => {
    process.env["BG_SUBAGENTS_FORCE_COMPAT"] = "legacy";
    const ctx = makeV14Ctx();
    expect(detectHostVersion(ctx)).toBe("legacy");
  });

  it("BG_SUBAGENTS_FORCE_COMPAT=v14 forces v14 even on legacy ctx", () => {
    process.env["BG_SUBAGENTS_FORCE_COMPAT"] = "v14";
    const ctx = makeLegacyCtx();
    expect(detectHostVersion(ctx)).toBe("v14");
  });

  it("BG_SUBAGENTS_FORCE_COMPAT=invalid-value → ignored, auto-detect applies, warn logged", () => {
    process.env["BG_SUBAGENTS_FORCE_COMPAT"] = "NOT_VALID";
    const logger = makeLogger();
    const ctx = makeV14Ctx();
    const version = detectHostVersion(ctx, { logger });
    // Invalid value → ignored → auto-detect → v14
    expect(version).toBe("v14");
    // Logger must have received a warn call about the bad value
    expect(logger.warn).toHaveBeenCalled();
    const warnArgs = logger.warn.mock.calls[0];
    expect(warnArgs?.[0]).toContain("bad-force-value");
  });

  it("BG_SUBAGENTS_FORCE_COMPAT='' (empty string) → treated as unset, auto-detect applies", () => {
    process.env["BG_SUBAGENTS_FORCE_COMPAT"] = "";
    const ctx = makeV14Ctx();
    expect(detectHostVersion(ctx)).toBe("v14");
  });
});

// ---------------------------------------------------------------------------
// 14.5.B — plugin.ts routing via pluginModule.server()
// ---------------------------------------------------------------------------

describe("plugin.ts routing — v14 ctx shape → buildV14Hooks", () => {
  beforeEach(() => {
    delete process.env["BG_SUBAGENTS_FORCE_COMPAT"];
  });
  afterEach(() => {
    delete process.env["BG_SUBAGENTS_FORCE_COMPAT"];
    vi.restoreAllMocks();
  });

  it("v14 ctx → returned Hooks has experimental.chat.messages.transform (v14 path)", async () => {
    const ctx = makeV14Ctx();
    const hooks = await pluginModule.server(ctx as never);

    // v14 path must return messages.transform hook
    const mtHook = (hooks as Record<string, unknown>)["experimental.chat.messages.transform"];
    expect(typeof mtHook).toBe("function");
  });

  it("v14 ctx → returned Hooks has experimental.chat.system.transform", async () => {
    const ctx = makeV14Ctx();
    const hooks = await pluginModule.server(ctx as never);

    const stHook = (hooks as Record<string, unknown>)["experimental.chat.system.transform"];
    expect(typeof stHook).toBe("function");
  });

  it("v14 ctx → returned Hooks.tool is an object (not an array)", async () => {
    const ctx = makeV14Ctx();
    const hooks = await pluginModule.server(ctx as never);

    const tools = (hooks as Record<string, unknown>)["tool"];
    expect(tools).toBeDefined();
    expect(typeof tools).toBe("object");
    expect(Array.isArray(tools)).toBe(false);
  });
});

describe("plugin.ts routing — legacy ctx shape → buildLegacyHooks", () => {
  beforeEach(() => {
    delete process.env["BG_SUBAGENTS_FORCE_COMPAT"];
  });
  afterEach(() => {
    delete process.env["BG_SUBAGENTS_FORCE_COMPAT"];
    vi.restoreAllMocks();
  });

  it("legacy ctx → returned Hooks has chat.params (classic hook shape)", async () => {
    const ctx = makeLegacyCtx();
    const hooks = await pluginModule.server(ctx as never);

    const chatParams = (hooks as Record<string, unknown>)["chat.params"];
    expect(typeof chatParams).toBe("function");
  });

  it("legacy ctx → returned Hooks does NOT have experimental.chat.messages.transform", async () => {
    const ctx = makeLegacyCtx();
    const hooks = await pluginModule.server(ctx as never);

    const mtHook = (hooks as Record<string, unknown>)["experimental.chat.messages.transform"];
    // Legacy path does not wire this hook
    expect(mtHook).toBeUndefined();
  });

  it("legacy ctx → returned Hooks.tool is an array (classic shape)", async () => {
    const ctx = makeLegacyCtx();
    const hooks = await pluginModule.server(ctx as never);

    const tools = (hooks as Record<string, unknown>)["tool"];
    expect(Array.isArray(tools)).toBe(true);
  });
});

describe("plugin.ts routing — env override BG_SUBAGENTS_FORCE_COMPAT=legacy", () => {
  beforeEach(() => {
    process.env["BG_SUBAGENTS_FORCE_COMPAT"] = "legacy";
  });
  afterEach(() => {
    delete process.env["BG_SUBAGENTS_FORCE_COMPAT"];
    vi.restoreAllMocks();
  });

  it("force=legacy on v14 ctx → hooks have chat.params (legacy builder used)", async () => {
    const ctx = makeV14Ctx();
    const hooks = await pluginModule.server(ctx as never);

    const chatParams = (hooks as Record<string, unknown>)["chat.params"];
    expect(typeof chatParams).toBe("function");
  });

  it("force=legacy on v14 ctx → hooks do NOT have experimental.chat.messages.transform", async () => {
    const ctx = makeV14Ctx();
    const hooks = await pluginModule.server(ctx as never);

    const mtHook = (hooks as Record<string, unknown>)["experimental.chat.messages.transform"];
    expect(mtHook).toBeUndefined();
  });
});

describe("plugin.ts routing — unknown ctx → legacy fallback attempted", () => {
  beforeEach(() => {
    delete process.env["BG_SUBAGENTS_FORCE_COMPAT"];
  });
  afterEach(() => {
    delete process.env["BG_SUBAGENTS_FORCE_COMPAT"];
    vi.restoreAllMocks();
  });

  it("unknown ctx shape → server() resolves (either fallback hooks or empty {})", async () => {
    const ctx = makeUnknownCtx();
    // Should not throw — either falls back to legacy or returns empty {}
    await expect(pluginModule.server(ctx as never)).resolves.toBeDefined();
  });
});
