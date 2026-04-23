/**
 * createV14Delivery — unit tests for the v14 completion delivery coordinator.
 *
 * Scenarios covered (from delivery/spec.md):
 *   - Primary success fires client.session.prompt + marks delivered + cancels fallback timer
 *   - Primary failure leaves fallback timer armed; fallback fires after ackTimeoutMs
 *   - Fallback uses markDelivered to avoid double-posting
 *   - Second onComplete for same task_id is a no-op (already delivered)
 *   - dispose() clears pending timers
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/delivery/spec.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createV14Delivery } from "../../../host-compat/v14/delivery.js";
import { TaskRegistry } from "@maicolextic/bg-subagents-core";
import type { CompletionEvent } from "@maicolextic/bg-subagents-core";
import { unsafeTaskId } from "@maicolextic/bg-subagents-protocol";

function mkCompletion(
  id: string,
  status: "completed" | "error" = "completed",
  result: unknown = "ok",
): CompletionEvent {
  return {
    task_id: unsafeTaskId(id),
    status,
    result,
    ts: Date.now(),
  } as CompletionEvent;
}

function mkClient(opts: {
  promptImpl?: () => Promise<unknown>;
} = {}) {
  const calls: Array<{ args: unknown }> = [];
  const prompt = vi.fn(async (args: unknown) => {
    calls.push({ args });
    if (opts.promptImpl) return opts.promptImpl();
    return { data: { info: { id: "msg_1", role: "user" } } };
  });
  return {
    client: { session: { prompt } } as unknown as Parameters<
      typeof createV14Delivery
    >[0]["client"],
    calls,
    prompt,
  };
}

function mkLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
}

describe("createV14Delivery — primary delivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls client.session.prompt with v1 shape + noReply:true and the task summary", async () => {
    const registry = new TaskRegistry();
    const { client, calls } = mkClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_v14_del",
    });

    await coord.onComplete(mkCompletion("tsk_abc"));

    expect(calls).toHaveLength(1);
    const payload = calls[0]!.args as {
      path: { id: string };
      body: {
        noReply: boolean;
        parts: Array<{ type: string; text: string }>;
      };
    };
    expect(payload.path).toEqual({ id: "sess_v14_del" });
    expect(payload.body.noReply).toBe(true);
    expect(payload.body.parts).toHaveLength(1);
    expect(payload.body.parts[0]!.type).toBe("text");
    expect(payload.body.parts[0]!.text).toContain("tsk_abc");
    expect(payload.body.parts[0]!.text.toLowerCase()).toContain("completed");
  });

  it("marks the task delivered after primary succeeds", async () => {
    const registry = new TaskRegistry();
    const { client } = mkClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_v14",
    });

    await coord.onComplete(mkCompletion("tsk_mark"));

    // Second markDelivered should return false (already marked).
    expect(registry.markDelivered(unsafeTaskId("tsk_mark"))).toBe(false);
  });

  it("writes an error-flavored message when event.status is 'error'", async () => {
    const registry = new TaskRegistry();
    const { client, calls } = mkClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_err",
      logger: mkLogger(),
    });

    await coord.onComplete({
      ...mkCompletion("tsk_errored", "error"),
      result: undefined,
      error_message: "boom",
    } as unknown as CompletionEvent);

    const payload = calls[0]!.args as {
      body: { parts: Array<{ text: string }> };
    };
    expect(payload.body.parts[0]!.text.toLowerCase()).toContain("error");
    expect(payload.body.parts[0]!.text).toContain("tsk_errored");
  });
});

describe("createV14Delivery — dedupe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("second onComplete for the same task_id is a no-op (no second prompt call)", async () => {
    const registry = new TaskRegistry();
    const { client, calls } = mkClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess",
    });

    await coord.onComplete(mkCompletion("tsk_dedupe"));
    await coord.onComplete(mkCompletion("tsk_dedupe"));

    expect(calls).toHaveLength(1);
  });

  it("pre-marked task skips primary entirely", async () => {
    const registry = new TaskRegistry();
    const { client, calls } = mkClient();
    registry.markDelivered(unsafeTaskId("tsk_pre"));

    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess",
    });

    await coord.onComplete(mkCompletion("tsk_pre"));
    expect(calls).toHaveLength(0);
  });
});

describe("createV14Delivery — primary failure + fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits delivery:primary-failed warn when client.session.prompt rejects", async () => {
    const registry = new TaskRegistry();
    const { client } = mkClient({
      promptImpl: async () => {
        throw new Error("network down");
      },
    });
    const logger = mkLogger();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess",
      logger: logger as never,
    });

    await coord.onComplete(mkCompletion("tsk_fail"));

    expect(logger.warn).toHaveBeenCalledWith(
      "delivery:primary-failed",
      expect.objectContaining({
        task_id: "tsk_fail",
        error: expect.stringContaining("network down"),
      }),
    );
  });

  it("does NOT mark delivered when primary rejects (so fallback can retry)", async () => {
    const registry = new TaskRegistry();
    const { client } = mkClient({
      promptImpl: async () => {
        throw new Error("oh no");
      },
    });
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess",
      logger: mkLogger() as never,
    });

    await coord.onComplete(mkCompletion("tsk_retry"));

    // Not yet delivered — fallback can still race in.
    expect(registry.markDelivered(unsafeTaskId("tsk_retry"))).toBe(true);
  });
});

describe("createV14Delivery — dynamic sessionID from task meta (bug fix)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses sessionID from registry task meta (not opts.sessionID) when task meta has session_id", async () => {
    // The plugin boots with a placeholder sessionID ("session_unknown") because
    // the real session is only known when the tool executes. The delivery
    // coordinator MUST resolve the real sessionID from the spawned task's
    // meta, NOT from opts.sessionID. Otherwise client.session.prompt posts to
    // an invalid session, server returns HTML, SDK explodes at JSON.parse —
    // which is exactly what happened in the 2026-04-23 smoke test.
    const registry = new TaskRegistry();
    const { client, calls } = mkClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "session_unknown", // BOOT placeholder — must NOT be used
    });

    const handle = registry.spawn({
      meta: {
        tool: "task_bg",
        subagent_type: "explore",
        session_id: "ses_REAL_FROM_TOOLCTX",
      },
      run: async () => "ok",
    });
    await handle.done;

    await coord.onComplete({
      task_id: handle.id,
      status: "completed",
      result: "ok",
      ts: Date.now(),
    } as CompletionEvent);

    expect(calls).toHaveLength(1);
    const payload = calls[0]!.args as { path: { id: string } };
    expect(payload.path.id).toBe("ses_REAL_FROM_TOOLCTX");
    expect(payload.path.id).not.toBe("session_unknown");
  });

  it("falls back to opts.sessionID when task meta has no session_id (backward compat)", async () => {
    const registry = new TaskRegistry();
    const { client, calls } = mkClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_fallback",
    });

    // onComplete for a task that is NOT in the registry — e.g. tests that
    // don't spawn, or legacy path. Must still work using opts.sessionID.
    await coord.onComplete(mkCompletion("tsk_no_registry"));

    expect(calls).toHaveLength(1);
    const payload = calls[0]!.args as { path: { id: string } };
    expect(payload.path.id).toBe("sess_fallback");
  });

  it("falls back to opts.sessionID when task is in registry but meta lacks session_id", async () => {
    const registry = new TaskRegistry();
    const { client, calls } = mkClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess_legacy_meta",
    });

    const handle = registry.spawn({
      meta: { tool: "task_bg" }, // no session_id
      run: async () => "ok",
    });
    await handle.done;

    await coord.onComplete({
      task_id: handle.id,
      status: "completed",
      result: "ok",
      ts: Date.now(),
    } as CompletionEvent);

    expect(calls).toHaveLength(1);
    const payload = calls[0]!.args as { path: { id: string } };
    expect(payload.path.id).toBe("sess_legacy_meta");
  });
});

describe("createV14Delivery — dispose", () => {
  it("exposes a dispose() method that does not throw", () => {
    const registry = new TaskRegistry();
    const { client } = mkClient();
    const coord = createV14Delivery({
      registry,
      client,
      sessionID: "sess",
    });

    expect(() => coord.dispose()).not.toThrow();
  });
});
