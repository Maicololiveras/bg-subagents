/**
 * RED gate for /task policy slash command — Phase 8.7
 *
 * Spec ref: tasks.md 8.7 — "Slash command /task policy test"
 *
 * The /task policy <mode> command is intercepted by the server-side message
 * interceptor. It sets a session-scoped override in a registry/store (keyed
 * by sessionID). PolicyResolver.resolveBatch honors that override on the NEXT
 * messages.transform invocation for the same session.
 *
 * Scenarios:
 *   - valid mode "bg" accepted → session override set, confirmation injected
 *   - valid mode "fg" accepted → session override set
 *   - valid mode "default" accepted → override cleared
 *   - invalid mode "bad" rejected with error message, no override set
 *   - stateful: after setting "bg", subsequent calls to getSessionOverride return "bg"
 *   - after setting "default", getSessionOverride returns undefined (cleared)
 *   - override is session-scoped: different session IDs are independent
 *
 * The interceptor must:
 *   - detect "/task policy <mode>" in the message text
 *   - store the override in a session-scoped in-memory Map<sessionID, SessionOverride>
 *   - return { handled: true, reply: <confirmation text> } on success
 *   - return { handled: false } for non-matching messages
 *   - return { handled: true, reply: <error text> } on invalid mode
 */

import { describe, expect, it } from "vitest";

import {
  createTaskPolicyStore,
  interceptTaskPolicyCommand,
  type TaskPolicyStore,
} from "../../host-compat/v14/slash-commands.js";

// ---------------------------------------------------------------------------
// Tests — TaskPolicyStore
// ---------------------------------------------------------------------------

describe("TaskPolicyStore — session-scoped state", () => {
  it("getSessionOverride returns undefined initially", () => {
    const store = createTaskPolicyStore();
    expect(store.getSessionOverride("sess_1")).toBeUndefined();
  });

  it("setSessionOverride 'bg' stores the override", () => {
    const store = createTaskPolicyStore();
    store.setSessionOverride("sess_1", "bg");
    expect(store.getSessionOverride("sess_1")).toBe("bg");
  });

  it("setSessionOverride 'fg' stores the override", () => {
    const store = createTaskPolicyStore();
    store.setSessionOverride("sess_1", "fg");
    expect(store.getSessionOverride("sess_1")).toBe("fg");
  });

  it("setSessionOverride 'default' clears the override", () => {
    const store = createTaskPolicyStore();
    store.setSessionOverride("sess_1", "bg");
    store.setSessionOverride("sess_1", "default");
    expect(store.getSessionOverride("sess_1")).toBeUndefined();
  });

  it("different session IDs are independent", () => {
    const store = createTaskPolicyStore();
    store.setSessionOverride("sess_A", "bg");
    store.setSessionOverride("sess_B", "fg");
    expect(store.getSessionOverride("sess_A")).toBe("bg");
    expect(store.getSessionOverride("sess_B")).toBe("fg");
  });

  it("clearing one session does not affect another", () => {
    const store = createTaskPolicyStore();
    store.setSessionOverride("sess_A", "bg");
    store.setSessionOverride("sess_B", "fg");
    store.setSessionOverride("sess_A", "default");
    expect(store.getSessionOverride("sess_A")).toBeUndefined();
    expect(store.getSessionOverride("sess_B")).toBe("fg");
  });
});

// ---------------------------------------------------------------------------
// Tests — interceptTaskPolicyCommand
// ---------------------------------------------------------------------------

describe("interceptTaskPolicyCommand — non-matching messages", () => {
  it("returns handled: false for a regular chat message", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("hello world", "sess_1", store);
    expect(result.handled).toBe(false);
  });

  it("returns handled: false for /task list (different command)", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("/task list", "sess_1", store);
    expect(result.handled).toBe(false);
  });

  it("returns handled: false for empty string", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("", "sess_1", store);
    expect(result.handled).toBe(false);
  });
});

describe("interceptTaskPolicyCommand — valid mode 'bg'", () => {
  it("sets session override to 'bg' and returns handled: true", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("/task policy bg", "sess_1", store);
    expect(result.handled).toBe(true);
    expect(store.getSessionOverride("sess_1")).toBe("bg");
  });

  it("includes a confirmation message in reply", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("/task policy bg", "sess_1", store);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(typeof result.reply).toBe("string");
      expect(result.reply.length).toBeGreaterThan(0);
    }
  });
});

describe("interceptTaskPolicyCommand — valid mode 'fg'", () => {
  it("sets session override to 'fg' and returns handled: true", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("/task policy fg", "sess_1", store);
    expect(result.handled).toBe(true);
    expect(store.getSessionOverride("sess_1")).toBe("fg");
  });
});

describe("interceptTaskPolicyCommand — valid mode 'default'", () => {
  it("clears session override and returns handled: true", () => {
    const store = createTaskPolicyStore();
    store.setSessionOverride("sess_1", "bg");
    const result = interceptTaskPolicyCommand("/task policy default", "sess_1", store);
    expect(result.handled).toBe(true);
    expect(store.getSessionOverride("sess_1")).toBeUndefined();
  });

  it("reply indicates override cleared", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("/task policy default", "sess_1", store);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(typeof result.reply).toBe("string");
      expect(result.reply.length).toBeGreaterThan(0);
    }
  });
});

describe("interceptTaskPolicyCommand — invalid mode", () => {
  it("returns handled: true with error message for invalid mode 'bad'", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("/task policy bad", "sess_1", store);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(typeof result.reply).toBe("string");
      expect(result.reply.toLowerCase()).toContain("invalid");
    }
  });

  it("does NOT set session override for invalid mode", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("/task policy bad", "sess_1", store);
    expect(result.handled).toBe(true);
    // Override must NOT be set
    expect(store.getSessionOverride("sess_1")).toBeUndefined();
  });

  it("returns handled: true with error for mode 'skip' (removed in v1.0)", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("/task policy skip", "sess_1", store);
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.reply.toLowerCase()).toContain("invalid");
    }
    expect(store.getSessionOverride("sess_1")).toBeUndefined();
  });
});

describe("interceptTaskPolicyCommand — stateful behavior", () => {
  it("override set by 'bg' is honored by getSessionOverride on next call", () => {
    const store = createTaskPolicyStore();
    interceptTaskPolicyCommand("/task policy bg", "sess_stateful", store);
    expect(store.getSessionOverride("sess_stateful")).toBe("bg");
    // Simulate 'next turn' — just confirm it persists
    expect(store.getSessionOverride("sess_stateful")).toBe("bg");
  });

  it("/task policy default after /task policy fg reverts to undefined", () => {
    const store = createTaskPolicyStore();
    interceptTaskPolicyCommand("/task policy fg", "sess_revert", store);
    expect(store.getSessionOverride("sess_revert")).toBe("fg");
    interceptTaskPolicyCommand("/task policy default", "sess_revert", store);
    expect(store.getSessionOverride("sess_revert")).toBeUndefined();
  });

  it("successive commands override each other", () => {
    const store = createTaskPolicyStore();
    interceptTaskPolicyCommand("/task policy bg", "sess_x", store);
    interceptTaskPolicyCommand("/task policy fg", "sess_x", store);
    expect(store.getSessionOverride("sess_x")).toBe("fg");
  });
});

describe("interceptTaskPolicyCommand — whitespace handling", () => {
  it("trims leading/trailing whitespace before matching", () => {
    const store = createTaskPolicyStore();
    const result = interceptTaskPolicyCommand("  /task policy bg  ", "sess_ws", store);
    expect(result.handled).toBe(true);
    expect(store.getSessionOverride("sess_ws")).toBe("bg");
  });
});
