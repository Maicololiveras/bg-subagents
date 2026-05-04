/**
 * Integration test: v14 Completion Delivery E2E — Phase 14.3
 *
 * Exercises the full delivery path end-to-end:
 *   TaskRegistry.spawn → task runs → onComplete fires → createV14Delivery delivers
 *
 * Scenarios:
 *   - BG task completes → client.session.prompt called once with correct v1 SDK shape
 *   - registry.markDelivered prevents double-delivery (idempotency)
 *   - Primary failure path → task remains un-delivered (fallback can retry)
 *   - delivery:primary-* logs go through the injected logger (no stdout)
 *   - Zero stdout during full primary+fallback cycle
 *
 * Note: The v1 SDK shape for session.prompt is:
 *   client.session.prompt({ path: { id: sessionID }, body: { noReply: true, parts: [...] } })
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md 14.3
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/delivery/spec.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskRegistry } from "@maicolextic/bg-subagents-core";
import type { CompletionEvent } from "@maicolextic/bg-subagents-core";
import { createV14Delivery } from "../../host-compat/v14/delivery.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(opts: { fail?: boolean } = {}) {
  const calls: Array<{
    path: { id: string };
    body: { noReply: boolean; parts: Array<{ type: string; text: string }> };
  }> = [];

  const prompt = vi.fn(
    async (args: {
      path: { id: string };
      body: { noReply: boolean; parts: Array<{ type: string; text: string }> };
    }) => {
      calls.push(args);
      if (opts.fail) throw new Error("primary-delivery-failed");
      return { data: { info: { id: "msg_e2e", role: "user" } } };
    },
  );

  return {
    client: { session: { prompt } },
    calls,
    prompt,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
}

function makeCompletionEvent(taskId: string, status: "completed" | "error" = "completed"): CompletionEvent {
  return {
    task_id: taskId as CompletionEvent["task_id"],
    status,
    result: "ok",
    ts: Date.now(),
  } as CompletionEvent;
}

// ---------------------------------------------------------------------------
// 14.3.A — Spawn BG task, complete it, assert primary delivery
// ---------------------------------------------------------------------------

describe("v14 Delivery E2E — spawn BG task → primary delivery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("client.session.prompt called exactly once with v1 SDK shape after task completes", async () => {
    const registry = new TaskRegistry();
    const { client, calls } = makeClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_e2e_primary",
    });

    // Spawn a task
    const handle = registry.spawn({
      meta: { tool: "task_bg", subagent_type: "sdd-explore", session_id: "sess_e2e_primary" },
      run: async () => "ok",
    });
    await handle.done;

    await coord.onComplete(makeCompletionEvent(handle.id));

    // Exactly 1 call
    expect(calls).toHaveLength(1);

    // v1 SDK shape: { path: { id }, body: { noReply: true, parts: [...] } }
    const payload = calls[0]!;
    expect(payload.path).toEqual({ id: "sess_e2e_primary" });
    expect(payload.body.noReply).toBe(true);
    expect(payload.body.parts).toHaveLength(1);
    expect(payload.body.parts[0]!.type).toBe("text");
    expect(payload.body.parts[0]!.text).toContain(handle.id);
    expect(payload.body.parts[0]!.text.toLowerCase()).toContain("completed");
  });

  it("uses task meta session_id (not opts.sessionID) when task has real session context", async () => {
    const registry = new TaskRegistry();
    const { client, calls } = makeClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "session_unknown", // boot placeholder
    });

    const handle = registry.spawn({
      meta: {
        tool: "task_bg",
        subagent_type: "sdd-apply",
        session_id: "ses_REAL_SESSION_ID", // authoritative
      },
      run: async () => "ok",
    });
    await handle.done;

    await coord.onComplete(makeCompletionEvent(handle.id));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.path.id).toBe("ses_REAL_SESSION_ID");
    expect(calls[0]!.path.id).not.toBe("session_unknown");
  });

  it("after primary succeeds, registry.markDelivered returns false (already marked)", async () => {
    const registry = new TaskRegistry();
    const { client } = makeClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_e2e_dedupe",
    });

    const handle = registry.spawn({
      meta: { tool: "task_bg" },
      run: async () => "ok",
    });
    await handle.done;

    await coord.onComplete(makeCompletionEvent(handle.id));

    // Primary already marked it — second markDelivered returns false
    expect(registry.markDelivered(handle.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 14.3.B — Double-delivery prevention (registry.markDelivered)
// ---------------------------------------------------------------------------

describe("v14 Delivery E2E — registry.markDelivered prevents double-delivery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calling onComplete twice for the same task fires client.session.prompt only once", async () => {
    const registry = new TaskRegistry();
    const { client, calls } = makeClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_double",
    });

    await coord.onComplete(makeCompletionEvent("tsk_double_del"));
    await coord.onComplete(makeCompletionEvent("tsk_double_del"));

    expect(calls).toHaveLength(1);
  });

  it("pre-marking via registry.markDelivered skips primary entirely", async () => {
    const registry = new TaskRegistry();
    const { client, calls } = makeClient();

    // Pre-mark before coordinator even exists
    registry.markDelivered("tsk_pre_marked" as Parameters<typeof registry.markDelivered>[0]);

    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_pre_marked",
    });

    await coord.onComplete(makeCompletionEvent("tsk_pre_marked"));

    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 14.3.C — Primary failure path
// ---------------------------------------------------------------------------

describe("v14 Delivery E2E — primary failure: task stays un-delivered", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("when client.session.prompt throws, task is NOT marked delivered (fallback can retry)", async () => {
    const registry = new TaskRegistry();
    const { client } = makeClient({ fail: true });
    const logger = makeLogger();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_fail_e2e",
      logger: logger as never,
    });

    await coord.onComplete(makeCompletionEvent("tsk_e2e_fail"));

    // Not delivered → markDelivered returns true (first time)
    expect(registry.markDelivered("tsk_e2e_fail" as Parameters<typeof registry.markDelivered>[0])).toBe(true);
  });

  it("primary failure logs delivery:primary-failed warn", async () => {
    const registry = new TaskRegistry();
    const { client } = makeClient({ fail: true });
    const logger = makeLogger();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_warn_e2e",
      logger: logger as never,
    });

    await coord.onComplete(makeCompletionEvent("tsk_warn"));

    expect(logger.warn).toHaveBeenCalledWith(
      "delivery:primary-failed",
      expect.objectContaining({
        task_id: "tsk_warn",
        error: expect.stringContaining("primary-delivery-failed"),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 14.3.D — delivery:primary-* logs go through createLogger (no stdout)
// ---------------------------------------------------------------------------

describe("v14 Delivery E2E — zero stdout (delivery:primary-* via logger only)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ZERO stdout bytes during a successful primary delivery cycle", async () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const registry = new TaskRegistry();
    const { client } = makeClient();
    const logger = makeLogger();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_zero_stdout_ok",
      logger: logger as never,
    });

    const handle = registry.spawn({
      meta: { tool: "task_bg" },
      run: async () => "ok",
    });
    await handle.done;

    await coord.onComplete(makeCompletionEvent(handle.id));

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("ZERO stdout bytes during a primary failure cycle", async () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const registry = new TaskRegistry();
    const { client } = makeClient({ fail: true });
    const logger = makeLogger();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_zero_stdout_fail",
      logger: logger as never,
    });

    await coord.onComplete(makeCompletionEvent("tsk_nopoll_fail"));

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("logger receives delivery:primary-delivered info (not stdout) on success", async () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const registry = new TaskRegistry();
    const { client } = makeClient();
    const logger = makeLogger();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_log_check",
      logger: logger as never,
    });

    await coord.onComplete(makeCompletionEvent("tsk_log_check"));

    // Logged to the injected logger, not stdout
    const deliveredCall = logger.info.mock.calls.find(([msg]: [string]) =>
      typeof msg === "string" && msg.includes("delivery:primary-delivered"),
    );
    expect(deliveredCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 14.3.E — dispose() cleans up
// ---------------------------------------------------------------------------

describe("v14 Delivery E2E — dispose()", () => {
  it("dispose() does not throw", () => {
    const registry = new TaskRegistry();
    const { client } = makeClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_dispose",
    });

    expect(() => coord.dispose()).not.toThrow();
  });
});
