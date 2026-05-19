import type { AgentActivitySource } from "@maicolextic/bg-subagents-core";

import type { ActiveTask } from "./events.js";
import type { OrchestratorActivitySnippet } from "./orchestrator-activity.js";

export const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;

export type ProjectedTaskStatus = ActiveTask["status"] | "stale" | "maybe-unknown";

export interface TaskFreshnessOptions {
  readonly staleAfterMs?: number;
  readonly forceMaybeUnknown?: boolean;
}

export interface TaskStatusMeta {
  readonly status: ProjectedTaskStatus;
  readonly lastSeenAtMs: number;
  readonly lastSeenAgeMs: number;
}

export interface TaskActivityVM {
  readonly id: string;
  readonly status: ProjectedTaskStatus;
  readonly box: {
    readonly badge: "BG" | "FG" | "?";
    readonly latestSignal: string;
    readonly blocking: boolean;
  };
  readonly detail: {
    readonly rows: ReadonlyArray<{ label: string; value: string }>;
    readonly reference?: string;
  };
}

export function projectTaskStatus(
  task: ActiveTask,
  nowMs = Date.now(),
  options: TaskFreshnessOptions = {},
): ProjectedTaskStatus {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (task.status === "done" || task.status === "error" || task.status === "cancelled" || task.status === "bg-detached") return task.status;
  if (task.endedAt) return task.errorMessage ? "error" : "done";
  if (options.forceMaybeUnknown) return "maybe-unknown";
  if ((task.status === "running" || task.status === "queued") && !task.mode && !!task.newChildSessionID) return "maybe-unknown";

  const lastSeen = task.updatedAt ?? task.started;
  const staleAge = nowMs - lastSeen;
  if (staleAge >= staleAfterMs) {
    if (task.delivered || !!task.summary || !!task.errorMessage) return task.errorMessage ? "error" : "done";
    return "stale";
  }
  return task.status;
}

export function projectTaskStatusMeta(task: ActiveTask, nowMs = Date.now(), options: TaskFreshnessOptions = {}): TaskStatusMeta {
  const lastSeenAtMs = task.updatedAt ?? task.started;
  return {
    status: projectTaskStatus(task, nowMs, options),
    lastSeenAtMs,
    lastSeenAgeMs: Math.max(0, nowMs - lastSeenAtMs),
  };
}

export function taskToActivitySource(task: ActiveTask): AgentActivitySource {
  return {
    source: "control-active-task",
    id: `task:${task.childSessionID}`,
    taskId: task.childSessionID,
    childSessionId: task.newChildSessionID ?? task.childSessionID,
    agentName: task.agent,
    status: task.status,
    startedAt: task.started,
    ...(task.parentSessionID != null ? { parentSessionId: task.parentSessionID } : {}),
    ...(task.mode !== undefined ? { mode: task.mode } : {}),
    ...(task.updatedAt !== undefined ? { updatedAt: task.updatedAt } : {}),
    ...(task.endedAt !== undefined ? { endedAt: task.endedAt } : {}),
    ...(task.prompt !== undefined ? { prompt: task.prompt } : {}),
    ...(task.description !== undefined ? { description: task.description } : {}),
    ...(task.latestEvent !== undefined ? { latestSignal: task.latestEvent } : {}),
    ...(task.progressEvents !== undefined ? { progressSignals: task.progressEvents } : {}),
    ...(task.summary !== undefined ? { resultPreview: task.summary } : {}),
    ...(task.errorMessage !== undefined ? { errorPreview: task.errorMessage } : {}),
    ...(task.detailRef !== undefined ? { detailRef: task.detailRef } : {}),
    ...(task.delivered !== undefined ? { delivered: task.delivered } : {}),
  };
}

export function orchestratorSnippetToActivitySource(snippet: OrchestratorActivitySnippet): AgentActivitySource {
  return {
    source: "orchestrator-snippet",
    id: `orchestrator:${snippet.sessionID}:${snippet.turnID}:${snippet.kind}`,
    taskId: snippet.sessionID,
    childSessionId: snippet.sessionID,
    mode: "FG",
    status: snippet.kind === "delivery" ? "done" : "running",
    latestSignal: snippet.text,
    updatedAt: snippet.timestamp,
  };
}

export function projectTaskActivityVms(
  tasks: readonly ActiveTask[],
  nowMs = Date.now(),
  options: TaskFreshnessOptions = {},
): TaskActivityVM[] {
  return tasks.map((task) => {
    const meta = projectTaskStatusMeta(task, nowMs, options);
    const badge = task.mode === "BG" ? "BG" : task.mode === "FG" ? "FG" : "?";
    return {
      id: `task:${task.childSessionID}`,
      status: meta.status,
      box: {
        badge,
        latestSignal: truncate(task.latestEvent ?? task.errorMessage ?? task.description ?? "-", 72),
        blocking: badge === "FG" && (meta.status === "running" || meta.status === "queued"),
      },
      detail: {
        rows: [
          { label: "Mode", value: badge },
          { label: "State", value: meta.status },
          { label: "Last seen", value: formatAge(meta.lastSeenAgeMs) },
          { label: "Agent", value: task.agent },
        ],
        ...(task.detailRef !== undefined ? { reference: task.detailRef } : {}),
      },
    };
  });
}

export function projectTaskActionAvailability(task: ActiveTask, nowMs = Date.now(), options: TaskFreshnessOptions = {}): ReadonlyArray<{ action: string; enabled: boolean }> {
  const projectedStatus = projectTaskStatus(task, nowMs, options);
  const running = projectedStatus === "running" || projectedStatus === "queued";
  const warning = projectedStatus === "stale" || projectedStatus === "maybe-unknown";
  const isForegroundLike = task.mode !== "BG";
  return [
    { action: "inspect", enabled: true },
    { action: "focus", enabled: true },
    { action: "enter", enabled: true },
    { action: "kill", enabled: running && !warning },
    { action: "cancel", enabled: running && !warning },
    { action: "move-to-BG", enabled: running && isForegroundLike && !warning },
    { action: "dismiss", enabled: warning },
  ];
}

export function isProjectedActionEnabled(task: ActiveTask, action: string): boolean {
  return projectTaskActionAvailability(task).some((candidate) => candidate.action === action && candidate.enabled);
}

function formatAge(ageMs: number): string {
  const sec = Math.max(0, Math.floor(ageMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `${min}m${(sec % 60).toString().padStart(2, "0")} ago`;
}

function truncate(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "-";
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact;
}
