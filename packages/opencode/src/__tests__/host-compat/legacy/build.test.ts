/**
 * buildLegacyHooks — integration test covering compat-legacy spec.
 *
 * Asserts that given a legacy-shaped ctx, the returned Hooks has:
 *   - tool: [taskBg] (array with exactly the task_bg entry)
 *   - tool.execute.before: function
 *   - chat.params: function
 *   - plugin:booted log emitted at info level with session_id + task_bg_registered + invoker
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/compat-legacy/spec.md
 */

import { describe, expect, it, vi } from "vitest";

import { buildLegacyHooks } from "../../../host-compat/legacy/index.js";
import { makeFakePluginContext } from "../../fixtures/fakePluginContext.js";
import type { Logger } from "@maicolextic/bg-subagents-core";

function makeLoggerSpy(): Logger & {
  infoCalls: Array<[string, Record<string, unknown> | undefined]>;
  warnCalls: Array<[string, Record<string, unknown> | undefined]>;
} {
  const infoCalls: Array<[string, Record<string, unknown> | undefined]> = [];
  const warnCalls: Array<[string, Record<string, unknown> | undefined]> = [];
  const logger = {
    info: vi.fn((msg: string, meta?: Record<string, unknown>) => {
      infoCalls.push([msg, meta]);
    }),
    warn: vi.fn((msg: string, meta?: Record<string, unknown>) => {
      warnCalls.push([msg, meta]);
    }),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => logger),
  } as unknown as Logger & {
    infoCalls: typeof infoCalls;
    warnCalls: typeof warnCalls;
  };
  logger.infoCalls = infoCalls;
  logger.warnCalls = warnCalls;
  return logger;
}

describe("buildLegacyHooks", () => {
  it("returns Hooks with tool containing exactly task_bg", async () => {
    const { ctx } = makeFakePluginContext({ session_id: "sess_legacy_1" });
    const hooks = await buildLegacyHooks(ctx);
    expect(Array.isArray(hooks.tool)).toBe(true);
    const names = (hooks.tool ?? []).map((t) => t.name);
    expect(names).toEqual(["task_bg"]);
  });

  it("returns Hooks with tool.execute.before as a function", async () => {
    const { ctx } = makeFakePluginContext();
    const hooks = await buildLegacyHooks(ctx);
    expect(typeof hooks["tool.execute.before"]).toBe("function");
  });

  it("returns Hooks with chat.params as a function", async () => {
    const { ctx } = makeFakePluginContext();
    const hooks = await buildLegacyHooks(ctx);
    expect(typeof hooks["chat.params"]).toBe("function");
  });

  it("emits plugin:booted info log with session_id, task_bg_registered, invoker", async () => {
    const { ctx } = makeFakePluginContext({ session_id: "sess_boot_probe" });
    const logger = makeLoggerSpy();
    await buildLegacyHooks(ctx, { logger });

    const bootEntry = logger.infoCalls.find(([msg]) => msg === "plugin:booted");
    expect(bootEntry).toBeDefined();
    const meta = bootEntry?.[1];
    expect(meta).toMatchObject({
      session_id: "sess_boot_probe",
      task_bg_registered: true,
    });
    expect(typeof meta?.invoker).toBe("string");
  });
});
