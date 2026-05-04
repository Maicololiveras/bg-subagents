/**
 * Integration test: v14 Plan Review E2E — Phase 14.1
 *
 * Drives the full messages.transform interceptor stack end-to-end:
 *   buildMessagesTransformHook → resolveBatch → rewriteParts → PlanReviewMarker
 *
 * No picker invocation. PolicyResolver-first (Candidate 7, OQ-1 resolved).
 *
 * Scenarios:
 *   - 3 task calls with mixed agent config → correct BG/FG rewriting
 *   - PlanReviewMarker injected for idempotency (second fire → unchanged)
 *   - /task policy bg session override forces all 3 to BG regardless of per-agent config
 *   - /task policy default clears override, per-agent config resumes
 *   - Zero stdout during any of the above
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md 14.1
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMessagesTransformHook } from "../../host-compat/v14/messages-transform.js";
import {
  createTaskPolicyStore,
  interceptTaskPolicyCommand,
} from "../../host-compat/v14/slash-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ToolInvocationPart {
  type: "tool-invocation";
  toolInvocationId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface TextPart {
  type: "text";
  text: string;
}

type Part = ToolInvocationPart | TextPart | { type: string; [k: string]: unknown };

function makeTaskPart(id: string, agentName: string, prompt = "do the thing"): ToolInvocationPart {
  return {
    type: "tool-invocation",
    toolInvocationId: id,
    toolName: "task",
    args: { subagent_type: agentName, prompt },
  };
}

function makeSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
    flush: vi.fn(async () => {}),
  };
}

// Build an output object with a single message containing the given parts.
function makeOutput(parts: Part[]): { messages: Array<{ parts: Part[] }> } {
  return { messages: [{ parts: [...parts] }] };
}

// Filter out the PlanReviewMarker from a parts array.
function toolParts(parts: Part[]): ToolInvocationPart[] {
  return parts.filter(
    (p): p is ToolInvocationPart =>
      p.type === "tool-invocation" &&
      (p as ToolInvocationPart).toolName !== undefined,
  );
}

function hasMarker(parts: Part[]): boolean {
  return parts.some((p) => p.type === "__bg_subagents_plan_review_marker__");
}

// ---------------------------------------------------------------------------
// 14.1.A — Realistic 3-task turn: sdd-explore (BG), sdd-design (BG), sdd-spec (FG)
// ---------------------------------------------------------------------------

describe("v14 Plan Review E2E — 3-task turn with mixed policy", () => {
  afterEach(() => vi.restoreAllMocks());

  const POLICY: Record<string, "background" | "foreground"> = {
    "sdd-explore": "background",
    "sdd-design": "background",
    "sdd-spec": "foreground",
  };

  function makeHookAndStore() {
    const store = createTaskPolicyStore();
    const hook = buildMessagesTransformHook({
      policy: POLICY,
      policyStore: store,
      logger: makeSilentLogger(),
    });
    return { hook, store };
  }

  it("sdd-explore → task_bg (BG policy)", async () => {
    const { hook } = makeHookAndStore();
    const output = makeOutput([
      makeTaskPart("c1", "sdd-explore"),
      makeTaskPart("c2", "sdd-design"),
      makeTaskPart("c3", "sdd-spec"),
    ]);

    await hook({ sessionID: "sess_e2e_mixed", model: {} }, output);

    const parts = toolParts(output.messages[0]!.parts);
    expect(parts[0]?.toolName).toBe("task_bg"); // sdd-explore → BG
    expect(parts[1]?.toolName).toBe("task_bg"); // sdd-design → BG
    expect(parts[2]?.toolName).toBe("task");    // sdd-spec   → FG
  });

  it("PlanReviewMarker is injected into the last message", async () => {
    const { hook } = makeHookAndStore();
    const output = makeOutput([
      makeTaskPart("c1", "sdd-explore"),
      makeTaskPart("c2", "sdd-design"),
      makeTaskPart("c3", "sdd-spec"),
    ]);

    await hook({ sessionID: "sess_e2e_marker", model: {} }, output);

    expect(hasMarker(output.messages[0]!.parts)).toBe(true);
  });

  it("second fire with PlanReviewMarker present → output unchanged (idempotency)", async () => {
    const { hook } = makeHookAndStore();
    const output = makeOutput([
      makeTaskPart("c1", "sdd-explore"),
      makeTaskPart("c2", "sdd-design"),
      makeTaskPart("c3", "sdd-spec"),
    ]);

    // First fire — rewrites and injects marker
    await hook({ sessionID: "sess_idem_e2e", model: {} }, output);
    const afterFirstCount = output.messages[0]!.parts.length;
    const afterFirstTools = toolParts(output.messages[0]!.parts).map((p) => p.toolName);

    // Second fire — must short-circuit completely
    await hook({ sessionID: "sess_idem_e2e", model: {} }, output);

    expect(output.messages[0]!.parts.length).toBe(afterFirstCount);
    const afterSecondTools = toolParts(output.messages[0]!.parts).map((p) => p.toolName);
    expect(afterSecondTools).toEqual(afterFirstTools);
  });

  it("marker decisions array contains all 3 entries with correct agent_name + mode", async () => {
    const { hook } = makeHookAndStore();
    const output = makeOutput([
      makeTaskPart("c1", "sdd-explore"),
      makeTaskPart("c2", "sdd-design"),
      makeTaskPart("c3", "sdd-spec"),
    ]);

    await hook({ sessionID: "sess_decisions", model: {} }, output);

    const marker = output.messages[0]!.parts.find(
      (p) => p.type === "__bg_subagents_plan_review_marker__",
    ) as { decisions: Array<{ call_id: string; agent_name: string; mode: string }> } | undefined;

    expect(marker).toBeDefined();
    expect(marker?.decisions).toHaveLength(3);

    const byCallId = new Map(marker!.decisions.map((d) => [d.call_id, d]));
    expect(byCallId.get("c1")?.mode).toBe("background");
    expect(byCallId.get("c2")?.mode).toBe("background");
    expect(byCallId.get("c3")?.mode).toBe("foreground");
  });
});

// ---------------------------------------------------------------------------
// 14.1.B — /task policy bg session override forces all 3 to BG
// ---------------------------------------------------------------------------

describe("v14 Plan Review E2E — /task policy bg override forces all to BG", () => {
  afterEach(() => vi.restoreAllMocks());

  it("/task policy bg → all 3 task calls rewritten to task_bg regardless of per-agent config", async () => {
    const store = createTaskPolicyStore();

    // Config says sdd-spec is FG — override must win
    const hook = buildMessagesTransformHook({
      policy: {
        "sdd-explore": "background",
        "sdd-design": "background",
        "sdd-spec": "foreground",  // would stay task without override
      },
      policyStore: store,
      logger: makeSilentLogger(),
    });

    // Simulate /task policy bg command arriving before the turn
    const cmdResult = interceptTaskPolicyCommand("/task policy bg", "sess_override_e2e", store);
    expect(cmdResult.handled).toBe(true);

    const output = makeOutput([
      makeTaskPart("c1", "sdd-explore"),
      makeTaskPart("c2", "sdd-design"),
      makeTaskPart("c3", "sdd-spec"),
    ]);

    await hook({ sessionID: "sess_override_e2e", model: {} }, output);

    const parts = toolParts(output.messages[0]!.parts);
    // ALL must be task_bg — override wins
    expect(parts[0]?.toolName).toBe("task_bg");
    expect(parts[1]?.toolName).toBe("task_bg");
    expect(parts[2]?.toolName).toBe("task_bg");
  });

  it("/task policy default clears override, per-agent config resumes on next turn", async () => {
    const store = createTaskPolicyStore();
    const hook = buildMessagesTransformHook({
      policy: {
        "sdd-explore": "background",
        "sdd-spec": "foreground",
      },
      policyStore: store,
      logger: makeSilentLogger(),
    });

    // Set override to bg
    interceptTaskPolicyCommand("/task policy bg", "sess_clear_e2e", store);

    // Clear it
    const clearResult = interceptTaskPolicyCommand("/task policy default", "sess_clear_e2e", store);
    expect(clearResult.handled).toBe(true);

    // Now per-agent config must apply — sdd-spec stays FG
    const output = makeOutput([
      makeTaskPart("d1", "sdd-explore"),
      makeTaskPart("d2", "sdd-spec"),
    ]);
    await hook({ sessionID: "sess_clear_e2e", model: {} }, output);

    const parts = toolParts(output.messages[0]!.parts);
    expect(parts[0]?.toolName).toBe("task_bg");  // sdd-explore → BG (per config)
    expect(parts[1]?.toolName).toBe("task");      // sdd-spec → FG (per config, not override)
  });

  it("/task policy fg → all task calls remain as task regardless of per-agent config", async () => {
    const store = createTaskPolicyStore();
    const hook = buildMessagesTransformHook({
      policy: { "*": "background" }, // default all BG
      policyStore: store,
      logger: makeSilentLogger(),
    });

    interceptTaskPolicyCommand("/task policy fg", "sess_fg_override", store);

    const output = makeOutput([
      makeTaskPart("e1", "sdd-explore"),
      makeTaskPart("e2", "sdd-design"),
    ]);
    await hook({ sessionID: "sess_fg_override", model: {} }, output);

    const parts = toolParts(output.messages[0]!.parts);
    expect(parts[0]?.toolName).toBe("task");  // fg override wins
    expect(parts[1]?.toolName).toBe("task");
  });
});

// ---------------------------------------------------------------------------
// 14.1.C — Wildcard fallback for unknown agent names
// ---------------------------------------------------------------------------

describe("v14 Plan Review E2E — wildcard policy for unknown agents", () => {
  afterEach(() => vi.restoreAllMocks());

  it("unknown agent falls back to wildcard '*' policy", async () => {
    const store = createTaskPolicyStore();
    const hook = buildMessagesTransformHook({
      policy: {
        "sdd-explore": "foreground",
        "*": "background",  // wildcard: any unknown agent → BG
      },
      policyStore: store,
      logger: makeSilentLogger(),
    });

    const output = makeOutput([
      makeTaskPart("f1", "some-unknown-agent"),
      makeTaskPart("f2", "sdd-explore"),
    ]);
    await hook({ sessionID: "sess_wildcard", model: {} }, output);

    const parts = toolParts(output.messages[0]!.parts);
    expect(parts[0]?.toolName).toBe("task_bg");  // unknown → wildcard BG
    expect(parts[1]?.toolName).toBe("task");      // sdd-explore → FG per config
  });
});

// ---------------------------------------------------------------------------
// 14.1.D — Zero stdout throughout
// ---------------------------------------------------------------------------

describe("v14 Plan Review E2E — zero stdout", () => {
  afterEach(() => vi.restoreAllMocks());

  it("produces ZERO bytes on stdout during full 3-task E2E with policy override", async () => {
    delete process.env["BG_SUBAGENTS_DEBUG"];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const store = createTaskPolicyStore();
    const hook = buildMessagesTransformHook({
      policy: { "sdd-explore": "background", "*": "foreground" },
      policyStore: store,
      logger: makeSilentLogger(),
    });

    interceptTaskPolicyCommand("/task policy bg", "sess_zero_e2e", store);

    const output = makeOutput([
      makeTaskPart("g1", "sdd-explore"),
      makeTaskPart("g2", "sdd-design"),
      makeTaskPart("g3", "sdd-spec"),
    ]);
    await hook({ sessionID: "sess_zero_e2e", model: {} }, output);

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
