import { describe, expect, it, vi } from "vitest";

import { createTaskRegistry } from "./events.js";
import {
  collapseOrchestratorSnippetDuplicates,
  createOrchestratorActivityRegistry,
  formatOrchestratorActivityLines,
  subscribeToOrchestratorActivity,
} from "./orchestrator-activity.js";

describe("control-tui orchestrator activity", () => {
  it("captures compact parent activity snippets and ignores child task progress", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const api = {
      event: {
        on: vi.fn((name: string, handler: (event: unknown) => void) => {
          handlers.set(name, handler);
          return vi.fn();
        }),
      },
    };
    const taskRegistry = createTaskRegistry();
    taskRegistry.upsertTask({
      childSessionID: "child-1",
      parentSessionID: "parent-1",
      agent: "sdd-apply",
      started: 1,
      status: "running",
    });
    const registry = createOrchestratorActivityRegistry();

    subscribeToOrchestratorActivity({ api, registry, taskRegistry });

    handlers.get("message.part.updated")?.({
      properties: {
        sessionID: "parent-1",
        messageID: "turn-1",
        part: { type: "reasoning", text: `thinking ${"detail ".repeat(40)}` },
      },
    });
    handlers.get("message.part.updated")?.({
      properties: {
        sessionID: "child-1",
        messageID: "child-turn",
        part: { type: "text", text: "child progress should stay in task card" },
      },
    });

    expect(registry.snippets()).toHaveLength(1);
    expect(registry.snippets()[0]).toMatchObject({
      sessionID: "parent-1",
      turnID: "turn-1",
      kind: "thinking",
    });
    expect(registry.snippets()[0]?.text.length).toBeLessThanOrEqual(96);
  });

  it("groups rendered lines with compact kind labels", () => {
    const registry = createOrchestratorActivityRegistry();
    registry.append({ sessionID: "parent", turnID: "turn", kind: "tool", text: "task_bg", timestamp: 1 });
    registry.append({ sessionID: "parent", turnID: "turn", kind: "delivery", text: "Referencia: child session/logs", timestamp: 2 });

    expect(formatOrchestratorActivityLines(registry.snippets())).toEqual([
      "tool: task_bg",
      "deliver: Referencia: child session/logs",
    ]);
  });

  it("collapses duplicate snippets from the same source", () => {
    const collapsed = collapseOrchestratorSnippetDuplicates([
      { sessionID: "parent", turnID: "turn-1", kind: "tool", text: "task_bg", timestamp: 1 },
      { sessionID: "parent", turnID: "turn-1", kind: "tool", text: "task_bg", timestamp: 2 },
      { sessionID: "parent", turnID: "turn-1", kind: "status", text: "status: running", timestamp: 3 },
    ]);

    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]).toMatchObject({ kind: "tool", text: "task_bg", timestamp: 2 });
    expect(collapsed[1]).toMatchObject({ kind: "status" });
  });
});
