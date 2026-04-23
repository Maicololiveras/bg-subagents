/**
 * v14 `event` hook handler — unit tests.
 *
 * The v14 event hook receives the SDK `Event` discriminated union via
 * `input.event`. Most event types are noisy (LSP updates, file watcher,
 * TUI internals) and have no relevance to background subagents. This
 * handler logs the few "interesting" session lifecycle events and
 * silently ignores the rest — a read-only consumer surface.
 *
 * Completion delivery is NOT wired through this hook: it runs off
 * `TaskRegistry.onComplete` inside `buildV14Hooks`. The event hook is
 * pure observability.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/host-compat/spec.md
 */

import { describe, expect, it, vi } from "vitest";

import { buildV14EventHandler } from "../../../host-compat/v14/event-handler.js";

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
}

describe("buildV14EventHandler — interesting events logged", () => {
  it("logs session.idle at info level with properties", async () => {
    const logger = makeLogger();
    const handle = buildV14EventHandler({ logger: logger as never });

    await handle({
      event: {
        type: "session.idle",
        properties: { sessionID: "sess_v14_1" },
      } as never,
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [msg, fields] = logger.info.mock.calls[0]!;
    expect(msg).toBe("v14-event");
    expect((fields as Record<string, unknown>)["event_type"]).toBe("session.idle");
  });

  it("logs session.created at info level", async () => {
    const logger = makeLogger();
    const handle = buildV14EventHandler({ logger: logger as never });

    await handle({
      event: {
        type: "session.created",
        properties: { sessionID: "sess_v14_2" },
      } as never,
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [, fields] = logger.info.mock.calls[0]!;
    expect((fields as Record<string, unknown>)["event_type"]).toBe("session.created");
  });

  it("logs session.error at WARN level (not info)", async () => {
    const logger = makeLogger();
    const handle = buildV14EventHandler({ logger: logger as never });

    await handle({
      event: {
        type: "session.error",
        properties: { sessionID: "sess_v14_3", error: "boom" },
      } as never,
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    const [msg, fields] = logger.warn.mock.calls[0]!;
    expect(msg).toBe("v14-event");
    expect((fields as Record<string, unknown>)["event_type"]).toBe("session.error");
  });
});

describe("buildV14EventHandler — noisy events ignored", () => {
  it("ignores message.part.updated entirely", async () => {
    const logger = makeLogger();
    const handle = buildV14EventHandler({ logger: logger as never });

    await handle({
      event: {
        type: "message.part.updated",
        properties: { part: {}, delta: "hi" },
      } as never,
    });

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("ignores file.watcher.updated", async () => {
    const logger = makeLogger();
    const handle = buildV14EventHandler({ logger: logger as never });

    await handle({
      event: {
        type: "file.watcher.updated",
        properties: { path: "/tmp/x" },
      } as never,
    });

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("ignores unknown event types without throwing", async () => {
    const logger = makeLogger();
    const handle = buildV14EventHandler({ logger: logger as never });

    await expect(
      handle({
        event: {
          type: "totally.unknown.future.event",
          properties: {},
        } as never,
      }),
    ).resolves.toBeUndefined();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
