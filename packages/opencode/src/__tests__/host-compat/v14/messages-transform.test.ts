/**
 * RED gate for messagesTransformInterceptor — Phase 9.1
 *
 * Spec ref: tasks.md 9.1 — "Write messages-transform integration test"
 * Spec ref: plan-review/spec.md "Message Part Rewriting"
 *
 * The v14 handler for experimental.chat.messages.transform:
 *   1. Detects task tool-invocation parts in output.messages
 *   2. Calls resolveBatch (honors session override from /task policy store)
 *   3. Calls rewriteParts to mutate output
 *   4. Injects PlanReviewMarker part for idempotency (ADR-2)
 *   5. On repeat fires: detects marker and short-circuits (no-op)
 *
 * Scenarios:
 *   - messages with task calls: output mutated per policy decisions (BG→task_bg)
 *   - messages with FG calls: output unchanged
 *   - session override "bg" forces all to task_bg
 *   - idempotency: second invocation with PlanReviewMarker present short-circuits
 *   - no task parts: output unchanged, no marker injected
 *   - marker is a non-visible __bg_subagents_plan_review_marker__ part
 */

import { describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";

import {
  buildMessagesTransformHook,
  type MessagesTransformHookOpts,
} from "../../../host-compat/v14/messages-transform.js";
import { createTaskPolicyStore } from "../../../host-compat/v14/slash-commands.js";
import type { PolicyDecision } from "../../../plan-review/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ToolInvocationPart {
  type: "tool-invocation";
  toolInvocationId: string;
  toolName: "task" | "task_bg" | string;
  args: Record<string, unknown>;
}
interface TextPart {
  type: "text";
  text: string;
}
type Part = ToolInvocationPart | TextPart | { type: string; [k: string]: unknown };

function makeTaskPart(id: string, agentName: string, prompt = "do something"): ToolInvocationPart {
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

function makeMessages(parts: Part[]): { parts: Part[] }[] {
  return [{ parts }];
}

function makeOutput(messages: { parts: Part[] }[]): { messages: { parts: Part[] }[] } {
  return { messages };
}

function makeHook(
  policy: Record<string, "background" | "foreground">,
  sessionOverrideStore?: ReturnType<typeof createTaskPolicyStore>,
): ReturnType<typeof buildMessagesTransformHook> {
  const store = sessionOverrideStore ?? createTaskPolicyStore();
  const opts: MessagesTransformHookOpts = {
    policy,
    policyStore: store,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
      flush: vi.fn(async () => {}),
    },
  };
  return buildMessagesTransformHook(opts);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("messagesTransformInterceptor — no task parts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("output is unchanged when messages contain only text parts", async () => {
    const hook = makeHook({ "*": "background" });
    const output = makeOutput(makeMessages([makeTextPart("hello")]));
    const originalParts = [...output.messages[0]!.parts];

    await hook({ sessionID: "sess_1", model: {} }, output);

    // Parts unchanged (no task calls, no marker needed)
    expect(output.messages[0]!.parts).toHaveLength(originalParts.length);
    const hasMarker = output.messages[0]!.parts.some(
      (p) => (p as { type: string }).type === "__bg_subagents_plan_review_marker__",
    );
    expect(hasMarker).toBe(false);
  });

  it("output is unchanged when messages is empty", async () => {
    const hook = makeHook({ "*": "background" });
    const output = makeOutput([]);
    await hook({ sessionID: "sess_1", model: {} }, output);
    expect(output.messages).toHaveLength(0);
  });
});

describe("messagesTransformInterceptor — BG decision swaps task to task_bg", () => {
  afterEach(() => vi.restoreAllMocks());

  it("task call in BG policy is rewritten to task_bg", async () => {
    const hook = makeHook({ "sdd-explore": "background" });
    const parts: Part[] = [makeTaskPart("call_1", "sdd-explore", "explore the code")];
    const output = makeOutput(makeMessages(parts));

    await hook({ sessionID: "sess_bg", model: {} }, output);

    const resultParts = output.messages[0]!.parts.filter(
      (p) => (p as ToolInvocationPart).toolName !== undefined &&
             (p as { type: string }).type !== "__bg_subagents_plan_review_marker__",
    );
    const taskPart = resultParts[0] as ToolInvocationPart;
    expect(taskPart.toolName).toBe("task_bg");
  });

  it("FG decision leaves task part unchanged", async () => {
    const hook = makeHook({ "sdd-apply": "foreground" });
    const parts: Part[] = [makeTaskPart("call_2", "sdd-apply", "apply changes")];
    const output = makeOutput(makeMessages(parts));

    await hook({ sessionID: "sess_fg", model: {} }, output);

    const resultParts = output.messages[0]!.parts.filter(
      (p) => (p as { type: string }).type !== "__bg_subagents_plan_review_marker__",
    );
    const taskPart = resultParts[0] as ToolInvocationPart;
    expect(taskPart.toolName).toBe("task");
  });

  it("3 task calls: BG/FG/BG rewrites correctly", async () => {
    const hook = makeHook({
      "sdd-explore": "background",
      "sdd-apply": "foreground",
      "sdd-verify": "background",
    });
    const parts: Part[] = [
      makeTaskPart("c1", "sdd-explore"),
      makeTaskPart("c2", "sdd-apply"),
      makeTaskPart("c3", "sdd-verify"),
    ];
    const output = makeOutput(makeMessages(parts));

    await hook({ sessionID: "sess_mixed", model: {} }, output);

    const resultParts = output.messages[0]!.parts.filter(
      (p) => (p as { type: string }).type !== "__bg_subagents_plan_review_marker__",
    ) as ToolInvocationPart[];

    expect(resultParts[0]!.toolName).toBe("task_bg"); // sdd-explore → BG
    expect(resultParts[1]!.toolName).toBe("task");    // sdd-apply  → FG
    expect(resultParts[2]!.toolName).toBe("task_bg"); // sdd-verify → BG
  });
});

describe("messagesTransformInterceptor — PlanReviewMarker injection (ADR-2)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("injects PlanReviewMarker when task calls are present", async () => {
    const hook = makeHook({ "*": "background" });
    const parts: Part[] = [makeTaskPart("call_m", "sdd-explore")];
    const output = makeOutput(makeMessages(parts));

    await hook({ sessionID: "sess_marker", model: {} }, output);

    const marker = output.messages[0]!.parts.find(
      (p) => (p as { type: string }).type === "__bg_subagents_plan_review_marker__",
    );
    expect(marker).toBeDefined();
  });

  it("marker contains the decisions array", async () => {
    const hook = makeHook({ "sdd-explore": "background" });
    const parts: Part[] = [makeTaskPart("call_dec", "sdd-explore")];
    const output = makeOutput(makeMessages(parts));

    await hook({ sessionID: "sess_dec", model: {} }, output);

    const marker = output.messages[0]!.parts.find(
      (p) => (p as { type: string }).type === "__bg_subagents_plan_review_marker__",
    ) as { decisions: readonly PolicyDecision[] } | undefined;
    expect(marker?.decisions).toBeDefined();
    expect(Array.isArray(marker?.decisions)).toBe(true);
    expect(marker?.decisions[0]?.agent_name).toBe("sdd-explore");
    expect(marker?.decisions[0]?.mode).toBe("background");
  });
});

describe("messagesTransformInterceptor — idempotency (ADR-2)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("second invocation with PlanReviewMarker present short-circuits (no-op)", async () => {
    const hook = makeHook({ "*": "background" });
    const parts: Part[] = [makeTaskPart("call_idem", "sdd-explore")];
    const output = makeOutput(makeMessages(parts));

    // First invocation — rewrites and injects marker.
    await hook({ sessionID: "sess_idem", model: {} }, output);
    const afterFirst = output.messages[0]!.parts.map((p) => ({...(p as object)}));

    // Second invocation — must short-circuit.
    await hook({ sessionID: "sess_idem", model: {} }, output);
    const afterSecond = output.messages[0]!.parts;

    // Parts should be identical after both invocations.
    expect(afterSecond).toHaveLength(afterFirst.length);
  });

  it("after short-circuit, task_bg entries are NOT double-swapped back to task", async () => {
    const hook = makeHook({ "*": "background" });
    const parts: Part[] = [makeTaskPart("call_no_double", "sdd-explore")];
    const output = makeOutput(makeMessages(parts));

    await hook({ sessionID: "sess_nodbl", model: {} }, output);
    await hook({ sessionID: "sess_nodbl", model: {} }, output);

    const taskParts = output.messages[0]!.parts.filter(
      (p) =>
        (p as { type: string }).type === "tool-invocation" &&
        (p as ToolInvocationPart).toolName !== undefined,
    ) as ToolInvocationPart[];

    const taskBgParts = taskParts.filter((p) => p.toolName === "task_bg");
    const rawTaskParts = taskParts.filter((p) => p.toolName === "task");

    expect(taskBgParts).toHaveLength(1);
    expect(rawTaskParts).toHaveLength(0);
  });
});

describe("messagesTransformInterceptor — session override", () => {
  afterEach(() => vi.restoreAllMocks());

  it("session override 'bg' forces all tasks to task_bg regardless of config", async () => {
    const store = createTaskPolicyStore();
    store.setSessionOverride("sess_override", "bg");

    const hook = makeHook({ "sdd-apply": "foreground" }, store); // config says FG
    const parts: Part[] = [makeTaskPart("call_ov", "sdd-apply")];
    const output = makeOutput(makeMessages(parts));

    await hook({ sessionID: "sess_override", model: {} }, output);

    const resultParts = output.messages[0]!.parts.filter(
      (p) => (p as { type: string }).type !== "__bg_subagents_plan_review_marker__",
    ) as ToolInvocationPart[];
    expect(resultParts[0]!.toolName).toBe("task_bg"); // override wins
  });

  it("session override 'fg' forces all tasks to remain task", async () => {
    const store = createTaskPolicyStore();
    store.setSessionOverride("sess_fg_ov", "fg");

    const hook = makeHook({ "*": "background" }, store);
    const parts: Part[] = [makeTaskPart("call_fg_ov", "sdd-explore")];
    const output = makeOutput(makeMessages(parts));

    await hook({ sessionID: "sess_fg_ov", model: {} }, output);

    const resultParts = output.messages[0]!.parts.filter(
      (p) => (p as { type: string }).type !== "__bg_subagents_plan_review_marker__",
    ) as ToolInvocationPart[];
    expect(resultParts[0]!.toolName).toBe("task"); // FG override wins
  });
});

describe("messagesTransformInterceptor — zero stdout pollution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("produces ZERO bytes on stdout when BG_SUBAGENTS_DEBUG is unset", async () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const hook = makeHook({ "*": "background" });
    const parts: Part[] = [makeTaskPart("call_poll", "sdd-explore")];
    const output = makeOutput(makeMessages(parts));

    await hook({ sessionID: "sess_nopoll", model: {} }, output);

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
