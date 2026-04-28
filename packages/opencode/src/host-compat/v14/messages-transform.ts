/**
 * v14 experimental.chat.messages.transform handler — Phase 9.2
 *
 * Implements PlanInterceptor (Phase 9.5) for the v14 messages.transform hook.
 *
 * Flow (OQ-1 resolved, Candidate 7, no picker):
 *   1. Detect PlanReviewMarker in output.messages — if found, short-circuit (idempotency, ADR-2).
 *   2. Collect all `task` tool-invocation parts across all messages.
 *   3. Call resolveBatch with per-agent policy config and session override.
 *   4. Call rewriteParts to swap BG task calls to task_bg.
 *   5. Inject PlanReviewMarker part into the last message (for idempotency detection).
 *   6. Mutate output.messages in place.
 *
 * Zero-pollution: all diagnostics via createLogger("v14:messages-transform").
 * No console.log, no process.stdout.write.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/plan-review/spec.md
 * Design: ADR-2 (idempotency via PlanReviewMarker)
 */

import { createLogger } from "@maicolextic/bg-subagents-core";
import { resolveBatch } from "@maicolextic/bg-subagents-core";
import type { FlatPolicyConfig } from "@maicolextic/bg-subagents-core";

import { rewriteParts } from "../../plan-review/rewrite-parts.js";
import {
  isPlanReviewMarker,
  type Part,
  type PlanInterceptor,
  type PlanReviewMarker,
  type PolicyDecision,
} from "../../plan-review/types.js";
import type { TaskPolicyStore } from "./slash-commands.js";
import { getSharedPolicyStore } from "./slash-commands.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessagesTransformHookOpts {
  /** Flat policy config from opencode.json bgSubagents.policy. */
  readonly policy: FlatPolicyConfig;
  /**
   * Session-level policy override store.
   * Defaults to the shared singleton; tests inject their own for isolation.
   */
  readonly policyStore?: TaskPolicyStore;
  /** Optional logger — defaults to createLogger("v14:messages-transform"). */
  readonly logger?: {
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
}

export type MessagesTransformHook = (
  input: { sessionID?: string; model: unknown },
  output: { messages: Array<{ parts: Part[] }> },
) => Promise<void>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the experimental.chat.messages.transform hook handler.
 *
 * Returns a function that can be wired directly into the v14 Hooks object:
 *   hooks["experimental.chat.messages.transform"] = buildMessagesTransformHook(opts);
 */
export function buildMessagesTransformHook(
  opts: MessagesTransformHookOpts,
): MessagesTransformHook {
  const log = opts.logger ?? createLogger("v14:messages-transform");
  const policyStore = opts.policyStore ?? getSharedPolicyStore();
  const policy = opts.policy;

  return async function messagesTransformHook(input, output) {
    const sessionID = input.sessionID ?? "session_unknown";

    // -----------------------------------------------------------------------
    // Step 1: Idempotency check — detect PlanReviewMarker (ADR-2).
    // If any message already contains a marker, this is a repeat fire.
    // Short-circuit without re-rewriting.
    // -----------------------------------------------------------------------
    for (const msg of output.messages) {
      for (const part of msg.parts) {
        if (isPlanReviewMarker(part)) {
          log.debug("plan-review:idempotency-skip", {
            sessionID,
            marker_found: true,
          });
          return;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: Collect task tool-invocation parts across all messages.
    // -----------------------------------------------------------------------
    const taskEntries: Array<{
      call_id: string;
      agent_name: string;
      msg_index: number;
      part_index: number;
    }> = [];

    for (let mi = 0; mi < output.messages.length; mi++) {
      const msg = output.messages[mi]!;
      for (let pi = 0; pi < msg.parts.length; pi++) {
        const part = msg.parts[pi] as {
          type?: string;
          toolName?: string;
          toolInvocationId?: string;
          args?: { subagent_type?: string };
        };
        if (
          part.type === "tool-invocation" &&
          part.toolName === "task" &&
          typeof part.toolInvocationId === "string"
        ) {
          taskEntries.push({
            call_id: part.toolInvocationId,
            agent_name: part.args?.subagent_type ?? "",
            msg_index: mi,
            part_index: pi,
          });
        }
      }
    }

    if (taskEntries.length === 0) {
      log.debug("plan-review:no-task-parts", { sessionID });
      return; // Nothing to rewrite, no marker needed.
    }

    log.info("plan-review:intercepted", {
      sessionID,
      task_count: taskEntries.length,
    });

    // -----------------------------------------------------------------------
    // Step 3: Resolve policies.
    // -----------------------------------------------------------------------
    const sessionOverride = policyStore.getSessionOverride(sessionID);

    const decisions = resolveBatch({
      entries: taskEntries.map((e) => ({ call_id: e.call_id, agent_name: e.agent_name })),
      policy,
      ...(sessionOverride !== undefined ? { sessionOverride } : {}),
    });

    log.debug("plan-review:decisions", {
      sessionID,
      decisions: decisions.map((d) => ({ call_id: d.call_id, mode: d.mode })),
    });

    // -----------------------------------------------------------------------
    // Step 4: Rewrite parts per message.
    // For each message that has task parts, run rewriteParts on that message's
    // full parts array so non-task parts are preserved in position.
    // -----------------------------------------------------------------------
    const affectedMsgIndexes = new Set(taskEntries.map((e) => e.msg_index));

    for (const mi of affectedMsgIndexes) {
      const msg = output.messages[mi]!;
      const rewritten = rewriteParts(msg.parts as never, decisions as PolicyDecision[]);
      msg.parts = rewritten as Part[];
    }

    // -----------------------------------------------------------------------
    // Step 5: Inject PlanReviewMarker into the last message.
    // Using the last message ensures it's easy to find on repeat fires.
    // -----------------------------------------------------------------------
    const lastMsg = output.messages[output.messages.length - 1]!;
    const marker: PlanReviewMarker = {
      type: "__bg_subagents_plan_review_marker__",
      decisions: decisions as PolicyDecision[],
      rewrote_at: new Date().toISOString(),
    };
    lastMsg.parts.push(marker as unknown as Part);

    log.info("plan-review:rewritten", {
      sessionID,
      bg_count: decisions.filter((d) => d.mode === "background").length,
      fg_count: decisions.filter((d) => d.mode === "foreground").length,
    });
  };
}

// ---------------------------------------------------------------------------
// PlanInterceptor implementation (Phase 9.5) — adapter shape
// ---------------------------------------------------------------------------

/**
 * Adapter that wraps buildMessagesTransformHook and exposes the PlanInterceptor
 * interface for future alternate implementations (e.g. Candidate 6 async-chat).
 *
 * Not used in the v14 hook wiring directly — the hook function is simpler.
 * Kept here so MessagesTransformInterceptor is structurally a PlanInterceptor.
 */
export class MessagesTransformInterceptor implements PlanInterceptor {
  readonly #hook: MessagesTransformHook;

  constructor(opts: MessagesTransformHookOpts) {
    this.#hook = buildMessagesTransformHook(opts);
  }

  async intercept(
    parts: readonly Part[],
    ctx: import("../../plan-review/types.js").InterceptorContext,
  ): Promise<{ parts: readonly Part[]; decisions: readonly PolicyDecision[] }> {
    // Wrap parts in a single synthetic message, run the hook, extract result.
    const output = { messages: [{ parts: [...parts] as Part[] }] };
    await this.#hook({ sessionID: ctx.sessionID, model: null }, output);

    const resultParts = output.messages[0]!.parts;
    let markerPart: PlanReviewMarker | undefined;
    for (const p of resultParts) {
      if (isPlanReviewMarker(p)) {
        markerPart = p;
        break;
      }
    }
    const decisions: readonly PolicyDecision[] = markerPart?.decisions ?? [];

    return { parts: resultParts, decisions };
  }
}
