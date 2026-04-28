/**
 * Shared types for the Plan Review module.
 *
 * OQ-1 resolution (2026-04-24): PlanDecision renamed to PolicyDecision.
 * PlanPicker interface removed — no interactive picker in v1.0.
 * InterceptorContext.picker removed.
 * Skip mode removed from PolicyDecision — deferred to v1.1 with Candidate 6.
 *
 * Phase 9.5: PlanInterceptor interface extracted here so messages-transform
 * and any future alternate implementation (e.g. Candidate 6 async-chat) can
 * conform to the same contract without coupling to the concrete class.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/plan-review/spec.md
 */

import type { FileLogger } from "@maicolextic/bg-subagents-core";

// ---------------------------------------------------------------------------
// Part — minimal shape consumed by Plan Review (host-agnostic)
// ---------------------------------------------------------------------------

/**
 * Minimal tool-invocation part shape — what Plan Review cares about.
 * The host SDK may carry additional fields; they are spread-through untouched.
 */
export interface ToolInvocationPart {
  readonly type: "tool-invocation";
  readonly toolInvocationId: string;
  readonly toolName: string;
  readonly args: {
    readonly subagent_type?: string;
    readonly prompt?: string;
    readonly [key: string]: unknown;
  };
}

/** Discriminated union — anything the LLM can put in a message. */
export type Part = ToolInvocationPart | { readonly type: string; readonly [key: string]: unknown };

// ---------------------------------------------------------------------------
// BatchEntry — one task call extracted for policy lookup
// ---------------------------------------------------------------------------

export interface BatchEntry {
  /** The call_id / toolInvocationId linking the entry back to its Part. */
  readonly call_id: string;
  /** Resolved from args.subagent_type. Empty string if absent. */
  readonly agent_name: string;
  /** Resolved from args.prompt. Empty string if absent. */
  readonly prompt: string;
  /** Zero-based index of the part in the original parts array. */
  readonly original_part_index: number;
}

// ---------------------------------------------------------------------------
// PolicyDecision — output of PolicyResolver.resolveBatch
// ---------------------------------------------------------------------------

/**
 * A policy decision for a single task call.
 * v1.0: only "foreground" | "background". Skip deferred to v1.1.
 */
export interface PolicyDecision {
  readonly call_id: string;
  readonly agent_name: string;
  readonly mode: "foreground" | "background";
}

// ---------------------------------------------------------------------------
// PlanReviewMarker — idempotency sentinel (ADR-2 post-spike amendment)
// ---------------------------------------------------------------------------

/**
 * Hidden part injected by MessagesTransformInterceptor on first rewrite.
 * Subsequent fires of messages.transform detect this marker and short-circuit
 * without re-rewriting.
 */
export interface PlanReviewMarker {
  readonly type: "__bg_subagents_plan_review_marker__";
  readonly decisions: readonly PolicyDecision[];
  readonly rewrote_at: string; // ISO timestamp
}

export function isPlanReviewMarker(part: unknown): part is PlanReviewMarker {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "__bg_subagents_plan_review_marker__"
  );
}

// ---------------------------------------------------------------------------
// InterceptorContext — DI for messagesTransformInterceptor
// ---------------------------------------------------------------------------

export interface InterceptorContext {
  readonly sessionID: string;
  readonly logger?: FileLogger;
}

// ---------------------------------------------------------------------------
// PlanInterceptor — interface for messages-transform and future alternates
// (Phase 9.5)
// ---------------------------------------------------------------------------

export interface PlanInterceptor {
  /**
   * Intercept and potentially rewrite an array of message parts before they
   * are executed by the host. Returns the (possibly mutated) parts array and
   * the policy decisions that drove each rewrite.
   *
   * MUST be idempotent: if parts already contain a PlanReviewMarker, the
   * implementation MUST short-circuit and return parts unchanged.
   */
  intercept(
    parts: readonly Part[],
    ctx: InterceptorContext,
  ): Promise<{ parts: readonly Part[]; decisions: readonly PolicyDecision[] }>;
}
