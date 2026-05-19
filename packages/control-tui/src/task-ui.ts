import type { ActiveTask } from "./events.js";
import {
  projectTaskActivityVms,
  projectTaskStatusMeta,
  type ProjectedTaskStatus,
  type TaskActivityVM,
  type TaskFreshnessOptions,
} from "./activity-projection.js";

const EMPTY_VALUE = "-";

export const STATUS_LABEL: Record<ActiveTask["status"], string> = {
  queued: "queued",
  running: "running",
  done: "done",
  error: "error",
  cancelled: "cancelled",
  "bg-detached": "bg-detached",
};

export const PROJECTED_STATUS_LABEL: Record<ProjectedTaskStatus, string> = {
  ...STATUS_LABEL,
  stale: "stale",
  "maybe-unknown": "maybe-unknown",
};

export const STATUS_MARKER: Record<ActiveTask["status"], string> = {
  queued: "..",
  running: "RUN",
  done: "OK",
  error: "ERR",
  cancelled: "--",
  "bg-detached": "BG",
};

export const PROJECTED_STATUS_MARKER: Record<ProjectedTaskStatus, string> = {
  ...STATUS_MARKER,
  stale: "STALE",
  "maybe-unknown": "?",
};

export interface TaskCardLines {
  readonly header: string;
  readonly meta: string;
  readonly latest: string;
}

export interface TaskDetailRow {
  readonly title: string;
  readonly description: string;
}

export function shortTaskId(task: ActiveTask): string {
  const id = task.newChildSessionID ?? task.childSessionID;
  return id.length <= 8 ? id : id.slice(0, 8);
}

export function formatTaskElapsed(task: ActiveTask, now = Date.now()): string {
  const end = task.endedAt && task.status !== "running" ? task.endedAt : now;
  const sec = Math.max(0, Math.floor((end - task.started) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${(sec % 60).toString().padStart(2, "0")}`;
}

export function truncateForUi(value: string | undefined, maxLength: number): string {
  const compact = (value ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return EMPTY_VALUE;
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 3))}...` : compact;
}

export function taskModeLabel(task: ActiveTask): string {
  if (task.mode) return task.mode;
  if (task.status === "bg-detached" || task.newChildSessionID) return "BG";
  return "FG";
}

export function taskLatestSignal(task: ActiveTask): string {
  return truncateForUi(task.latestEvent ?? task.errorMessage ?? task.description, 72);
}

export function formatTaskCardLines(task: ActiveTask, now = Date.now(), options: TaskFreshnessOptions = {}): TaskCardLines {
  const projected = projectTaskActivityVms([task], now, options)[0];
  const statusMeta = projectTaskStatusMeta(task, now, options);
  const status = projected?.status ?? statusMeta.status;
  const badge = projected?.box.badge ?? taskModeLabel(task);
  const latest = projected?.box.latestSignal ?? taskLatestSignal(task);
  const lastSeen = status === "stale" || status === "maybe-unknown" ? ` | last-seen ${formatAge(statusMeta.lastSeenAgeMs)}` : "";
  return {
    header: `${PROJECTED_STATUS_MARKER[status]} ${task.agent} | ${badge} | ${formatTaskElapsed(task, now)}`,
    meta: `#${shortTaskId(task)} | ${PROJECTED_STATUS_LABEL[status]}${lastSeen}`,
    latest,
  };
}

export function formatTaskDetailRows(task: ActiveTask, now = Date.now(), options: TaskFreshnessOptions = {}): readonly TaskDetailRow[] {
  const statusMeta = projectTaskStatusMeta(task, now, options);
  const status = statusMeta.status;
  const rows: TaskDetailRow[] = [
    {
      title: `Task: ${task.childSessionID}`,
      description: `Agent ${task.agent} | ${taskModeLabel(task)} | ${PROJECTED_STATUS_LABEL[status]} | ${formatTaskElapsed(task, now)}`,
    },
    {
      title: "Prompt / description",
      description: truncateForUi(task.prompt ?? task.description, 220),
    },
    {
      title: "Latest event / Ultima senal",
      description: taskLatestSignal(task),
    },
    {
      title: "Last seen",
      description: formatAge(statusMeta.lastSeenAgeMs),
    },
  ];

  const history = (task.progressEvents ?? []).slice(-5).map((event) => truncateForUi(event, 96));
  if (history.length > 0) {
    rows.push({
      title: "Recent events",
      description: history.join(" | "),
    });
  }

  const resultPreview = truncateForUi(task.summary ?? task.errorMessage, 160);
  if (resultPreview !== EMPTY_VALUE) {
    rows.push({
      title: task.status === "error" ? "Error preview" : "Result preview",
      description: resultPreview,
    });
  }

  rows.push({
    title: "Logs / history reference",
    description: task.detailRef ?? `child session/logs: ${task.newChildSessionID ?? task.childSessionID}`,
  });

  return rows;
}

export function projectTaskVm(task: ActiveTask): TaskActivityVM {
  return projectTaskActivityVms([task])[0] as TaskActivityVM;
}

function formatAge(ageMs: number): string {
  const sec = Math.max(0, Math.floor(ageMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `${min}m${(sec % 60).toString().padStart(2, "0")} ago`;
}
