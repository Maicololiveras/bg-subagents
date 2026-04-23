/**
 * chat-params steer tests.
 */
import { describe, expect, it } from "vitest";

import { SYSTEM_ADDENDUM, steerChatParams } from "../../../host-compat/legacy/chat-params.js";

describe("steerChatParams", () => {
  it("returns {} when task_bg is not registered for the session", () => {
    const fn = steerChatParams({
      isTaskBgRegistered: () => false,
    });
    const out = fn({ session_id: "sess_a" });
    expect(out).toEqual({});
  });

  it("injects the system addendum when task_bg IS registered", () => {
    const fn = steerChatParams({
      isTaskBgRegistered: () => true,
    });
    const out = fn({ session_id: "sess_b" });
    expect(out.system).toBe(SYSTEM_ADDENDUM);
  });

  it("appends the addendum to an existing system prompt", () => {
    const fn = steerChatParams({
      isTaskBgRegistered: () => true,
    });
    const out = fn({
      session_id: "sess_c",
      system: "You are a helpful assistant.",
    });
    expect(out.system).toContain("You are a helpful assistant.");
    expect(out.system).toContain("task_bg");
    expect(out.system!.indexOf("task_bg")).toBeGreaterThan(
      out.system!.indexOf("helpful"),
    );
  });

  it("addendum contains the task_bg name and the 1-minute heuristic guidance", () => {
    expect(SYSTEM_ADDENDUM).toContain("task_bg");
    expect(SYSTEM_ADDENDUM).toContain("1 minute");
  });
});
