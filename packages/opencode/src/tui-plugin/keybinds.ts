/**
 * TUI plugin keybinds — Phase 13.5 GREEN.
 *
 * Registers TUI keyboard shortcuts via `api.command.register`:
 *   - Ctrl+B  → Focus BG task  (opens dialog showing BG tasks, or toast if none)
 *   - Ctrl+F  → Focus FG task  (opens dialog showing FG tasks, or toast if none)
 *   - ↓/down  → Open task panel (opens dialog showing ALL tasks, or toast if none)
 *
 * ## ADR-9 scope
 *
 * Per ADR-9 v1.0, keybinds are the interactive TUI surface for bg-subagents.
 * They complement the server-side slash commands (Phase 12) and the sidebar
 * (Phase 12.7): slash commands are non-interactive text, sidebar is read-only,
 * keybinds open modal dialogs for focused interaction.
 *
 * ## Zero stdout guarantee
 *
 * All diagnostics route through `createLogger("tui-plugin:keybinds")`.
 * No `console.log`, `console.error`, or `process.stdout.write` anywhere in
 * this file.
 *
 * ## SharedPluginState guard
 *
 * If SharedPluginState.current() returns undefined at the time an onSelect
 * handler fires (server plugin not yet booted), all handlers show a toast
 * with message "bg-subagents not ready yet" and do NOT call dialog.replace.
 * This matches the graceful degradation pattern from index.ts Phase 13.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 13.5
 * Design: design.md ADR-9 keybind scope (Ctrl+B, Ctrl+F, ↓)
 */

import { createLogger } from "@maicolextic/bg-subagents-core";
import type { TuiPluginApi, TuiCommand } from "@opencode-ai/plugin/tui";
import { current } from "./shared-state.js";
import type { SidebarTaskRow } from "./sidebar.js";
import { getSidebarData } from "./sidebar.js";

// ---------------------------------------------------------------------------
// Logger — file-routed, zero stdout in production
// ---------------------------------------------------------------------------

const logger = createLogger("tui-plugin:keybinds");

// ---------------------------------------------------------------------------
// NOT_READY_MESSAGE — shown when server plugin hasn't registered state yet
// ---------------------------------------------------------------------------

const NOT_READY_MESSAGE = "bg-subagents not ready yet";

// ---------------------------------------------------------------------------
// Internal helpers — not exported, JSDoc for maintainability
// ---------------------------------------------------------------------------

/**
 * Format a task row for display in a dialog select option title.
 * Format: "[bg] sdd-explore (running, 12s)" or "[fg] sdd-apply (done, 3s)"
 */
function formatTaskTitle(row: SidebarTaskRow): string {
  const mode = `[${row.mode}]`;
  const agent = row.agentName || row.id;
  const elapsed = Math.round(row.elapsedMs / 1000);
  return `${mode} ${agent} (${row.status}, ${elapsed}s)`;
}

/**
 * Open a TUI dialog showing a filtered set of task rows.
 * Called by focusBgTask and focusFgTask.
 *
 * @param api    - TuiPluginApi with ui.dialog.replace and ui.DialogSelect.
 * @param tasks  - The pre-filtered list of SidebarTaskRow to show.
 * @param title  - Dialog title string.
 */
function openTaskDialog(
  api: TuiPluginApi,
  tasks: SidebarTaskRow[],
  title: string,
): void {
  logger.debug("openTaskDialog: opening dialog", { title, task_count: tasks.length });

  const options = tasks.map((row) => ({
    title: formatTaskTitle(row),
    value: row.id,
    description: row.id,
  }));

  api.ui.dialog.replace(
    () =>
      api.ui.DialogSelect({
        title,
        options,
        onSelect: (_option) => {
          api.ui.dialog.clear();
        },
      }),
    () => {
      logger.debug("openTaskDialog: dialog closed", { title });
    },
  );
}

/**
 * Focus the most-recent running BG task.
 * If no BG task is running → toast info "No background tasks running".
 * If state undefined → toast "bg-subagents not ready yet".
 */
function focusBgTask(api: TuiPluginApi): void {
  const state = current();

  if (!state) {
    logger.debug("focusBgTask: SharedPluginState not available");
    api.ui.toast({ variant: "info", message: NOT_READY_MESSAGE });
    return;
  }

  const { tasks } = getSidebarData();
  const bgRunning = tasks.filter((t) => t.mode === "bg" && t.status === "running");

  if (bgRunning.length === 0) {
    logger.debug("focusBgTask: no BG tasks running");
    api.ui.toast({ variant: "info", message: "No background tasks running" });
    return;
  }

  openTaskDialog(api, bgRunning, "Background Tasks");
}

/**
 * Focus the most-recent running FG task.
 * If no FG task is running → toast info "No foreground tasks running".
 * If state undefined → toast "bg-subagents not ready yet".
 */
function focusFgTask(api: TuiPluginApi): void {
  const state = current();

  if (!state) {
    logger.debug("focusFgTask: SharedPluginState not available");
    api.ui.toast({ variant: "info", message: NOT_READY_MESSAGE });
    return;
  }

  const { tasks } = getSidebarData();
  const fgRunning = tasks.filter((t) => t.mode === "fg" && t.status === "running");

  if (fgRunning.length === 0) {
    logger.debug("focusFgTask: no FG tasks running");
    api.ui.toast({ variant: "info", message: "No foreground tasks running" });
    return;
  }

  openTaskDialog(api, fgRunning, "Foreground Tasks");
}

/**
 * Open the task management panel showing ALL tasks (BG + FG, most-recent first).
 * If registry is empty → toast info "No tasks running".
 * If state undefined → toast "bg-subagents not ready yet".
 */
function openTaskPanel(api: TuiPluginApi): void {
  const state = current();

  if (!state) {
    logger.debug("openTaskPanel: SharedPluginState not available");
    api.ui.toast({ variant: "info", message: NOT_READY_MESSAGE });
    return;
  }

  const { tasks } = getSidebarData();

  if (tasks.length === 0) {
    logger.debug("openTaskPanel: no tasks in registry");
    api.ui.toast({ variant: "info", message: "No tasks running" });
    return;
  }

  openTaskDialog(api, tasks, "All Tasks");
}

/**
 * Build the static TuiCommand array for this plugin.
 * Each command has a keybind and an onSelect handler.
 *
 * Returns 3 commands:
 *   - "Focus BG task"  keybind: "ctrl+b"
 *   - "Focus FG task"  keybind: "ctrl+f"
 *   - "Open task panel" keybind: "down"
 */
function buildTaskCommands(api: TuiPluginApi): TuiCommand[] {
  return [
    {
      title: "Focus BG task",
      value: "bg-subagents:focus-bg",
      keybind: "ctrl+b",
      onSelect: () => focusBgTask(api),
    },
    {
      title: "Focus FG task",
      value: "bg-subagents:focus-fg",
      keybind: "ctrl+f",
      onSelect: () => focusFgTask(api),
    },
    {
      title: "Open task panel",
      value: "bg-subagents:open-panel",
      keybind: "down",
      onSelect: () => openTaskPanel(api),
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register TUI keybind commands via api.command.register.
 *
 * Call this from the TUI plugin boot function (tui-plugin/index.ts) after
 * api.slots.register and before any lifecycle.onDispose wiring.
 *
 * Registers a single command provider callback that returns 3 TuiCommand entries.
 * The callback is called lazily by the TUI host on demand.
 *
 * @param api - TuiPluginApi instance provided by the TUI runtime.
 */
export function registerKeybinds(api: TuiPluginApi): void {
  logger.debug("registerKeybinds: registering 3 keybind commands");

  api.command.register(() => buildTaskCommands(api));

  logger.info("registerKeybinds: registered ctrl+b, ctrl+f, down keybinds");
}
