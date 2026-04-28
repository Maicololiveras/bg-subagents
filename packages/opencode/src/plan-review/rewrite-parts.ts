/**
 * rewriteParts — Phase 8.4
 *
 * Takes an array of message parts and a list of PolicyDecision[], returning
 * a new parts array with task→task_bg swaps applied for background decisions.
 *
 * Rules (OQ-1 resolution, v1.0):
 *   - "background" decision: swap toolName from "task" to "task_bg", preserve all other fields.
 *   - "foreground" decision: leave part completely unchanged.
 *   - No skip path in v1.0 (deferred to v1.1 with Candidate 6).
 *   - Non-task parts (text, other tool-invocations) pass through untouched.
 *   - Task parts without a matching decision pass through unchanged.
 *   - Matching is by call_id (toolInvocationId), not by array position.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/plan-review/spec.md
 */

import type { Part, PolicyDecision } from "./types.js";

/**
 * Rewrite task tool-invocation parts according to the supplied PolicyDecision[].
 *
 * @param parts - Array of message parts from the LLM (any shape).
 * @param decisions - Array of PolicyDecision from PolicyResolver.resolveBatch().
 * @returns New array with background task calls swapped to task_bg.
 */
export function rewriteParts(
  parts: readonly Part[],
  decisions: readonly PolicyDecision[],
): Part[] {
  if (decisions.length === 0) {
    // Fast path: no decisions → return a copy (never mutate input).
    return parts.slice() as Part[];
  }

  // Build lookup: call_id → mode for O(1) per-part resolution.
  const modeByCallId = new Map<string, "foreground" | "background">();
  for (const dec of decisions) {
    modeByCallId.set(dec.call_id, dec.mode);
  }

  return parts.map((part) => {
    // Only act on tool-invocation parts whose toolName is "task".
    if (
      part.type !== "tool-invocation" ||
      (part as { toolName?: string }).toolName !== "task"
    ) {
      return part;
    }

    const toolPart = part as {
      type: "tool-invocation";
      toolInvocationId: string;
      toolName: string;
      args: Record<string, unknown>;
      [k: string]: unknown;
    };

    const mode = modeByCallId.get(toolPart.toolInvocationId);

    if (mode === "background") {
      // Swap toolName to task_bg; all other fields preserved.
      return { ...toolPart, toolName: "task_bg" } as Part;
    }

    // foreground or no matching decision → pass through unchanged.
    return part;
  });
}
