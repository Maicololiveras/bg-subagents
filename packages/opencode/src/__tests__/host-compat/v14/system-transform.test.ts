/**
 * v14 system-transform hook — unit tests.
 *
 * Verifies the `experimental.chat.system.transform` handler that appends a
 * `task_bg` advertisement to the `output.system: string[]` array when the
 * tool has been registered for the current session.
 *
 * v14 hooks mutate the `output` argument in place (no return value). The
 * legacy `chat.params` steer did the equivalent by returning `{ system }`;
 * this is the v14 shape for the same intent.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/host-compat/spec.md
 */

import { describe, expect, it, vi } from "vitest";

import {
  SYSTEM_ADDENDUM,
  buildSystemTransform,
} from "../../../host-compat/v14/system-transform.js";

function makeInput(
  sessionID: string | "__missing__" = "sess_v14_1",
): { sessionID?: string; model: { providerID: string; modelID: string } } {
  const base = {
    model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
  };
  if (sessionID === "__missing__") return base;
  return { ...base, sessionID };
}

describe("buildSystemTransform — task_bg advertised", () => {
  it("pushes SYSTEM_ADDENDUM to output.system when task_bg is registered", async () => {
    const isTaskBgRegistered = vi.fn(() => true);
    const transform = buildSystemTransform({ isTaskBgRegistered });

    const output: { system: string[] } = { system: ["pre-existing prompt"] };
    await transform(makeInput(), output);

    expect(isTaskBgRegistered).toHaveBeenCalledWith("sess_v14_1");
    expect(output.system).toHaveLength(2);
    expect(output.system[0]).toBe("pre-existing prompt");
    expect(output.system[1]).toBe(SYSTEM_ADDENDUM);
  });

  it("pushes even when output.system starts empty", async () => {
    const transform = buildSystemTransform({
      isTaskBgRegistered: () => true,
    });

    const output: { system: string[] } = { system: [] };
    await transform(makeInput(), output);

    expect(output.system).toEqual([SYSTEM_ADDENDUM]);
  });

  it("mutates output in place, does not reassign", async () => {
    const transform = buildSystemTransform({
      isTaskBgRegistered: () => true,
    });

    const system: string[] = [];
    const output = { system };
    await transform(makeInput(), output);

    // Same reference — v14 hooks MUST mutate, not reassign.
    expect(output.system).toBe(system);
    expect(system).toEqual([SYSTEM_ADDENDUM]);
  });
});

describe("buildSystemTransform — gated on registration", () => {
  it("does NOT modify output.system when task_bg is not registered", async () => {
    const isTaskBgRegistered = vi.fn(() => false);
    const transform = buildSystemTransform({ isTaskBgRegistered });

    const output: { system: string[] } = { system: ["only original"] };
    await transform(makeInput(), output);

    expect(isTaskBgRegistered).toHaveBeenCalledWith("sess_v14_1");
    expect(output.system).toEqual(["only original"]);
  });
});

describe("buildSystemTransform — sessionID handling", () => {
  it("treats missing sessionID as 'session_unknown' (same sentinel as buildV14Hooks)", async () => {
    const isTaskBgRegistered = vi.fn(() => true);
    const transform = buildSystemTransform({ isTaskBgRegistered });

    const output: { system: string[] } = { system: [] };
    await transform(makeInput("__missing__"), output);

    expect(isTaskBgRegistered).toHaveBeenCalledWith("session_unknown");
  });
});

describe("buildSystemTransform — SYSTEM_ADDENDUM content", () => {
  it("mentions task_bg and describes async completion semantics", () => {
    expect(SYSTEM_ADDENDUM).toContain("task_bg");
    expect(SYSTEM_ADDENDUM.toLowerCase()).toContain("background");
  });
});
