/**
 * Completion delivery (FALLBACK): synthetic assistant `chat.message`.
 *
 * Subscribes to `TaskRegistry.onComplete` AND exposes a `markDelivered`
 * callback that the primary Bus delivery calls on successful emit. Each
 * completion arms a 2-second ack-timeout; if ack hasn't arrived we inject a
 * synthetic assistant message into the chat transcript via
 * `ctx.session.writeAssistantMessage`.
 *
 * Design Q1: ship both paths, primary wins by default, fallback catches
 * headless / no-bus-subscriber cases.
 */
import type { CompletionEvent, Logger, TaskRegistry } from "@maicolextic/bg-subagents-core";

import type { SessionApi } from "../types.js";

const DEFAULT_ACK_TIMEOUT_MS = 2000;

export interface ChatMessageFallbackOpts {
  readonly registry: TaskRegistry;
  /**
   * Session surface for writing the synthetic assistant message. When absent
   * the fallback logs a warning and skips delivery — plugin initialization
   * should have already noted the gap via `wireBusEvents`.
   */
  readonly session?: SessionApi | undefined;
  /** OpenCode session id to write into. */
  readonly sessionId: string;
  readonly logger?: Logger;
  /**
   * Milliseconds to wait for the primary Bus delivery to ack before falling
   * back. Defaults to 2000. Tests pass a small value.
   */
  readonly ackTimeoutMs?: number;
}

export interface ChatMessageFallbackHandle {
  /** Call from bus-events.ts when primary delivery succeeds. */
  markDelivered(task_id: string): void;
  /** Drop the registry subscription + any pending timers. */
  unsubscribe(): void;
  /** Read-only: number of pending ack windows. Test helper. */
  pendingCount(): number;
  /** Read-only: number of fallback messages injected. Test helper. */
  fallbackCount(): number;
}

export function chatMessageFallback(
  opts: ChatMessageFallbackOpts,
): ChatMessageFallbackHandle {
  const { registry, session, sessionId, logger } = opts;
  const ackTimeoutMs = opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;

  interface Pending {
    readonly timer: ReturnType<typeof setTimeout>;
    readonly registered_at: number;
  }
  const pending = new Map<string, Pending>();
  let fallback_count = 0;

  const unsub = registry.onComplete((event: CompletionEvent) => {
    const timer = setTimeout(() => {
      pending.delete(event.task_id);
      fallback_count += 1;
      deliverFallback(event);
    }, ackTimeoutMs);
    pending.set(event.task_id, {
      timer,
      registered_at: Date.now(),
    });
  });

  function deliverFallback(event: CompletionEvent): void {
    const content = formatFallbackMessage(event);
    if (session?.writeAssistantMessage === undefined) {
      logger?.warn("chat-message-fallback:no-session-writer", {
        task_id: event.task_id,
        content,
      });
      return;
    }
    try {
      const r = session.writeAssistantMessage({
        session_id: sessionId,
        content,
      });
      if (r !== undefined && typeof (r as Promise<void>).then === "function") {
        void (r as Promise<void>).catch((err: unknown) => {
          logger?.warn("chat-message-fallback:write-failed", {
            task_id: event.task_id,
            err: err instanceof Error ? err.message : String(err),
          });
        });
      }
      logger?.info("chat-message-fallback:delivered", {
        task_id: event.task_id,
      });
    } catch (err: unknown) {
      logger?.warn("chat-message-fallback:write-threw", {
        task_id: event.task_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    markDelivered(task_id: string): void {
      const p = pending.get(task_id);
      if (p === undefined) return;
      clearTimeout(p.timer);
      pending.delete(task_id);
      logger?.info("chat-message-fallback:suppressed", { task_id });
    },
    unsubscribe(): void {
      unsub();
      for (const p of pending.values()) {
        clearTimeout(p.timer);
      }
      pending.clear();
    },
    pendingCount(): number {
      return pending.size;
    },
    fallbackCount(): number {
      return fallback_count;
    },
  };
}

function formatFallbackMessage(event: CompletionEvent): string {
  const tag = event.status.toUpperCase();
  return `[bg-subagents] Task ${event.task_id} completed with status ${tag}. Say /task show ${event.task_id} for details.`;
}

export { DEFAULT_ACK_TIMEOUT_MS };
