/**
 * Plugin shape + wiring tests.
 */
import { describe, expect, it } from "vitest";

import { buildServer } from "../plugin.js";
import pluginDefault from "../plugin.js";
import type { Bus, PluginServerContext } from "../types.js";

function mkCtx(overrides: Partial<PluginServerContext> = {}): PluginServerContext {
  return {
    session_id: "sess_test_1",
    ...overrides,
  };
}

describe("PluginModule — default export", () => {
  it("exposes a `server` function", () => {
    expect(pluginDefault).toBeDefined();
    expect(typeof pluginDefault.server).toBe("function");
  });

  it("server() returns a Hooks object", async () => {
    const hooks = await pluginDefault.server(mkCtx());
    expect(hooks).toBeDefined();
    expect(typeof hooks).toBe("object");
  });

  it("Hooks.tool includes exactly task_bg", async () => {
    const hooks = await buildServer(mkCtx());
    expect(Array.isArray(hooks.tool)).toBe(true);
    const names = (hooks.tool ?? []).map((t) => t.name);
    expect(names).toEqual(["task_bg"]);
  });

  it("Hooks['tool.execute.before'] is a function", async () => {
    const hooks = await buildServer(mkCtx());
    expect(typeof hooks["tool.execute.before"]).toBe("function");
  });

  it("Hooks['chat.params'] is a function", async () => {
    const hooks = await buildServer(mkCtx());
    expect(typeof hooks["chat.params"]).toBe("function");
  });

  it("chat.params returns empty object when session_id does not match", async () => {
    const hooks = await buildServer(mkCtx({ session_id: "sess_a" }));
    const result = await hooks["chat.params"]!({ session_id: "sess_other" });
    expect(result).toEqual({});
  });

  it("chat.params injects the system addendum for matching session", async () => {
    const hooks = await buildServer(mkCtx({ session_id: "sess_a" }));
    const result = await hooks["chat.params"]!({ session_id: "sess_a" });
    expect(typeof result.system).toBe("string");
    expect(result.system!).toContain("task_bg");
  });

  it("boots without a bus (headless) — should not throw", async () => {
    const hooks = await buildServer(mkCtx({ bus: undefined }));
    expect(hooks.tool).toBeDefined();
  });

  it("boots with a bus — wires completion delivery without throwing", async () => {
    const emitted: Array<{ type: string }> = [];
    const bus: Bus = {
      emit(e): void {
        emitted.push({ type: e.type });
      },
    };
    const hooks = await buildServer(mkCtx({ bus }));
    expect(hooks.tool).toBeDefined();
    // Emitted list is still empty — we haven't spawned anything.
    expect(emitted.length).toBe(0);
  });
});
