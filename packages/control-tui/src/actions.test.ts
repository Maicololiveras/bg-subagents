import { describe, expect, it, vi } from "vitest";

import { deliverBgResult, moveTaskToBg, projectedActionEnabled } from "./actions.js";
import type { ActionContext } from "./actions.js";
import type { ActiveTask, TaskRegistry } from "./events.js";

function task(overrides: Partial<ActiveTask> = {}): ActiveTask {
  return {
    childSessionID: "child-1",
    parentSessionID: "parent-1",
    agent: "sdd-apply",
    started: 1,
    status: "running",
    description: "focused fix",
    ...overrides,
  };
}

function registryMock(overrides: Partial<TaskRegistry> = {}): TaskRegistry {
  return {
    tasks: vi.fn(() => []),
    setTasks: vi.fn(),
    getTask: vi.fn(),
    getTaskByOriginalChild: vi.fn(),
    getTaskByReplacementChild: vi.fn(),
    upsertTask: vi.fn(),
    markStatus: vi.fn(),
    removeTask: vi.fn(),
    ...overrides,
  } as unknown as TaskRegistry;
}

function context(resultText: string, registry: TaskRegistry = registryMock()): { ctx: ActionContext; prompt: ReturnType<typeof vi.fn> } {
  const prompt = vi.fn(async () => undefined);
  return {
    prompt,
    ctx: {
      registry,
      api: {
        client: {
          session: {
            messages: vi.fn(async () => ({
              data: [
                {
                  info: { role: "assistant" },
                  parts: [{ type: "text", text: resultText }],
                },
              ],
            })),
            prompt,
          },
        },
        ui: { toast: vi.fn() },
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
  };
}

describe("deliverBgResult", () => {
  it("posts a compact noReply instead of the full raw child result", async () => {
    const raw = Array.from({ length: 180 }, (_, i) => `raw transcript line ${i} ${"x".repeat(50)}`).join("\n");
    const { ctx, prompt } = context(raw);

    await deliverBgResult(ctx, task());

    const payload = prompt.mock.calls[0]![0] as { noReply: boolean; parts: Array<{ text: string }> };
    const delivered = payload.parts[0]!.text;
    expect(payload.noReply).toBe(true);
    expect(delivered.length).toBeLessThan(1_800);
    expect(delivered).toContain("Qué encontró");
    expect(delivered).toContain("child session/logs: child-1");
    expect(delivered).not.toContain("raw transcript line 179");
  });

  it("deduplicates already-delivered completion delivery", async () => {
    const markStatus = vi.fn();
    const registry = registryMock({
      getTask: vi.fn((_childSessionID: string): ActiveTask => task({ status: "done", delivered: true })),
      markStatus,
    });
    const { ctx, prompt } = context("status: success\nexecutive_summary: already delivered", registry);

    await deliverBgResult(ctx, task({ status: "done", delivered: true }));

    expect(prompt).not.toHaveBeenCalled();
    expect(markStatus).not.toHaveBeenCalled();
  });

  it("claims delivery before awaiting messages so duplicate idle events do not double-post", async () => {
    let current = task({ mode: "BG" });
    let releaseMessages!: () => void;
    const messagesGate = new Promise<void>((resolve) => {
      releaseMessages = resolve;
    });
    const prompt = vi.fn(async () => undefined);
    const markStatus = vi.fn((childSessionID: string, status: ActiveTask["status"], extra?: Partial<ActiveTask>) => {
      if (childSessionID === current.childSessionID) {
        current = { ...current, status, ...extra };
      }
    });
    const registry = registryMock({
      getTask: vi.fn((_childSessionID: string): ActiveTask => current),
      markStatus,
    });
    const { ctx } = context("status: success\nexecutive_summary: once", registry);
    ctx.api.client.session.messages = vi.fn(async () => {
      await messagesGate;
      return {
        data: [
          {
            info: { role: "assistant" },
            parts: [{ type: "text", text: "status: success\nexecutive_summary: once" }],
          },
        ],
      };
    });
    ctx.api.client.session.prompt = prompt;

    const first = deliverBgResult(ctx, current);
    const second = deliverBgResult(ctx, current);
    releaseMessages();
    await Promise.all([first, second]);

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(markStatus).toHaveBeenCalledWith("child-1", "running", expect.objectContaining({
      delivered: true,
      latestEvent: "delivery claimed",
    }));
  });

  it("rolls back a delivery claim when parent prompt fails so later idle can retry", async () => {
    let current = task({ mode: "BG" });
    const prompt = vi
      .fn()
      .mockRejectedValueOnce(new Error("parent unavailable"))
      .mockResolvedValueOnce(undefined);
    const markStatus = vi.fn((childSessionID: string, status: ActiveTask["status"], extra?: Partial<ActiveTask>) => {
      if (childSessionID === current.childSessionID) {
        current = { ...current, status, ...extra };
      }
    });
    const registry = registryMock({
      getTask: vi.fn((_childSessionID: string): ActiveTask => current),
      markStatus,
    });
    const { ctx } = context("status: success\nexecutive_summary: retry", registry);
    ctx.api.client.session.prompt = prompt;

    await deliverBgResult(ctx, current);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(current.delivered).toBe(false);
    expect(current.status).toBe("running");

    await deliverBgResult(ctx, current);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(current.delivered).toBe(true);
    expect(current.status).toBe("done");
  });

  it("delivers against the replacement child when the original was moved to BG", async () => {
    const markStatus = vi.fn();
    const replacement = task({
      childSessionID: "child-bg-2",
      status: "running",
      mode: "BG",
      detailRef: "child session/logs: child-bg-2",
    });
    const original = task({
      childSessionID: "child-fg-1",
      status: "bg-detached",
      mode: "BG",
      newChildSessionID: "child-bg-2",
    });
    const registry = registryMock({
      getTask: vi.fn((id: string) => id === "child-bg-2" ? replacement : original),
      markStatus,
    });
    const { ctx, prompt } = context("status: success\nexecutive_summary: replacement done", registry);

    await deliverBgResult(ctx, original);

    expect(prompt.mock.calls[0]?.[0]).toMatchObject({ sessionID: "parent-1", noReply: true });
    expect(ctx.api.client.session.messages).toHaveBeenCalledWith({ sessionID: "child-bg-2" });
    expect(markStatus).toHaveBeenCalledWith("child-bg-2", "done", expect.objectContaining({
      delivered: true,
      detailRef: "child session/logs: child-bg-2",
    }));
  });
});

describe("moveTaskToBg", () => {
  it("honestly marks the original as detached and preserves detail refs for both task records", async () => {
    const markStatus = vi.fn();
    const upsertTask = vi.fn();
    const registry = registryMock({ markStatus, upsertTask });
    const ctx: ActionContext = {
      registry,
      api: {
        client: {
          session: {
            messages: vi.fn(async () => ({
              data: [
                {
                  info: { role: "user" },
                  parts: [{ type: "text", text: "keep working" }],
                },
              ],
            })),
            abort: vi.fn(async () => undefined),
            create: vi.fn(async () => ({ data: { id: "child-bg-2" } })),
            promptAsync: vi.fn(async () => undefined),
          },
        },
        ui: { toast: vi.fn() },
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const result = await moveTaskToBg(ctx, task({ childSessionID: "child-fg-1", prompt: undefined, started: Date.now() }));

    expect(result).toEqual({ ok: true, newChildID: "child-bg-2" });
    expect(markStatus).toHaveBeenCalledWith("child-fg-1", "cancelled", expect.objectContaining({
      latestEvent: "aborted before BG respawn",
    }));
    expect(markStatus).toHaveBeenCalledWith("child-fg-1", "bg-detached", expect.objectContaining({
      mode: "BG",
      newChildSessionID: "child-bg-2",
      detailRef: "child session/logs: child-bg-2",
    }));
    expect(upsertTask).toHaveBeenCalledWith(expect.objectContaining({
      childSessionID: "child-bg-2",
      mode: "BG",
      status: "running",
      latestEvent: "BG prompt dispatched",
      detailRef: "child session/logs: child-bg-2",
      prompt: "keep working",
    }));
  });

  it("derives menu action availability from projected action policy", () => {
    expect(projectedActionEnabled(task({ mode: "FG", status: "running", started: Date.now() }), "move-to-BG")).toBe(true);
    expect(projectedActionEnabled(task({ mode: "BG", status: "running" }), "move-to-BG")).toBe(false);
    expect(projectedActionEnabled(task({ mode: "FG", status: "done" }), "kill")).toBe(false);
  });

  it("denies move-to-BG for stale warning rows", async () => {
    const abort = vi.fn();
    const registry = registryMock();
    const ctx: ActionContext = {
      registry,
      api: {
        client: { session: { messages: vi.fn(), abort, create: vi.fn(), promptAsync: vi.fn() } },
        ui: { toast: vi.fn() },
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const result = await moveTaskToBg(ctx, task({ mode: "FG", status: "running", updatedAt: 1 }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Projection policy denied");
    expect(abort).not.toHaveBeenCalled();
  });
});
