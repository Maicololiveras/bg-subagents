/**
 * RED gate for rewriteParts(parts, decisions) — Phase 8.3
 *
 * Spec ref: plan-review/spec.md "Message Part Rewriting"
 * OQ-1 resolution: decisions are PolicyDecision[] from PolicyResolver (no picker).
 * No skip path in v1.0 (skip deferred to v1.1 with Candidate 6).
 *
 * Scenarios covered:
 *   - single FG decision: task part unchanged
 *   - single BG decision: task call_id swapped to task_bg, args preserved
 *   - mixed FG+BG: only BG entries rewritten
 *   - all BG: all task calls swapped to task_bg
 *   - empty decisions array: parts returned unchanged
 *   - non-task parts are always passed through untouched
 *   - BG rewrite preserves original part fields (agent_name, prompt, call_id)
 */

import { describe, expect, it } from "vitest";

import { rewriteParts } from "../../plan-review/rewrite-parts.js";
import type { PolicyDecision } from "../../plan-review/types.js";

// ---------------------------------------------------------------------------
// Minimal Part shapes
// ---------------------------------------------------------------------------

interface TaskToolPart {
  type: "tool-invocation";
  toolInvocationId: string;
  toolName: "task" | "task_bg";
  args: { subagent_type: string; prompt: string; [k: string]: unknown };
}

interface TextPart {
  type: "text";
  text: string;
}

type Part = TaskToolPart | TextPart;

function makeTaskPart(
  id: string,
  agentName: string,
  prompt = "do something",
): TaskToolPart {
  return {
    type: "tool-invocation",
    toolInvocationId: id,
    toolName: "task",
    args: { subagent_type: agentName, prompt },
  };
}

function makeTextPart(text: string): TextPart {
  return { type: "text", text };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rewriteParts — empty decisions array", () => {
  it("returns parts unchanged when decisions is empty", () => {
    const parts: Part[] = [makeTaskPart("call_1", "sdd-explore")];
    const decisions: PolicyDecision[] = [];
    const result = rewriteParts(parts as never, decisions);
    expect(result).toHaveLength(1);
    const first = result[0] as TaskToolPart;
    expect(first.toolName).toBe("task");
    expect(first.toolInvocationId).toBe("call_1");
  });

  it("returns empty array when parts is empty", () => {
    const result = rewriteParts([], []);
    expect(result).toHaveLength(0);
  });
});

describe("rewriteParts — single FG decision", () => {
  it("foreground decision leaves task part completely unchanged", () => {
    const parts: Part[] = [makeTaskPart("call_fg_1", "sdd-apply", "apply the spec")];
    const decisions: PolicyDecision[] = [
      {
        call_id: "call_fg_1",
        agent_name: "sdd-apply",
        mode: "foreground",
      },
    ];

    const result = rewriteParts(parts as never, decisions);
    expect(result).toHaveLength(1);
    const out = result[0] as TaskToolPart;
    expect(out.toolName).toBe("task");
    expect(out.toolInvocationId).toBe("call_fg_1");
    expect(out.args.subagent_type).toBe("sdd-apply");
    expect(out.args.prompt).toBe("apply the spec");
  });
});

describe("rewriteParts — single BG decision", () => {
  it("background decision swaps toolName from task to task_bg", () => {
    const parts: Part[] = [makeTaskPart("call_bg_1", "sdd-explore", "explore the code")];
    const decisions: PolicyDecision[] = [
      {
        call_id: "call_bg_1",
        agent_name: "sdd-explore",
        mode: "background",
      },
    ];

    const result = rewriteParts(parts as never, decisions);
    expect(result).toHaveLength(1);
    const out = result[0] as TaskToolPart;
    expect(out.toolName).toBe("task_bg");
  });

  it("background decision preserves args (subagent_type, prompt)", () => {
    const parts: Part[] = [makeTaskPart("call_bg_2", "sdd-verify", "verify the impl")];
    const decisions: PolicyDecision[] = [
      {
        call_id: "call_bg_2",
        agent_name: "sdd-verify",
        mode: "background",
      },
    ];

    const result = rewriteParts(parts as never, decisions);
    const out = result[0] as TaskToolPart;
    expect(out.args.subagent_type).toBe("sdd-verify");
    expect(out.args.prompt).toBe("verify the impl");
  });

  it("background decision preserves toolInvocationId", () => {
    const parts: Part[] = [makeTaskPart("call_bg_id_preserve", "sdd-explore")];
    const decisions: PolicyDecision[] = [
      {
        call_id: "call_bg_id_preserve",
        agent_name: "sdd-explore",
        mode: "background",
      },
    ];

    const result = rewriteParts(parts as never, decisions);
    const out = result[0] as TaskToolPart;
    expect(out.toolInvocationId).toBe("call_bg_id_preserve");
  });
});

describe("rewriteParts — mixed FG and BG decisions", () => {
  it("rewrites only BG entries and leaves FG entries unchanged", () => {
    const parts: Part[] = [
      makeTaskPart("call_1", "sdd-explore", "explore"),
      makeTaskPart("call_2", "sdd-apply", "apply"),
      makeTaskPart("call_3", "sdd-verify", "verify"),
    ];
    const decisions: PolicyDecision[] = [
      { call_id: "call_1", agent_name: "sdd-explore", mode: "background" },
      { call_id: "call_2", agent_name: "sdd-apply", mode: "foreground" },
      { call_id: "call_3", agent_name: "sdd-verify", mode: "background" },
    ];

    const result = rewriteParts(parts as never, decisions);
    expect(result).toHaveLength(3);

    const [r1, r2, r3] = result as TaskToolPart[];
    expect(r1!.toolName).toBe("task_bg"); // BG
    expect(r2!.toolName).toBe("task");    // FG unchanged
    expect(r3!.toolName).toBe("task_bg"); // BG
  });
});

describe("rewriteParts — all BG decisions", () => {
  it("all task parts swapped to task_bg when all decisions are background", () => {
    const parts: Part[] = [
      makeTaskPart("call_a", "sdd-explore"),
      makeTaskPart("call_b", "sdd-tasks"),
    ];
    const decisions: PolicyDecision[] = [
      { call_id: "call_a", agent_name: "sdd-explore", mode: "background" },
      { call_id: "call_b", agent_name: "sdd-tasks", mode: "background" },
    ];

    const result = rewriteParts(parts as never, decisions);
    expect(result).toHaveLength(2);
    for (const part of result as TaskToolPart[]) {
      expect(part.toolName).toBe("task_bg");
    }
  });
});

describe("rewriteParts — non-task parts passed through", () => {
  it("text parts are always passed through untouched", () => {
    const parts: Part[] = [
      makeTextPart("Hello from the LLM"),
      makeTaskPart("call_1", "sdd-explore"),
    ];
    const decisions: PolicyDecision[] = [
      { call_id: "call_1", agent_name: "sdd-explore", mode: "background" },
    ];

    const result = rewriteParts(parts as never, decisions);
    expect(result).toHaveLength(2);
    const textPart = result[0] as TextPart;
    expect(textPart.type).toBe("text");
    expect(textPart.text).toBe("Hello from the LLM");
  });

  it("non-task tool-invocation parts are passed through untouched", () => {
    const nonTaskPart = {
      type: "tool-invocation" as const,
      toolInvocationId: "call_other",
      toolName: "read_file" as const,
      args: { path: "/foo/bar" },
    };
    const taskPart = makeTaskPart("call_1", "sdd-explore");
    const parts = [nonTaskPart, taskPart];
    const decisions: PolicyDecision[] = [
      { call_id: "call_1", agent_name: "sdd-explore", mode: "background" },
    ];

    const result = rewriteParts(parts as never, decisions);
    expect(result).toHaveLength(2);
    const first = result[0] as typeof nonTaskPart;
    expect(first.toolName).toBe("read_file");
    const second = result[1] as TaskToolPart;
    expect(second.toolName).toBe("task_bg");
  });
});

describe("rewriteParts — decision matching by call_id", () => {
  it("matches decisions to parts by call_id, not by position", () => {
    const parts: Part[] = [
      makeTaskPart("id_B", "sdd-apply"),
      makeTaskPart("id_A", "sdd-explore"),
    ];
    // Decisions in opposite order to parts
    const decisions: PolicyDecision[] = [
      { call_id: "id_A", agent_name: "sdd-explore", mode: "background" },
      { call_id: "id_B", agent_name: "sdd-apply", mode: "foreground" },
    ];

    const result = rewriteParts(parts as never, decisions);
    const [first, second] = result as TaskToolPart[];
    // id_B = sdd-apply = foreground → task
    expect(first!.toolName).toBe("task");
    expect(first!.toolInvocationId).toBe("id_B");
    // id_A = sdd-explore = background → task_bg
    expect(second!.toolName).toBe("task_bg");
    expect(second!.toolInvocationId).toBe("id_A");
  });

  it("task parts without a matching decision are passed through unchanged", () => {
    const parts: Part[] = [
      makeTaskPart("call_unmatched", "sdd-unknown"),
      makeTaskPart("call_matched", "sdd-explore"),
    ];
    const decisions: PolicyDecision[] = [
      { call_id: "call_matched", agent_name: "sdd-explore", mode: "background" },
    ];

    const result = rewriteParts(parts as never, decisions);
    const [unmatched, matched] = result as TaskToolPart[];
    // Unmatched part: no decision → keep as-is (passthrough)
    expect(unmatched!.toolName).toBe("task");
    expect(matched!.toolName).toBe("task_bg");
  });
});
