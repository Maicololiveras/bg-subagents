/**
 * TUI sidebar slot — Phase 12.7 GREEN.
 *
 * Exports:
 *   - `getSidebarData(nowMs?)` — reads SharedPluginState.current() and maps
 *     TaskRegistry entries to SidebarTaskRow[]. Sorting: running tasks first
 *     (most-recently-started), then terminal tasks (most-recently-finished).
 *   - `buildSidebarSlotPlugin(options?)` — returns a TuiSlotPlugin-compatible
 *     object that registers the `sidebar_content` slot.
 *
 * ## Peer-dep strategy (no @opentui/solid at build time)
 *
 * `TuiSlotPlugin` is typed via `@opentui/solid` which is an OPTIONAL peer
 * dependency not installed in this package. We cannot import the type at
 * module-load time without triggering a resolution error.
 *
 * Solution: define a minimal structural interface (`SlotPlugin`) that mirrors
 * the shape required by `TuiSlots.register(plugin)` — specifically the `slots`
 * map. The render function returns `unknown` (opaque JSX element). This is
 * correct at runtime because the TUI host resolves JSX itself; we only need
 * to produce a value the host can consume. Phase 13 integration wires the real
 * JSX renderer once the full TUI entry point is in place.
 *
 * ## Zero stdout guarantee
 *
 * All diagnostics route through `createLogger("tui-plugin:sidebar")`.
 * No `console.log`, `console.error`, or `process.stdout.write` anywhere.
 *
 * ## Polling
 *
 * `buildSidebarSlotPlugin` accepts `pollIntervalMs` (default 1000ms). The slot
 * plugin itself stores the interval; Phase 13 wires `api.lifecycle.onDispose`
 * to clear the interval on shutdown. Until then, the polling config is
 * preserved for the Phase 13 integration to consume.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 12.7
 * Design: design.md ADR-9 + TUI scope (v1.0)
 */

import { createLogger } from "@maicolextic/bg-subagents-core";
import type { TaskState } from "@maicolextic/bg-subagents-core";
import { current } from "./shared-state.js";

// ---------------------------------------------------------------------------
// Logger — file-routed, zero stdout in production
// ---------------------------------------------------------------------------

const log = createLogger("tui-plugin:sidebar");

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SidebarTaskRow {
  /** Task id for display (matches the id from TaskRegistry). */
  id: string;
  /** Agent name extracted from task meta (e.g. "sdd-explore"). */
  agentName: string;
  /** Execution mode from task meta. Defaults to "bg" when absent. */
  mode: "bg" | "fg";
  /** Simplified status: "running" | "done" | "failed". */
  status: "running" | "done" | "failed";
  /**
   * For running tasks: nowMs - started_at.
   * For terminal tasks: completed_at - started_at (fixed at finish time).
   */
  elapsedMs: number;
  /**
   * Present only for terminal tasks: the timestamp when the task finished.
   * Used for sorting terminal tasks most-recently-finished first.
   */
  finishedAtMs?: number;
}

export interface SidebarData {
  tasks: SidebarTaskRow[];
}

export interface BuildSidebarOptions {
  /** Polling interval in ms. Default: 1000. */
  pollIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Minimal SlotPlugin structural interface
//
// Mirrors the shape expected by TuiSlots.register(plugin) without importing
// @opentui/solid (optional peer dep). The `slots` map keys must match
// TuiHostSlotMap slot names; values are render functions returning JSX (typed
// as `unknown` here — the host resolves the real JSX type at runtime).
//
// Phase 13 integration will use the real TuiSlotPlugin type from
// "@opencode-ai/plugin/tui" when wiring the full TUI entry point.
// ---------------------------------------------------------------------------

type SlotRenderFn<Context extends object = object> = (ctx: Context) => unknown;

/** Structural interface for the sidebar_content slot context (per TuiHostSlotMap). */
type SidebarSlotContext = {
  session_id: string;
};

export interface SlotPlugin {
  /** No id field — matches TuiSlotPlugin<{}> contract: id?: never */
  readonly slots: {
    sidebar_content: SlotRenderFn<SidebarSlotContext>;
    [key: string]: SlotRenderFn;
  };
  /** Polling interval stored for Phase 13 lifecycle wiring. */
  readonly pollIntervalMs: number;
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

type SidebarStatus = SidebarTaskRow["status"];

function mapStatus(taskStatus: string): SidebarStatus {
  if (taskStatus === "running" || taskStatus === "passthrough") {
    return "running";
  }
  if (taskStatus === "completed") {
    return "done";
  }
  // error, killed, killed_on_disconnect, cancelled, rejected_limit → failed
  return "failed";
}

// ---------------------------------------------------------------------------
// getSidebarData
// ---------------------------------------------------------------------------

/**
 * Read SharedPluginState.current() and map the task registry to SidebarData.
 *
 * @param nowMs - Current timestamp in ms. Defaults to Date.now(). Injected for
 *                testability — production code passes no argument.
 */
export function getSidebarData(nowMs: number = Date.now()): SidebarData {
  const state = current();

  if (state === undefined) {
    log.debug("getSidebarData: SharedPluginState not yet registered — returning empty");
    return { tasks: [] };
  }

  const allTasks = state.registry.list();

  if (allTasks.length === 0) {
    return { tasks: [] };
  }

  const rows: SidebarTaskRow[] = allTasks.map((task: TaskState) => {
    const agentName =
      typeof task.meta["agent_name"] === "string" ? task.meta["agent_name"] : "";

    const rawMode = task.meta["mode"];
    const mode: "bg" | "fg" = rawMode === "fg" ? "fg" : "bg";

    const status = mapStatus(task.status);

    const isTerminal = status !== "running";
    const finishedAtMs = isTerminal ? task.completed_at : undefined;
    const elapsedMs = isTerminal
      ? (task.completed_at ?? task.started_at) - task.started_at
      : nowMs - task.started_at;

    const row: SidebarTaskRow = {
      id: task.id,
      agentName,
      mode,
      status,
      elapsedMs: Math.max(0, elapsedMs),
    };

    if (finishedAtMs !== undefined) {
      row.finishedAtMs = finishedAtMs;
    }

    return row;
  });

  // Sort: running first (most-recently-started desc), then terminal (most-recently-finished desc)
  rows.sort((a, b) => {
    const aRunning = a.status === "running";
    const bRunning = b.status === "running";

    if (aRunning && !bRunning) return -1;
    if (!aRunning && bRunning) return 1;

    if (aRunning && bRunning) {
      // Both running: most-recently-started first (largest started_at first)
      // We compute started_at = nowMs - elapsedMs for running tasks
      const aStarted = nowMs - a.elapsedMs;
      const bStarted = nowMs - b.elapsedMs;
      return bStarted - aStarted;
    }

    // Both terminal: most-recently-finished first
    const aFinished = a.finishedAtMs ?? 0;
    const bFinished = b.finishedAtMs ?? 0;
    return bFinished - aFinished;
  });

  return { tasks: rows };
}

// ---------------------------------------------------------------------------
// buildSidebarSlotPlugin
// ---------------------------------------------------------------------------

/**
 * Build a TUI slot plugin that registers the `sidebar_content` slot.
 *
 * The returned object is structurally compatible with `TuiSlotPlugin<{}>` from
 * "@opencode-ai/plugin/tui". The `id` field is intentionally absent per the
 * `TuiSlotPlugin` contract (`id?: never`).
 *
 * The `slots.sidebar_content` render function returns a plain object describing
 * the current sidebar data. Phase 13 integration upgrades this to a real
 * SolidJS JSX element when the full TUI entry point is wired.
 *
 * TODO (Phase 13): Replace the render body with a real SolidJS component.
 * The render function signature and slot registration are correct as-is.
 *
 * @param options - Optional configuration ({ pollIntervalMs }).
 */
export function buildSidebarSlotPlugin(
  options?: BuildSidebarOptions,
): SlotPlugin {
  const pollIntervalMs = options?.pollIntervalMs ?? 1_000;

  log.debug("buildSidebarSlotPlugin: creating sidebar slot plugin", {
    pollIntervalMs,
  });

  /**
   * Render function for the sidebar_content slot.
   *
   * Called by the TUI host whenever the slot is rendered. Returns the current
   * sidebar data as a plain object. Phase 13 upgrades this to JSX.
   *
   * @param ctx - Slot context from TuiHostSlotMap.sidebar_content: { session_id }
   */
  function renderSidebarContent(ctx: SidebarSlotContext): unknown {
    const data = getSidebarData();

    log.debug("sidebar_content render", {
      session_id: ctx.session_id,
      task_count: data.tasks.length,
    });

    // Phase 13 TODO: Replace this with a real SolidJS <For> component.
    // For now, return the plain data object — the host will receive it and
    // Phase 13 integration will inject the JSX renderer.
    return data;
  }

  return {
    slots: {
      sidebar_content: renderSidebarContent,
    },
    pollIntervalMs,
  };
}
