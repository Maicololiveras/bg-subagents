import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compactTaskSignal,
  createTaskRegistry,
  toActivitySource,
  subscribeToSessionEvents,
} from "./events.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("control-tui task registry UI metadata", () => {
  it("keeps latestEvent compact for task cards", () => {
    const signal = compactTaskSignal(`line 1\n${"x".repeat(120)}`, 32);

    expect(signal).toBe("line 1 xxxxxxxxxxxxxxxxxxxxxxxx…");
  });

  it("updates tracked tasks with compact progress signals", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          return vi.fn();
        }),
      },
    };
    const registry = createTaskRegistry();

    const dispose = subscribeToSessionEvents({ api, registry });

    handlers.get("session.created")?.({
      properties: {
        info: {
          id: "child-session-123456789",
          parentID: "parent-1",
          agent: "sdd-apply",
          title: "Implement clean UI cards",
        },
      },
    });
    handlers.get("message.part.updated")?.({
      properties: {
        sessionID: "child-session-123456789",
        part: { text: `reading files\n${"detail ".repeat(40)}` },
      },
    });

    const [tracked] = registry.tasks();
    expect(tracked?.mode).toBe("FG");
    expect(tracked?.detailRef).toContain("child-session-123456789");
    expect(tracked?.latestEvent).toContain("reading files");
    expect(tracked?.latestEvent?.length).toBeLessThanOrEqual(96);

    dispose();
  });

  it("keeps background task cards live-updating after async dispatch returns", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          return vi.fn();
        }),
      },
    };
    const registry = createTaskRegistry();

    subscribeToSessionEvents({ api, registry });
    registry.upsertTask({
      childSessionID: "bg-child-1",
      parentSessionID: "parent-stays-interactive",
      agent: "sdd-apply",
      started: Date.now(),
      status: "running",
      mode: "BG",
      latestEvent: "running in background",
      detailRef: "child session/logs: bg-child-1",
    });

    handlers.get("message.part.updated")?.({
      properties: {
        sessionID: "bg-child-1",
        part: { text: "continued progress while parent accepts input" },
      },
    });

    const [tracked] = registry.tasks();
    expect(tracked).toMatchObject({
      childSessionID: "bg-child-1",
      parentSessionID: "parent-stays-interactive",
      mode: "BG",
      status: "running",
      latestEvent: "continued progress while parent accepts input",
      detailRef: "child session/logs: bg-child-1",
    });
    expect(tracked?.progressEvents).toContain("continued progress while parent accepts input");
  });

  it("aggregates session.created metadata into an active activity record", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          return vi.fn();
        }),
      },
    };
    const registry = createTaskRegistry();

    subscribeToSessionEvents({ api, registry });

    handlers.get("session.created")?.({
      properties: {
        info: {
          id: "child-created",
          parentID: "parent-created",
          agent: "sdd-apply",
          title: "Apply batch 1",
        },
      },
    });

    expect(registry.tasks()).toMatchObject([
      {
        childSessionID: "child-created",
        parentSessionID: "parent-created",
        agent: "sdd-apply",
        mode: "FG",
        status: "running",
        latestEvent: "session created",
        progressEvents: ["session created"],
        detailRef: "child session/logs: child-created",
      },
    ]);
  });

  it("keeps foreground task detail visible as running until the blocking task reaches idle", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const onChildIdle = vi.fn();
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          return vi.fn();
        }),
      },
    };
    const registry = createTaskRegistry();

    subscribeToSessionEvents({ api, registry, onChildIdle });

    handlers.get("session.created")?.({
      properties: {
        info: {
          id: "child-fg-running",
          parentID: "parent-blocked",
          agent: "sdd-apply",
          title: "Foreground implementation",
        },
      },
    });
    handlers.get("message.part.updated")?.({
      properties: {
        sessionID: "child-fg-running",
        part: { text: "writing focused test" },
      },
    });

    expect(onChildIdle).not.toHaveBeenCalled();
    expect(registry.tasks()).toMatchObject([
      {
        childSessionID: "child-fg-running",
        parentSessionID: "parent-blocked",
        mode: "FG",
        status: "running",
        latestEvent: "writing focused test",
        detailRef: "child session/logs: child-fg-running",
      },
    ]);

    handlers.get("session.idle")?.({ properties: { sessionID: "child-fg-running" } });

    expect(onChildIdle).toHaveBeenCalledWith(expect.objectContaining({
      childSessionID: "child-fg-running",
      status: "running",
      mode: "FG",
    }));
    expect(registry.tasks()[0]).toMatchObject({
      childSessionID: "child-fg-running",
      status: "done",
      summary: "session idle",
    });
  });

  it("projects active task entries into canonical activity sources", () => {
    const source = toActivitySource({
      childSessionID: "child-projected",
      parentSessionID: "parent-projected",
      agent: "sdd-apply",
      started: 10,
      status: "running",
      mode: "FG",
      latestEvent: "writing tests",
      detailRef: "child session/logs: child-projected",
    });

    expect(source).toMatchObject({
      source: "control-active-task",
      taskId: "child-projected",
      mode: "FG",
      status: "running",
      latestSignal: "writing tests",
    });
  });

  it("keeps bounded progressEvents and latestEvent while the activity is running", () => {
    const registry = createTaskRegistry();
    registry.upsertTask({
      childSessionID: "child-progress",
      parentSessionID: "parent-progress",
      agent: "sdd-apply",
      started: Date.now(),
      status: "running",
      progressEvents: ["session created"],
    });

    for (let index = 0; index < 25; index += 1) {
      registry.markStatus("child-progress", "running", { latestEvent: `progress ${index}` });
    }

    const [tracked] = registry.tasks();
    expect(tracked?.latestEvent).toBe("progress 24");
    expect(tracked?.progressEvents).toHaveLength(20);
    expect(tracked?.progressEvents?.[0]).toBe("progress 5");
    expect(tracked?.progressEvents?.at(-1)).toBe("progress 24");
  });

  it("refreshes updatedAt from progress events without changing lifecycle status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const handlers = new Map<string, (event: unknown) => void>();
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          return vi.fn();
        }),
      },
    };
    const registry = createTaskRegistry();

    subscribeToSessionEvents({ api, registry });
    handlers.get("session.created")?.({ properties: { info: { id: "child-refresh", parentID: "parent", agent: "sdd-apply" } } });
    vi.setSystemTime(9_000);
    handlers.get("message.part.updated")?.({ properties: { sessionID: "child-refresh", part: { text: "still alive" } } });

    const [tracked] = registry.tasks();
    expect(tracked).toMatchObject({
      childSessionID: "child-refresh",
      status: "running",
      latestEvent: "still alive",
      updatedAt: 9_000,
    });
  });

  it("records terminal freshness and evidence from idle and error events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const handlers = new Map<string, (event: unknown) => void>();
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          return vi.fn();
        }),
      },
    };
    const registry = createTaskRegistry();

    subscribeToSessionEvents({ api, registry });
    handlers.get("session.created")?.({ properties: { info: { id: "child-idle-fresh", parentID: "parent", agent: "sdd-apply" } } });
    handlers.get("session.created")?.({ properties: { info: { id: "child-error-fresh", parentID: "parent", agent: "sdd-apply" } } });
    vi.setSystemTime(11_000);
    handlers.get("session.idle")?.({ properties: { sessionID: "child-idle-fresh" } });
    vi.setSystemTime(12_000);
    handlers.get("session.error")?.({ properties: { sessionID: "child-error-fresh", error: { message: "boom" } } });

    expect(registry.getTask("child-idle-fresh")).toMatchObject({
      status: "done",
      summary: "session idle",
      endedAt: 11_000,
      updatedAt: 11_000,
    });
    expect(registry.getTask("child-error-fresh")).toMatchObject({
      status: "error",
      summary: "boom",
      errorMessage: "boom",
      endedAt: 12_000,
      updatedAt: 12_000,
    });
  });

  it("prefers replacement-child identity over detached original identity", () => {
    const registry = createTaskRegistry();
    registry.upsertTask({
      childSessionID: "original-child",
      parentSessionID: "parent",
      agent: "sdd-apply",
      started: 1,
      status: "bg-detached",
      mode: "BG",
      newChildSessionID: "replacement-child",
    });
    registry.upsertTask({
      childSessionID: "replacement-child",
      parentSessionID: "parent",
      agent: "sdd-apply",
      started: 2,
      status: "running",
      mode: "BG",
    });

    expect(registry.getTask("replacement-child")?.childSessionID).toBe("replacement-child");
    registry.markStatus("replacement-child", "done", { summary: "replacement finished" });

    const original = registry.getTask("original-child");
    const replacement = registry.getTask("replacement-child");
    expect(original).toMatchObject({ childSessionID: "original-child", status: "bg-detached" });
    expect(replacement).toMatchObject({ childSessionID: "replacement-child", status: "done", summary: "replacement finished" });
  });

  it("marks idle activities complete with summary and without a running latestEvent", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          return vi.fn();
        }),
      },
    };
    const registry = createTaskRegistry();

    subscribeToSessionEvents({ api, registry });
    handlers.get("session.created")?.({ properties: { info: { id: "child-idle", parentID: "parent", agent: "sdd-apply" } } });
    handlers.get("message.part.updated")?.({ properties: { sessionID: "child-idle", part: { text: "still working" } } });
    handlers.get("session.idle")?.({ properties: { sessionID: "child-idle" } });

    const [tracked] = registry.tasks();
    expect(tracked?.status).toBe("done");
    expect(tracked?.summary).toBe("session idle");
    expect(tracked?.latestEvent).toBeUndefined();
    expect(tracked?.progressEvents).toEqual(["session created", "still working", "session idle"]);
  });

  it("marks errored activities with bounded error summary", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          return vi.fn();
        }),
      },
    };
    const registry = createTaskRegistry();

    subscribeToSessionEvents({ api, registry });
    handlers.get("session.created")?.({ properties: { info: { id: "child-error", parentID: "parent", agent: "sdd-apply" } } });
    handlers.get("session.error")?.({ properties: { sessionID: "child-error", error: { message: `boom ${"detail ".repeat(40)}` } } });

    const [tracked] = registry.tasks();
    expect(tracked?.status).toBe("error");
    expect(tracked?.summary).toContain("boom");
    expect(tracked?.errorMessage).toContain("boom");
    expect(tracked?.latestEvent).toBeUndefined();
    expect(tracked?.progressEvents?.at(-1)).toContain("boom");
    expect(tracked?.progressEvents?.at(-1)?.length).toBeLessThanOrEqual(96);
  });
});
