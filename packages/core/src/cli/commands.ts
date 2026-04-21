/**
 * Pure command implementations backing the /task <list|show|kill|logs> surface.
 *
 * Every command takes its dependencies via a plain object so tests can inject
 * fakes and adapters can wire real ones. Nothing here touches `process.stdout`
 * directly — callers pass a writable-shape sink. Exit codes are returned
 * structurally; callers decide whether to call `process.exit`.
 *
 * FR-7 (list/show/kill/logs), FR-18 (kill).
 */
import type { TaskId, TaskStatus } from "@maicolextic/bg-subagents-protocol";

import type { HistoryStore, HistoryEvent } from "../task/HistoryStore.js";
import type { TaskRegistry, TaskState } from "../task/TaskRegistry.js";
import {
  formatStatus,
  formatTaskDetail,
  formatTaskLine,
  formatTaskListHeader,
  type FormatOptions,
} from "./format.js";

// -----------------------------------------------------------------------------
// Shared shapes
// -----------------------------------------------------------------------------

export interface CommandStdout {
  write(chunk: string): void;
}

export interface CommandResult {
  readonly exit_code: number;
}

interface BaseDeps {
  readonly registry: TaskRegistry;
  readonly history: HistoryStore;
  readonly stdout: CommandStdout;
  readonly format?: FormatOptions;
}

function writeLine(stdout: CommandStdout, line: string): void {
  stdout.write(`${line}\n`);
}

// -----------------------------------------------------------------------------
// listCommand
// -----------------------------------------------------------------------------

export interface ListCommandDeps extends BaseDeps {
  readonly filter?: { readonly status?: TaskStatus };
}

export function listCommand(deps: ListCommandDeps): CommandResult {
  const { registry, stdout, filter, format } = deps;
  const fmt: FormatOptions = format ?? {};
  const tasks = registry.list(filter ?? {});
  if (tasks.length === 0) {
    writeLine(stdout, "No tasks.");
    return { exit_code: 0 };
  }
  writeLine(stdout, formatTaskListHeader(fmt));
  for (const state of tasks) {
    writeLine(stdout, formatTaskLine(state, fmt));
  }
  return { exit_code: 0 };
}

// -----------------------------------------------------------------------------
// showCommand
// -----------------------------------------------------------------------------

export interface ShowCommandDeps extends BaseDeps {
  readonly id: TaskId | string;
}

export function showCommand(deps: ShowCommandDeps): CommandResult {
  const { registry, stdout, id, format } = deps;
  const fmt: FormatOptions = format ?? {};
  const state = registry.get(id as TaskId);
  if (state === undefined) {
    writeLine(stdout, `Task ${id} not found.`);
    return { exit_code: 1 };
  }
  writeLine(stdout, formatTaskDetail(state, fmt));
  return { exit_code: 0 };
}

// -----------------------------------------------------------------------------
// killCommand
// -----------------------------------------------------------------------------

export interface KillCommandDeps {
  readonly registry: TaskRegistry;
  readonly stdout: CommandStdout;
  readonly id: TaskId | string;
  readonly format?: FormatOptions;
}

export async function killCommand(deps: KillCommandDeps): Promise<CommandResult> {
  const { registry, stdout, id, format } = deps;
  const fmt: FormatOptions = format ?? {};
  const state = registry.get(id as TaskId);
  if (state === undefined) {
    writeLine(stdout, `Task ${id} not found.`);
    return { exit_code: 1 };
  }
  if (isTerminalState(state)) {
    writeLine(
      stdout,
      `Task ${id} is already done (${formatStatus(state.status, fmt)}).`,
    );
    return { exit_code: 0 };
  }
  await registry.kill(id as TaskId);
  writeLine(stdout, `Task ${id} killed.`);
  return { exit_code: 0 };
}

function isTerminalState(state: TaskState): boolean {
  return state.status !== "running" && state.status !== "passthrough";
}

// -----------------------------------------------------------------------------
// logsCommand
// -----------------------------------------------------------------------------

export interface LogsCommandDeps {
  readonly history: HistoryStore;
  readonly stdout: CommandStdout;
  readonly id: TaskId | string;
  readonly tail?: number;
}

export async function logsCommand(deps: LogsCommandDeps): Promise<CommandResult> {
  const { history, stdout, id, tail } = deps;
  const all = await history.read();
  const filtered = all.filter((evt) => evt.task_id === id);
  const limited =
    tail !== undefined && tail > 0 ? filtered.slice(-tail) : filtered;
  for (const evt of limited) {
    writeLine(stdout, formatHistoryEvent(evt));
  }
  return { exit_code: 0 };
}

function formatHistoryEvent(evt: HistoryEvent): string {
  const ts = new Date(evt.ts).toISOString();
  switch (evt.type) {
    case "spawn":
      return `${ts} ${evt.task_id} spawn`;
    case "transition":
      return `${ts} ${evt.task_id} transition ${evt.from} -> ${evt.to}`;
    case "progress":
      return `${ts} ${evt.task_id} progress ${evt.message}`;
    case "complete":
      return `${ts} ${evt.task_id} complete ${evt.status}`;
    default: {
      // Exhaustive check — TypeScript verifies unreachable.
      const _exhaustive: never = evt;
      return String(_exhaustive);
    }
  }
}
