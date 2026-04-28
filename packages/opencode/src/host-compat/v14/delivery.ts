/**
 * v14 completion delivery coordinator.
 *
 * When a bg task completes, this coordinator posts a human-visible
 * message into the main chat via `client.session.prompt({noReply:true})`
 * (verified as the working v1 SDK shape during DQ-1 spike). Dedupes
 * through `TaskRegistry.markDelivered` so primary + fallback channels
 * cannot double-post.
 *
 * The spec names the primary call `client.session.message.create`; the v1
 * SDK exposes this operation as `session.prompt` with `noReply:true` —
 * they're the same endpoint `/session/{id}/message`. noReply suppresses
 * the downstream LLM turn so the posted text is a visible chat entry
 * without consuming a turn.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/delivery/spec.md
 */

import type { CompletionEvent, Logger, TaskRegistry } from "@maicolextic/bg-subagents-core";

// Minimal OpencodeClient shape that this module uses — avoids coupling to
// the full v1 SDK type (which pulls generic heavy types through pnpm store).
interface V14DeliveryClient {
  readonly session: {
    prompt(options: {
      path: { id: string };
      body: {
        noReply: boolean;
        parts: Array<{ type: "text"; text: string }>;
      };
    }): Promise<unknown>;
  };
}

export interface V14DeliveryOpts {
  readonly registry: TaskRegistry;
  readonly client: V14DeliveryClient;
  /**
   * Fallback sessionID for tasks whose `meta.session_id` is absent. The
   * authoritative sessionID is resolved per-task from the spawned task's
   * meta (set at the tool-register execute-time where the real ToolContext
   * sessionID is available). This opts-level value is a last-resort fallback
   * — boot-time placeholders like "session_unknown" should NOT reach the
   * server, because the v1 SDK endpoint /session/{id}/message returns HTML
   * for invalid ids and the SDK explodes at JSON.parse.
   */
  readonly sessionID: string;
  /** Fallback ack timeout in ms (default 2000). */
  readonly ackTimeoutMs?: number;
  readonly logger?: Logger;
}

export interface V14DeliveryCoordinator {
  /** Called when a task transitions to a terminal state. */
  onComplete(event: CompletionEvent): Promise<void>;
  /** Clear any pending fallback timers. Call on session teardown. */
  dispose(): void;
}

const DEFAULT_ACK_TIMEOUT_MS = 2_000;

function formatCompletionText(event: CompletionEvent): string {
  if (event.status === "error") {
    const errMsg =
      (event as unknown as { error_message?: string }).error_message ??
      "unknown error";
    return `[bg-subagents] Task ${event.task_id} errored: ${errMsg}`;
  }
  return `[bg-subagents] Task ${event.task_id} completed.`;
}

export function createV14Delivery(
  opts: V14DeliveryOpts,
): V14DeliveryCoordinator {
  const { registry, client, sessionID: fallbackSessionID, logger } = opts;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Resolve the sessionID to post into:
   *   1. Task's `meta.session_id` (set by tool-register at execute time — the
   *      authoritative real session), OR
   *   2. `opts.sessionID` (fallback, usually a boot-time placeholder).
   */
  function resolveSessionID(taskId: string): string {
    const state = registry.get(taskId as Parameters<typeof registry.get>[0]);
    const metaSessionId = state?.meta["session_id"];
    if (typeof metaSessionId === "string" && metaSessionId.length > 0) {
      return metaSessionId;
    }
    return fallbackSessionID;
  }

  async function onComplete(event: CompletionEvent): Promise<void> {
    const taskId = event.task_id;

    // Dedupe: if another channel / prior call already delivered this
    // task, skip. We pre-check via markDelivered, but rollback if we
    // decide not to deliver. Actual `markDelivered` set happens AFTER
    // primary succeeds — that way a primary failure leaves the id
    // unmarked so a higher-level fallback coordinator can retry via
    // an alternate surface.
    //
    // Concurrent onComplete calls within THIS coordinator are deduped
    // by the local `pending` set.

    if (pending.has(taskId)) {
      logger?.info?.("delivery:already-in-flight", { task_id: taskId });
      return;
    }

    // Pre-check via non-mutating peek. If another path already delivered
    // (or a prior onComplete of the same id), skip.
    if (registry.isDelivered(taskId)) {
      logger?.info?.("delivery:already-delivered", { task_id: taskId });
      return;
    }

    const ackTimer = setTimeout(() => {
      pending.delete(taskId);
      logger?.warn?.("delivery:fallback-timeout", {
        task_id: taskId,
        ack_timeout_ms: opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS,
      });
    }, opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS);
    pending.set(taskId, ackTimer);

    const resolvedSessionID = resolveSessionID(taskId);
    const payload = {
      path: { id: resolvedSessionID },
      body: {
        noReply: true,
        parts: [{ type: "text" as const, text: formatCompletionText(event) }],
      },
    };

    try {
      await client.session.prompt(payload);
      // Success — mark delivered to dedupe against other channels.
      const firstDelivery = registry.markDelivered(taskId);
      if (firstDelivery) {
        logger?.info?.("delivery:primary-delivered", { task_id: taskId });
      } else {
        logger?.info?.("delivery:primary-delivered-lost-race", {
          task_id: taskId,
        });
      }
    } catch (err) {
      // Primary failed — log warn. Leave the id UNMARKED so a higher-
      // level fallback can still retry via an alternate surface.
      logger?.warn?.("delivery:primary-failed", {
        task_id: taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(ackTimer);
      pending.delete(taskId);
    }
  }

  function dispose(): void {
    for (const [, timer] of pending) clearTimeout(timer);
    pending.clear();
  }

  return { onComplete, dispose };
}
