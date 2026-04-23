/**
 * chat-message-fallback tests — covers ack-suppression + timer-driven fallback
 * delivery. Uses real timers with a very short ackTimeoutMs for determinism
 * (no vi.useFakeTimers to avoid racing the TaskRegistry's internal microtasks).
 */
import { describe, expect, it, vi } from "vitest";

import { HistoryStore, TaskRegistry } from "@maicolextic/bg-subagents-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chatMessageFallback } from "../../hooks/chat-message-fallback.js";
import type { SessionApi } from "../../types.js";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "bgso-fallback-"));
}

function mkRegistry(): { registry: TaskRegistry } {
  const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
  const registry = new TaskRegistry({ history });
  return { registry };
}

function mkSession(
  writes: Array<{ session_id: string; content: string }>,
): SessionApi {
  return {
    writeAssistantMessage(opts) {
      writes.push({ session_id: opts.session_id, content: opts.content });
    },
  };
}

async function settleAfter(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("chatMessageFallback", () => {
  it("injects a synthetic message when no ack arrives within the timeout", async () => {
    const { registry } = mkRegistry();
    const writes: Array<{ session_id: string; content: string }> = [];
    const fb = chatMessageFallback({
      registry,
      session: mkSession(writes),
      sessionId: "sess_t",
      ackTimeoutMs: 20,
    });

    const handle = registry.spawn({ run: async () => "done" });
    await handle.done;
    await settleAfter(50);

    expect(writes.length).toBe(1);
    expect(writes[0]!.content).toContain(handle.id);
    expect(writes[0]!.content).toContain("completed");
    expect(fb.fallbackCount()).toBe(1);
    fb.unsubscribe();
  });

  it("suppresses fallback when markDelivered is called before ack-timeout", async () => {
    const { registry } = mkRegistry();
    const writes: Array<{ session_id: string; content: string }> = [];
    const fb = chatMessageFallback({
      registry,
      session: mkSession(writes),
      sessionId: "sess_t",
      ackTimeoutMs: 50,
    });

    const handle = registry.spawn({ run: async () => "done" });
    await handle.done;
    // Ack immediately — before the 50ms timer fires.
    fb.markDelivered(handle.id);
    await settleAfter(80);

    expect(writes.length).toBe(0);
    expect(fb.fallbackCount()).toBe(0);
    expect(fb.pendingCount()).toBe(0);
    fb.unsubscribe();
  });

  it("does not double-deliver when both primary emit AND timer would fire", async () => {
    const { registry } = mkRegistry();
    const writes: Array<{ session_id: string; content: string }> = [];
    const fb = chatMessageFallback({
      registry,
      session: mkSession(writes),
      sessionId: "sess_t",
      ackTimeoutMs: 30,
    });

    const h1 = registry.spawn({ run: async () => "a" });
    const h2 = registry.spawn({ run: async () => "b" });
    await Promise.all([h1.done, h2.done]);
    // Ack h1 immediately, let h2 fall through.
    fb.markDelivered(h1.id);
    await settleAfter(80);

    expect(fb.fallbackCount()).toBe(1);
    expect(writes.length).toBe(1);
    expect(writes[0]!.content).toContain(h2.id);
    fb.unsubscribe();
  });

  it("logs a warning when no session.writeAssistantMessage exists", async () => {
    const { registry } = mkRegistry();
    const warnings: Array<{ msg: string }> = [];
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (msg: string) => warnings.push({ msg }),
      error: () => undefined,
      child: () => ({} as never),
      flush: async () => undefined,
    };
    const fb = chatMessageFallback({
      registry,
      session: undefined,
      sessionId: "sess_t",
      ackTimeoutMs: 20,
      logger: logger as never,
    });

    const handle = registry.spawn({ run: async () => "done" });
    await handle.done;
    await settleAfter(50);

    expect(warnings.some((w) => w.msg.includes("no-session-writer"))).toBe(true);
    fb.unsubscribe();
  });

  it("unsubscribe() clears pending timers and stops further deliveries", async () => {
    const { registry } = mkRegistry();
    const writes: Array<{ session_id: string; content: string }> = [];
    const fb = chatMessageFallback({
      registry,
      session: mkSession(writes),
      sessionId: "sess_t",
      ackTimeoutMs: 40,
    });

    const handle = registry.spawn({ run: async () => "done" });
    await handle.done;
    fb.unsubscribe();
    await settleAfter(80);

    expect(writes.length).toBe(0);
    expect(fb.pendingCount()).toBe(0);
    void handle; // silence unused-lint in strict mode
  });

  it("handles async writeAssistantMessage rejections without throwing", async () => {
    const { registry } = mkRegistry();
    const session: SessionApi = {
      async writeAssistantMessage() {
        throw new Error("write failed");
      },
    };
    const fb = chatMessageFallback({
      registry,
      session,
      sessionId: "sess_t",
      ackTimeoutMs: 20,
    });
    const handle = registry.spawn({ run: async () => "done" });
    await handle.done;
    await settleAfter(50);
    // No throw bubbled through.
    expect(fb.fallbackCount()).toBe(1);
    fb.unsubscribe();
    // vi keeps track, just silence:
    void vi;
  });
});
