/**
 * @maicolextic/bg-subagents-control-tui — TUI entry point (v0.6)
 *
 * Active control panel for subagent delegation:
 *   - Ctrl+P → "Edit agent policies…" → 2-step DialogSelect cycle (BG/FG/Default)
 *   - Ctrl+Shift+P → direct shortcut to the policy editor dialog
 *   - Ctrl+P → ACTIVE TASKS (live, dynamic) — move FG→BG, kill, view
 *   - Sidebar widget: shows active tasks live + policy state
 *   - Persistence via api.kv + ~/.config/bg-subagents/policy.jsonc (server bridge)
 *   - Server plugin steers the LLM via tool.definition hook (task ↔ task_bg)
 *
 * Mid-flight FG→BG conversion:
 *   1. orchestrator calls native `task` tool → child session created
 *   2. TUI plugin detects via session.created event → tracks as running
 *   3. user opens Ctrl+P, picks "Move <agent> to BG"
 *   4. abort child → orchestrator's task call returns → parent UNBLOCKS
 *   5. spawn new child + promptAsync → true BG dispatch
 *   6. on session.idle → deliver to parent via prompt({noReply})
 *
 * Net: orchestrator's blocking delegation is converted into async dispatch
 * mid-flight, without touching server-side hooks.
 */

import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui";
import { createLogger } from "@maicolextic/bg-subagents-core";
import { createSignal, createMemo, For, Show, onCleanup } from "solid-js";
import { AGENTS, AGENTS_BY_CATEGORY } from "./agents.js";
import {
  writePolicyFile,
  readPolicyFile,
  POLICY_PATH,
  type Mode,
} from "./policy-writer.js";
import {
  createTaskRegistry,
  subscribeToSessionEvents,
  type ActiveTask,
} from "./events.js";
import { moveTaskToBg, killTask, deliverBgResult } from "./actions.js";

const PLUGIN_ID = "bg-subagents-control-tui";
const SIDEBAR_ORDER = 80;
const KV_KEY_PREFIX = "bg-subagents.policy";

const logger = createLogger("control-tui:boot");

const MODES = ["bg", "fg", "default"] as const;

const MODE_LABEL: Record<Mode, string> = {
  bg: "Background",
  fg: "Foreground (blocking)",
  default: "Default (per agent)",
};

const MODE_ICON: Record<Mode, string> = {
  bg: "🟦",
  fg: "🟧",
  default: "⚪",
};

const STATUS_ICON: Record<ActiveTask["status"], string> = {
  running: "🔄",
  done: "✓",
  error: "✗",
  cancelled: "⊘",
  "bg-detached": "🟦",
};

// ---------------------------------------------------------------------------
// Sidebar widget
// ---------------------------------------------------------------------------

interface WidgetProps {
  policies: () => Record<string, Mode>;
  activeTasks: () => readonly ActiveTask[];
  onTaskRightClick: (task: ActiveTask) => void;
  sessionID?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any;
}

interface SessionTokens {
  input: number;
  output: number;
  reasoning: number;
  cache_read: number;
  cache_write: number;
  cost: number;
}

function sumSessionTokens(messages: readonly unknown[] | undefined): SessionTokens {
  const totals: SessionTokens = {
    input: 0,
    output: 0,
    reasoning: 0,
    cache_read: 0,
    cache_write: 0,
    cost: 0,
  };
  if (!Array.isArray(messages)) return totals;
  for (const m of messages) {
    const info = (m as { info?: { role?: string; tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }; cost?: number } })?.info;
    if (info?.role !== "assistant") continue;
    const t = info.tokens;
    if (!t) continue;
    totals.input += t.input ?? 0;
    totals.output += t.output ?? 0;
    totals.reasoning += t.reasoning ?? 0;
    totals.cache_read += t.cache?.read ?? 0;
    totals.cache_write += t.cache?.write ?? 0;
    totals.cost += info.cost ?? 0;
  }
  return totals;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(2)}M`;
}

function SidebarWidget(props: WidgetProps) {
  // 1-second tick — drives live elapsed counters on every running task.
  // onCleanup ensures the interval stops if the slot unmounts.
  const [now, setNow] = createSignal(Date.now());
  const tickHandle = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tickHandle));

  const policySummary = createMemo(() => {
    const counts: Record<Mode, number> = { bg: 0, fg: 0, default: 0 };
    for (const agent of AGENTS) {
      const mode = props.policies()[agent.name] ?? "default";
      counts[mode]++;
    }
    return counts;
  });

  const liveTasks = createMemo(() =>
    props.activeTasks().filter((t) => t.status === "running"),
  );

  // Token usage — read from api.state.session.messages(sessionID).
  // Depends on now() so we re-fetch every second; this is cheap for a sidebar
  // and guarantees freshness even if the state accessor isn't Solid-reactive.
  const tokenStats = createMemo<SessionTokens>(() => {
    now(); // subscribe to tick for periodic refresh
    const sid = props.sessionID;
    if (!sid) return { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost: 0 };
    try {
      const msgs = props.api?.state?.session?.messages?.(sid);
      return sumSessionTokens(msgs);
    } catch {
      return { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost: 0 };
    }
  });

  function elapsed(started: number): string {
    // now() makes this reactive — re-renders every second via the tick signal.
    const sec = Math.floor((now() - started) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m${(sec % 60).toString().padStart(2, "0")}`;
  }

  return (
    <box flexDirection="column" padding={1} borderStyle="single">
      <text bold>⚙ bg-control</text>

      {/* Active tasks (live tracking) — right-click for context menu */}
      <Show when={liveTasks().length > 0}>
        <text dim>── active (right-click) ──</text>
        <For each={liveTasks()}>
          {(task) => (
            <box
              onMouseDown={(e: { button: number; preventDefault?: () => void }) => {
                // Right button (2) opens context menu; left passes through.
                if (e.button === 2) {
                  e.preventDefault?.();
                  props.onTaskRightClick(task);
                }
              }}
            >
              <text>
                {STATUS_ICON[task.status]} {task.agent} {elapsed(task.started)}
              </text>
            </box>
          )}
        </For>
      </Show>

      {/* Policy summary */}
      <text dim>── policy ──</text>
      <box flexDirection="row" gap={1}>
        <text>{MODE_ICON.bg} {policySummary().bg}</text>
        <text>{MODE_ICON.fg} {policySummary().fg}</text>
        <text>{MODE_ICON.default} {policySummary().default}</text>
      </box>

      {/* Token usage — live, focused on output (what the model produced) */}
      <Show when={props.sessionID}>
        <text dim>── tokens (out / in) ──</text>
        <box flexDirection="row" gap={1}>
          <text>↓ {formatTokens(tokenStats().output)}</text>
          <text dim>↑ {formatTokens(tokenStats().input)}</text>
        </box>
        <Show when={tokenStats().reasoning > 0}>
          <text dim>🧠 reasoning {formatTokens(tokenStats().reasoning)}</text>
        </Show>
        <Show when={tokenStats().cache_read + tokenStats().cache_write > 0}>
          <text dim>
            💾 cache r:{formatTokens(tokenStats().cache_read)} w:{formatTokens(tokenStats().cache_write)}
          </text>
        </Show>
      </Show>

      <text dim>↑ ctrl+p → "bg-control"</text>
    </box>
  );
}

// ---------------------------------------------------------------------------
// TUI plugin function
// ---------------------------------------------------------------------------

const Tui: TuiPlugin = async (api: TuiPluginApi) => {
  logger.info("control-tui v0.6 boot starting", { plugin_id: PLUGIN_ID });

  // ---------------------------------------------------------------------------
  // 1. Hydrate default policies (Ctrl+P configurable)
  // ---------------------------------------------------------------------------
  const fromFile = readPolicyFile();
  const initial: Record<string, Mode> = {};
  for (const agent of AGENTS) {
    if (fromFile[agent.name]) {
      initial[agent.name] = fromFile[agent.name];
    } else {
      const stored = (api as { kv?: { get?: (key: string) => unknown } }).kv?.get?.(
        `${KV_KEY_PREFIX}.${agent.name}`,
      );
      initial[agent.name] =
        stored === "bg" || stored === "fg" || stored === "default"
          ? stored
          : "default";
    }
  }
  const [policies, setPolicies] = createSignal(initial);

  try {
    writePolicyFile(initial);
  } catch (err) {
    logger.warn("policy file write failed", { error: String(err) });
  }

  // ---------------------------------------------------------------------------
  // 2. Live task registry (Ctrl+M area)
  // ---------------------------------------------------------------------------
  const registry = createTaskRegistry();

  // Subscribe to OpenCode session events
  const actionLogger = {
    info: (msg: string, fields?: Record<string, unknown>) =>
      logger.info(msg, fields),
    warn: (msg: string, fields?: Record<string, unknown>) =>
      logger.warn(msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) =>
      logger.error(msg, fields),
  };

  // Anti-loop tracking: parents whose tasks we recently auto-flipped.
  // Without this, the new BG child we create also fires session.created → would
  // trigger auto-flip again → infinite loop (observed: 53 cascading completions).
  const recentlyFlippedParents = new Map<string, number>();
  const ANTI_LOOP_WINDOW_MS = 30_000;

  const disposeEvents = subscribeToSessionEvents({
    api,
    registry,
    logger: actionLogger,
    onChildCreated: async (task) => {
      // AUTO-FLIP: when the orchestrator delegates to a BG-policy agent via
      // the synchronous `task` tool, immediately convert it to async by
      // aborting + respawning with task_bg. Plugin-side deterministic — does
      // NOT depend on the LLM choosing task_bg.
      const mode = policies()[task.agent];
      if (mode !== "bg") {
        logger.info("auto-flip: agent not BG-policy, skipping", {
          agent: task.agent,
          mode: mode ?? "default",
        });
        return;
      }

      // Anti-loop guard: skip if this parent was auto-flipped in the last
      // 30s. This blocks the cascade where moveTaskToBg's own session.create
      // fires session.created → triggers another auto-flip.
      const parentID = task.parentSessionID;
      if (parentID) {
        const lastFlip = recentlyFlippedParents.get(parentID);
        if (lastFlip && Date.now() - lastFlip < ANTI_LOOP_WINDOW_MS) {
          logger.info("auto-flip: skipping (parent recently flipped)", {
            agent: task.agent,
            parent: parentID,
            ms_since_last: Date.now() - lastFlip,
          });
          return;
        }
      }

      logger.info("auto-flip: agent is BG-policy, scheduling move-to-BG", {
        agent: task.agent,
        child: task.childSessionID,
      });
      // ~2s gives the orchestrator time to inject the prompt as the child's
      // first user message. Then moveTaskToBg can recover it via session.messages.
      setTimeout(() => {
        // Mark parent BEFORE calling moveTaskToBg so the respawned child's
        // session.created event sees the recent-flip mark and is skipped.
        if (parentID) recentlyFlippedParents.set(parentID, Date.now());
        void moveTaskToBg({ api, registry, logger: actionLogger }, task).then(
          (result) => {
            if (!result.ok) {
              logger.warn("auto-flip: moveTaskToBg failed", {
                agent: task.agent,
                error: result.error,
              });
              // Allow retry on next delegation if we failed
              if (parentID) recentlyFlippedParents.delete(parentID);
            } else {
              logger.info("auto-flip: success — orchestrator unblocked", {
                agent: task.agent,
                new_child: result.newChildID,
              });
            }
          },
        );
      }, 2000);
    },
    onChildIdle: async (task) => {
      // Only auto-deliver for BG-detached tasks (we own the dispatch)
      if (task.status === "bg-detached" || task.newChildSessionID) {
        await deliverBgResult({ api, registry, logger: actionLogger }, task);
      }
    },
  });

  // ---------------------------------------------------------------------------
  // 3. Policy setters (Ctrl+P actions)
  // ---------------------------------------------------------------------------
  const setAgentPolicy = (agentName: string, mode: Mode) => {
    const next = { ...policies(), [agentName]: mode };
    setPolicies(next);
    (api as { kv?: { set?: (k: string, v: string) => void } }).kv?.set?.(
      `${KV_KEY_PREFIX}.${agentName}`,
      mode,
    );
    try {
      writePolicyFile(next);
    } catch (err) {
      logger.warn("policy file write failed", { error: String(err) });
    }
    api.ui?.toast?.({
      variant: "info",
      title: "bg-control",
      message: `${agentName} → ${MODE_LABEL[mode]}`,
    });
  };

  // ---------------------------------------------------------------------------
  // 3b. Policy Editor — interactive 2-step dialog (DialogSelect cycle)
  //
  //     Step 1: pick agent (20 entries with category + current mode shown)
  //     Step 2: pick mode for selected agent (BG / FG / Default)
  //     Step 3: persist + toast + reopen step 1 (so user can edit several)
  //
  //     Esc cancels at any step; dialog.clear() resets.
  // ---------------------------------------------------------------------------
  const openPolicyEditor = () => {
    const dialog = (api.ui as { dialog?: { replace: (r: () => unknown, onClose?: () => void) => void; clear: () => void } }).dialog;
    const DialogSelect = (api.ui as { DialogSelect?: <V>(p: unknown) => unknown }).DialogSelect;
    if (!dialog || !DialogSelect) {
      api.ui?.toast?.({
        variant: "warning",
        title: "bg-control",
        message: "DialogSelect not available — fallback to command palette entries",
      });
      return;
    }

    const renderModeStep = (agentName: string) => {
      const currentMode = policies()[agentName] ?? "default";
      logger.info("policy editor: opening mode step", { agentName, currentMode });
      const options = MODES.map((mode) => ({
        title: `${currentMode === mode ? "✓ " : "  "}${MODE_ICON[mode]} ${MODE_LABEL[mode]}`,
        value: mode as string,
        description:
          mode === "bg"
            ? "Auto-dispatch via task_bg — orchestrator never blocks"
            : mode === "fg"
              ? "Block parent in task tool — synchronous result"
              : "Use OpenCode default behavior (no policy override)",
      }));

      dialog.replace(
        () =>
          DialogSelect({
            title: `Policy for "${agentName}"`,
            options,
            onSelect: (opt: { value: string }) => {
              logger.info("policy editor: mode picked", {
                agentName,
                mode: opt.value,
              });
              setAgentPolicy(agentName, opt.value as Mode);
              // Loop back to agent picker so user can keep editing.
              // Only Esc closes the editor entirely.
              renderAgentStep();
            },
          }),
        () => {
          logger.info("policy editor: mode step closed (esc)");
        },
      );
    };

    const renderAgentStep = () => {
      logger.info("policy editor: opening agent step");
      const options = AGENTS.map((agent) => {
        const mode = policies()[agent.name] ?? "default";
        return {
          title: `${MODE_ICON[mode]} ${agent.name}`,
          value: agent.name,
          description: `${MODE_LABEL[mode]} · ${agent.description ?? agent.category}`,
          category: agent.category,
        };
      });

      dialog.replace(
        () =>
          DialogSelect({
            title: "bg-control · Edit agent policy",
            options,
            onSelect: (opt: { value: string }) => {
              logger.info("policy editor: agent picked", { agent: opt.value });
              renderModeStep(opt.value);
            },
          }),
        () => {
          logger.info("policy editor: agent step closed (esc)");
        },
      );
    };

    renderAgentStep();
  };

  // ---------------------------------------------------------------------------
  // 3c. Task Context Menu — opened by right-click on a task line in the sidebar
  //
  //     Options depend on task.status:
  //       running       → Move to BG · Kill · Dismiss
  //       bg-detached   → Kill · Dismiss   (already async, can't move)
  //       done / error  → Dismiss          (just clears from registry)
  //
  //     Esc cancels.
  // ---------------------------------------------------------------------------
  const openTaskMenu = (task: ActiveTask) => {
    const dialog = (api.ui as { dialog?: { replace: (r: () => unknown, onClose?: () => void) => void; clear: () => void } }).dialog;
    const DialogSelect = (api.ui as { DialogSelect?: <V>(p: unknown) => unknown }).DialogSelect;
    if (!dialog || !DialogSelect) {
      api.ui?.toast?.({
        variant: "warning",
        title: "bg-control",
        message: "Context menu unavailable — use Ctrl+P to manage this task",
      });
      return;
    }

    const ctx = { api, registry, logger: actionLogger };
    const elapsedSec = Math.floor((Date.now() - task.started) / 1000);

    interface MenuAction {
      action: "move-bg" | "kill" | "dismiss";
      title: string;
      description: string;
    }
    const actions: MenuAction[] = [];

    if (task.status === "running") {
      actions.push({
        action: "move-bg",
        title: "🟧→🟦  Move to Background",
        description: "Abort + respawn so orchestrator unblocks immediately",
      });
    }
    if (task.status === "running" || task.status === "bg-detached") {
      actions.push({
        action: "kill",
        title: "✗  Kill task",
        description: "Abort the child session — no replacement",
      });
    }
    actions.push({
      action: "dismiss",
      title: "⊘  Dismiss from sidebar",
      description: "Remove this entry from the active list (does not abort)",
    });

    logger.info("task menu: opening", {
      agent: task.agent,
      status: task.status,
      actions: actions.length,
    });

    dialog.replace(
      () =>
        DialogSelect({
          title: `${task.agent} · ${elapsedSec}s · ${task.status}`,
          options: actions.map((a) => ({
            title: a.title,
            value: a.action,
            description: a.description,
          })),
          onSelect: (opt: { value: string }) => {
            logger.info("task menu: action picked", {
              agent: task.agent,
              action: opt.value,
            });
            dialog.clear();
            if (opt.value === "move-bg") {
              void moveTaskToBg(ctx, task).then((r) => {
                if (!r.ok) {
                  api.ui?.toast?.({
                    variant: "error",
                    title: "bg-control",
                    message: `Move to BG failed: ${r.error}`,
                  });
                }
              });
            } else if (opt.value === "kill") {
              void killTask(ctx, task);
            } else if (opt.value === "dismiss") {
              registry.removeTask(task.childSessionID);
            }
          },
        }),
      () => {
        logger.info("task menu: closed (esc)");
      },
    );
  };

  const applyToAll = (mode: Mode, label: string) => {
    const next: Record<string, Mode> = {};
    for (const agent of AGENTS) {
      next[agent.name] = mode;
      (api as { kv?: { set?: (k: string, v: string) => void } }).kv?.set?.(
        `${KV_KEY_PREFIX}.${agent.name}`,
        mode,
      );
    }
    setPolicies(next);
    try {
      writePolicyFile(next);
    } catch (err) {
      logger.warn("batch file write failed", { error: String(err) });
    }
    api.ui?.toast?.({
      variant: "success",
      title: "bg-control",
      message: label,
    });
  };

  // ---------------------------------------------------------------------------
  // 4. Sidebar slot
  // ---------------------------------------------------------------------------
  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content(slotProps: { session_id?: string }) {
        return (
          <SidebarWidget
            policies={policies}
            activeTasks={registry.tasks}
            onTaskRightClick={openTaskMenu}
            sessionID={slotProps?.session_id}
            api={api}
          />
        );
      },
    },
  } as never);

  // ---------------------------------------------------------------------------
  // 5. Command palette — STATIC (policies) + DYNAMIC (active tasks)
  // ---------------------------------------------------------------------------
  const commandDispose = api.command.register(() => {
    const cmds: Array<{
      title: string;
      value: string;
      description?: string;
      category: string;
      keybind?: string;
      onSelect: () => void;
    }> = [];

    // === ACTIVE TASKS (dynamic, generated from registry) ===
    const tasks = registry.tasks().filter((t) => t.status === "running");
    for (const task of tasks) {
      const elapsedSec = Math.floor((Date.now() - task.started) / 1000);
      const desc = task.description ?? "Active subagent task";

      cmds.push({
        title: `🟧→🟦 Move "${task.agent}" to BG (${elapsedSec}s elapsed)`,
        value: `bg-control.task.move-bg.${task.childSessionID}`,
        description: `Abort and respawn in true background — orchestrator unblocks. ${desc}`,
        category: "bg-control · ⚡ Active Tasks (Ctrl+M)",
        onSelect: () => {
          void moveTaskToBg(
            { api, registry, logger: actionLogger },
            task,
          ).then((result) => {
            if (!result.ok) {
              api.ui?.toast?.({
                variant: "error",
                title: "bg-control",
                message: `Move to BG failed: ${result.error}`,
              });
            }
          });
        },
      });

      cmds.push({
        title: `✗ Kill "${task.agent}" (${elapsedSec}s elapsed)`,
        value: `bg-control.task.kill.${task.childSessionID}`,
        description: `Abort the child session — no replacement. ${desc}`,
        category: "bg-control · ⚡ Active Tasks (Ctrl+M)",
        onSelect: () => {
          void killTask({ api, registry, logger: actionLogger }, task);
        },
      });
    }

    // Helper: open task list info if no tasks are running
    if (tasks.length === 0) {
      cmds.push({
        title: "ℹ No active subagent tasks",
        value: "bg-control.task.empty",
        description:
          "When the orchestrator delegates tasks, they will appear here for live management.",
        category: "bg-control · ⚡ Active Tasks (Ctrl+M)",
        onSelect: () => {
          api.ui?.toast?.({
            variant: "info",
            title: "bg-control",
            message:
              "No active tasks — delegate via orchestrator first, then come back here",
          });
        },
      });
    }

    // === Policy Editor — single entry that opens DialogSelect cycle ===
    cmds.push({
      title: "🎛  Edit agent policies… (interactive)",
      value: "bg-control.policy.edit",
      description:
        "Open a 2-step dialog to set BG/FG/Default per agent — replaces 60+ palette entries with one filterable picker",
      category: "bg-control · 🎛 Policy editor",
      keybind: "ctrl+shift+p",
      onSelect: () => openPolicyEditor(),
    });

    // === STATIC: Batch ops ===
    for (const category of Object.keys(AGENTS_BY_CATEGORY)) {
      for (const mode of MODES) {
        cmds.push({
          title: `${MODE_ICON[mode]} ALL ${category} → ${MODE_LABEL[mode]}`,
          value: `bg-control.batch.${category}.${mode}`,
          description: `Apply ${mode} to all ${category} agents`,
          category: "bg-control · Batch by category",
          onSelect: () => {
            const targets = AGENTS_BY_CATEGORY[category] ?? [];
            const next = { ...policies() };
            for (const agent of targets) {
              next[agent.name] = mode;
              (api as { kv?: { set?: (k: string, v: string) => void } }).kv?.set?.(
                `${KV_KEY_PREFIX}.${agent.name}`,
                mode,
              );
            }
            setPolicies(next);
            try {
              writePolicyFile(next);
            } catch (err) {
              logger.warn("category file write failed", { error: String(err) });
            }
            api.ui?.toast?.({
              variant: "success",
              title: "bg-control",
              message: `${category} agents → ${MODE_LABEL[mode]}`,
            });
          },
        });
      }
    }

    cmds.push({
      title: "🟦 ALL agents → BG",
      value: "bg-control.all.bg",
      description: "All agents run in background mode",
      category: "bg-control · Global batch",
      onSelect: () => applyToAll("bg", "All agents → BG"),
    });
    cmds.push({
      title: "🟧 ALL agents → FG",
      value: "bg-control.all.fg",
      description: "All agents run in foreground (blocking) mode",
      category: "bg-control · Global batch",
      onSelect: () => applyToAll("fg", "All agents → FG"),
    });
    cmds.push({
      title: "⚪ Reset ALL → Default",
      value: "bg-control.reset",
      description: "Clear all policy overrides",
      category: "bg-control · Global batch",
      onSelect: () => applyToAll("default", "All agents reset to default"),
    });
    cmds.push({
      title: "📄 Show policy file path",
      value: "bg-control.show-path",
      description: "Display the policy.jsonc path for manual edit",
      category: "bg-control · Info",
      onSelect: () => {
        api.ui?.toast?.({
          variant: "info",
          title: "Policy file",
          message: POLICY_PATH,
        });
      },
    });

    return cmds;
  });

  logger.info("control-tui v0.6 command palette registered", {
    static_commands:
      1 /* policy editor */ +
      Object.keys(AGENTS_BY_CATEGORY).length * MODES.length +
      4 /* global batch + path */,
    dynamic_active_tasks: "computed at palette open",
    policy_editor: "ctrl+shift+p · DialogSelect 2-step cycle",
  });

  // ---------------------------------------------------------------------------
  // 6. Lifecycle cleanup
  // ---------------------------------------------------------------------------
  api.lifecycle.onDispose(() => {
    disposeEvents();
    commandDispose?.();
    logger.info("control-tui v0.6 disposed");
  });

  logger.info("control-tui v0.6 boot complete");
};

export default {
  id: PLUGIN_ID,
  tui: Tui,
};
