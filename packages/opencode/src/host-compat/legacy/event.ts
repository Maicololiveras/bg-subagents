/**
 * Completion delivery (PRIMARY): `bus.emit({ type: "bg-subagents/task-complete", ... })`.
 *
 * Subscribes to the TaskRegistry's `onComplete` and republishes each
 * terminal state as a typed bus event. If `bus` is absent the subscription
 * no-ops — fallback delivery via chat-message handles that case.
 */
import type { CompletionEvent, Logger, TaskRegistry } from "@maicolextic/bg-subagents-core";

import type { Bus } from "../types.js";

export const TASK_COMPLETE_BUS_EVENT = "bg-subagents/task-complete";

export interface WireBusEventsOpts {
  readonly registry: TaskRegistry;
  readonly bus?: Bus | undefined;
  readonly logger?: Logger;
  /**
   * Optional hook to signal "the bus emitted — fallback should NOT fire".
   * Wired from `plugin.ts` into `chatMessageFallback` so the fallback knows
   * whether to arm its timer.
   */
  readonly onDelivered?: (task_id: string) => void;
}

export interface WireBusEventsHandle {
  unsubscribe(): void;
  busAvailable(): boolean;
}

export function wireBusEvents(opts: WireBusEventsOpts): WireBusEventsHandle {
  const { registry, bus, logger, onDelivered } = opts;
  const busAvailable = bus !== undefined && typeof bus.emit === "function";

  if (!busAvailable) {
    logger?.warn("bus-events:no-bus", {
      reason: "plugin context did not expose a bus.emit — fallback will deliver",
    });
    // Still register an unsub so callers always get a uniform handle shape.
    return {
      unsubscribe: () => undefined,
      busAvailable: () => false,
    };
  }

  const unsub = registry.onComplete((event: CompletionEvent) => {
    const payload: Record<string, unknown> = {
      type: TASK_COMPLETE_BUS_EVENT,
      task_id: event.task_id,
      status: event.status,
      ts: event.ts,
    };
    if (event.result !== undefined) {
      payload["result"] = event.result;
    }
    if (event.error !== undefined) {
      payload["error"] = event.error;
    }
    try {
      const emitResult = bus.emit(payload as { type: string });
      // emit may return a promise; swallow errors asynchronously without
      // blocking the registry callback.
      if (emitResult !== undefined && typeof (emitResult as Promise<unknown>).then === "function") {
        void (emitResult as Promise<unknown>).catch((err: unknown) => {
          logger?.warn("bus-events:emit-failed", {
            task_id: event.task_id,
            err: err instanceof Error ? err.message : String(err),
          });
        });
      }
      onDelivered?.(event.task_id);
      logger?.info("bus-events:delivered", {
        task_id: event.task_id,
        status: event.status,
      });
    } catch (err: unknown) {
      logger?.warn("bus-events:emit-threw", {
        task_id: event.task_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return {
    unsubscribe: unsub,
    busAvailable: () => true,
  };
}
