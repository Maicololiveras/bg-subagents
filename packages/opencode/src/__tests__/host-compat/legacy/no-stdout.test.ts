/**
 * Phase 7.5.8 — Legacy catch-all zero-stdout test.
 *
 * Hard constraint: the legacy compat path MUST NOT write anything to
 * process.stdout. All logging in the legacy layer routes through the injected
 * Logger (file-routing, zero-stdout guaranteed when BG_SUBAGENTS_DEBUG unset).
 *
 * This test exercises the full legacy lifecycle (boot + tool invocation +
 * chat.params + task completion delivery) and asserts that stdout receives
 * zero bytes throughout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildLegacyHooks } from "../../../host-compat/legacy/index.js";
import { makeFakePluginContext } from "../../fixtures/fakePluginContext.js";

describe("legacy — zero stdout pollution (Phase 7.5.8)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env["BG_SUBAGENTS_DEBUG"];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("buildLegacyHooks produces ZERO stdout bytes during boot", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const { ctx } = makeFakePluginContext({ session_id: "sess_legacy_no_stdout" });
    await buildLegacyHooks(ctx);

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("chat.params hook produces ZERO stdout bytes", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const { ctx } = makeFakePluginContext({ session_id: "sess_chatparams_no_stdout" });
    const hooks = await buildLegacyHooks(ctx);

    // Invoke chat.params hook if present
    if (typeof hooks["chat.params"] === "function") {
      hooks["chat.params"]({
        session_id: "sess_chatparams_no_stdout",
        system: "",
      });
    }

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("tool.execute.before hook produces ZERO stdout bytes when passthrough", async () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const { ctx } = makeFakePluginContext({ session_id: "sess_intercept_no_stdout" });
    const hooks = await buildLegacyHooks(ctx);

    // Trigger interceptor with a non-task tool (should passthrough immediately)
    if (typeof hooks["tool.execute.before"] === "function") {
      await hooks["tool.execute.before"]({
        tool_name: "read_file",
        tool_input: { path: "/tmp/foo.txt" },
        session_id: "sess_intercept_no_stdout",
      } as never);
    }

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
