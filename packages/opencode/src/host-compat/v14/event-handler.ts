/**
 * v14 `event` hook handler.
 *
 * The v14 plugin API surfaces an `event` hook whose `input.event` is the
 * SDK's `Event` discriminated union — every session/message/tool/TUI
 * transition flows through it. The vast majority are noise to us: LSP
 * updates, file watcher pings, TUI toasts. This handler logs only the
 * session lifecycle events that are useful for diagnostics and silently
 * ignores the rest.
 *
 * NOTE — completion delivery is NOT routed through this hook. Task
 * completions bubble up from `TaskRegistry.onComplete` (wired in
 * `buildV14Hooks`) to the `DeliveryCoordinator`. The event hook is a
 * pure read-only observability surface.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/host-compat/spec.md
 */

import type { Logger } from "@maicolextic/bg-subagents-core";

export interface V14EventHandlerOpts {
  readonly logger: Logger;
}

export type V14EventHandler = (input: {
  event: { type: string; properties?: unknown };
}) => Promise<void>;

const INFO_EVENT_TYPES: ReadonlySet<string> = new Set([
  "session.idle",
  "session.created",
  "session.compacted",
  "session.deleted",
]);

const WARN_EVENT_TYPES: ReadonlySet<string> = new Set(["session.error"]);

export function buildV14EventHandler(
  opts: V14EventHandlerOpts,
): V14EventHandler {
  return async function handle({ event }) {
    const type = event.type;
    if (INFO_EVENT_TYPES.has(type)) {
      opts.logger.info("v14-event", {
        event_type: type,
        properties: event.properties,
      });
      return;
    }
    if (WARN_EVENT_TYPES.has(type)) {
      opts.logger.warn("v14-event", {
        event_type: type,
        properties: event.properties,
      });
    }
  };
}
