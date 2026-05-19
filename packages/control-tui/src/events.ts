/**
 * Track active subagent sessions in real time via OpenCode's event API.
 *
 * Subscribes to:
 *   - session.created  → new child session spawned (track it)
 *   - session.idle     → child finished (mark done + deliver result via noReply)
 *   - session.error    → child failed
 *   - message.part.updated → live updates of child's progress (optional UI)
 *
 * Each tracked task includes:
 *   - childSessionID: the child's OpenCode session id
 *   - parentSessionID: where to deliver results
 *   - agent: subagent type
 *   - prompt: original prompt text (best-effort extraction)
 *   - started: timestamp
 *   - status: running | done | error | cancelled | bg-detached
 *
 * The registry is exposed as a Solid Signal so the sidebar widget + command
 * palette can react in real time.
 */

import { createSignal, type Accessor, type Setter } from "solid-js";
import type { AgentActivitySource } from "@maicolextic/bg-subagents-core";

export interface ActiveTask {
  readonly childSessionID: string;
  readonly parentSessionID: string | null;
  readonly agent: string;
  readonly started: number;
  readonly status:
    | "queued"
    | "running"
    | "done"
    | "error"
    | "cancelled"
    | "bg-detached";
  readonly mode?: "BG" | "FG";
  readonly prompt?: string;
  readonly description?: string;
  readonly latestEvent?: string;
  readonly progressEvents?: readonly string[];
  readonly summary?: string;
  readonly updatedAt?: number;
  readonly delivered?: boolean;
  readonly detailRef?: string;
  readonly newChildSessionID?: string; // when moved to BG, the replacement
  readonly endedAt?: number;
  readonly errorMessage?: string;
}

const MAX_PROGRESS_EVENTS = 20;

export interface TaskRegistry {
  readonly tasks: Accessor<readonly ActiveTask[]>;
  readonly setTasks: Setter<ActiveTask[]>;
  readonly getTask: (childSessionID: string) => ActiveTask | undefined;
  readonly getTaskByOriginalChild: (childSessionID: string) => ActiveTask | undefined;
  readonly getTaskByReplacementChild: (newChildSessionID: string) => ActiveTask | undefined;
  readonly upsertTask: (task: ActiveTask) => void;
  readonly markStatus: (
    childSessionID: string,
    status: ActiveTask["status"],
    extra?: Partial<ActiveTask>,
  ) => void;
  readonly removeTask: (childSessionID: string) => void;
}

export function createTaskRegistry(): TaskRegistry {
  const [tasks, setTasks] = createSignal<ActiveTask[]>([]);

  const getTaskByOriginalChild = (id: string) =>
    tasks().find((t) => t.childSessionID === id);

  const getTaskByReplacementChild = (id: string) =>
    tasks().find((t) => t.newChildSessionID === id);

  const getTask = (id: string) =>
    getTaskByOriginalChild(id) ?? getTaskByReplacementChild(id);

  const upsertTask = (task: ActiveTask) => {
    const progressEvents = task.progressEvents ?? (task.latestEvent ? [task.latestEvent] : []);
    const incoming = { updatedAt: Date.now(), ...task, progressEvents: boundProgressEvents(progressEvents) };
    setTasks((prev) => {
      const existing = prev.findIndex((t) => t.childSessionID === incoming.childSessionID);
      if (existing >= 0) {
        const next = prev.slice();
        next[existing] = { ...prev[existing], ...incoming };
        return next;
      }
      return [...prev, incoming];
    });
  };

  const markStatus: TaskRegistry["markStatus"] = (id, status, extra) => {
    const now = Date.now();
    const isTerminal = status !== "running" && status !== "queued";
    setTasks((prev) =>
      prev.map((t) => {
        const target = findTaskByPrecedence(prev, id);
        if (!target || t.childSessionID !== target.childSessionID) return t;
        const eventText = compactTaskSignal(extra?.latestEvent ?? extra?.summary);
        const next = {
          ...t,
          status,
          ...(isTerminal ? { endedAt: now } : {}),
          updatedAt: now,
          ...extra,
          progressEvents: appendProgressEvent(t.progressEvents, eventText),
        };
        if (!isTerminal) return next;
        const { latestEvent: _latestEvent, ...terminalTask } = next;
        void _latestEvent;
        return terminalTask;
      }),
    );
  };

  const removeTask: TaskRegistry["removeTask"] = (id) => {
    setTasks((prev) =>
      prev.filter((t) => t.childSessionID !== id && t.newChildSessionID !== id),
    );
  };

  return { tasks, setTasks, getTask, getTaskByOriginalChild, getTaskByReplacementChild, upsertTask, markStatus, removeTask };
}

function findTaskByPrecedence(tasks: readonly ActiveTask[], id: string): ActiveTask | undefined {
  return tasks.find((t) => t.childSessionID === id) ?? tasks.find((t) => t.newChildSessionID === id);
}

function boundProgressEvents(events: readonly string[]): readonly string[] {
  return events.slice(-MAX_PROGRESS_EVENTS);
}

function appendProgressEvent(events: readonly string[] | undefined, event: string | undefined): readonly string[] {
  if (!event) return boundProgressEvents(events ?? []);
  return boundProgressEvents([...(events ?? []), event]);
}

export function compactTaskSignal(value: unknown, maxLength = 96): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 1))}…` : compact;
}

export function toActivitySource(task: ActiveTask): AgentActivitySource {
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

export interface EventSubscriptionOpts {
  readonly registry: TaskRegistry;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly api: any;
  readonly onChildIdle?: (task: ActiveTask) => void | Promise<void>;
  /**
   * Fires AFTER a child session is registered as a tracked task.
   * Used by the TUI to apply BG-policy auto-flip: when a tracked agent has
   * `policy=bg`, the TUI automatically converts the synchronous `task` call
   * into an async one (abort + respawn via task_bg) so the orchestrator never
   * blocks waiting on long-running BG agents.
   */
  readonly onChildCreated?: (task: ActiveTask) => void | Promise<void>;
  readonly logger?: {
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
  };
}

/**
 * Robust session extraction for events with full Session payload:
 *   - session.created → { properties: { info: Session } }
 *   - session.updated → { properties: { info: Session } }
 *   - session.deleted → { properties: { info: Session } }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSession(e: any): {
  id?: string;
  parentID?: string;
  agent?: string;
  title?: string;
} | undefined {
  if (!e || typeof e !== "object") return undefined;
  if (e.properties?.info?.id) return e.properties.info;
  if (e.session?.id) return e.session;
  if (e.info?.id) return e.info;
  if (e.id && (e.parentID !== undefined || e.title !== undefined)) return e;
  return undefined;
}

/**
 * Extract just sessionID for events that don't carry the full Session payload:
 *   - session.idle → { properties: { sessionID: string } }
 *   - session.error → { properties: { sessionID?, error? } }
 *   - session.status → { properties: { sessionID, status } }
 *   - session.compacted → { properties: { sessionID } }
 *   - session.diff → { properties: { sessionID, diff } }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSessionID(e: any): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  if (typeof e.properties?.sessionID === "string") return e.properties.sessionID;
  if (typeof e.sessionID === "string") return e.sessionID;
  if (e.properties?.info?.id) return e.properties.info.id;
  if (e.session?.id) return e.session.id;
  if (e.info?.id) return e.info.id;
  if (typeof e.id === "string") return e.id;
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractError(e: any): string | undefined {
  if (!e) return undefined;
  if (typeof e.error === "string") return e.error;
  if (e.error?.message) return e.error.message;
  if (e.properties?.error?.message) return e.properties.error.message;
  if (e.properties?.error) return String(e.properties.error);
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractProgressSignal(e: any): string | undefined {
  const props = e?.properties ?? e;
  const part = props?.part ?? e?.part;
  return compactTaskSignal(
    part?.text ?? props?.text ?? props?.delta ?? props?.message ?? props?.summary,
  );
}

function isTaskStatus(status: string | undefined): status is ActiveTask["status"] {
  return status === "queued" || status === "running" || status === "done" || status === "error" || status === "cancelled" || status === "bg-detached";
}

export function subscribeToSessionEvents(
  opts: EventSubscriptionOpts,
): () => void {
  const { registry, api, onChildIdle, onChildCreated, logger } = opts;

  // session.created — a new child session was spawned by orchestrator (or by us)
  const disposeCreated = api.event.on(
    "session.created",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      const sess = extractSession(e);
      if (!sess?.id) {
        logger?.info("session.created event but no sess.id extracted", {
          event_keys: e ? Object.keys(e) : [],
        });
        return;
      }
      // Only track CHILDREN (parentID set) — ignore root sessions
      if (!sess.parentID) {
        logger?.info("session.created (no parentID, root session — skip)", {
          id: sess.id,
        });
        return;
      }

      // Extract agent name — try direct field, then parse from title
      // (OpenCode titles look like: "Explorar X (@sdd-explore subagent)")
      let agent = sess.agent ?? "unknown";
      if (agent === "unknown" && sess.title) {
        const match = sess.title.match(/@([\w-]+)\s+subagent/);
        if (match?.[1]) agent = match[1];
      }
      logger?.info("session.created → tracking new task ✅", {
        child: sess.id,
        parent: sess.parentID,
        agent,
        title: sess.title,
      });

      const newTask: ActiveTask = {
        childSessionID: sess.id,
        parentSessionID: sess.parentID,
        agent,
        started: Date.now(),
        status: "running",
        mode: "FG",
        latestEvent: "session created",
        progressEvents: ["session created"],
        updatedAt: Date.now(),
        detailRef: `child session/logs: ${sess.id}`,
        ...(sess.title ? { description: sess.title } : {}),
      };
      registry.upsertTask(newTask);
      // Fire onChildCreated so the TUI can auto-flip BG-policy agents.
      // Wrapped in setTimeout(0) to keep the event handler synchronous and
      // avoid back-pressure on OpenCode's event bus.
      if (onChildCreated) {
        setTimeout(() => {
          void onChildCreated(newTask);
        }, 0);
      }
    },
  );

  // session.idle — child completed normally (payload: { properties: { sessionID }})
  const disposeIdle = api.event.on(
    "session.idle",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      const sessionID = extractSessionID(e);
      if (!sessionID) {
        logger?.info("session.idle event but no sessionID extracted", {
          event_keys: e ? Object.keys(e) : [],
          properties_keys: e?.properties ? Object.keys(e.properties) : [],
        });
        return;
      }
      const task = registry.getTask(sessionID);
      if (!task) {
        // Not one of our tracked tasks — silent skip
        return;
      }
      logger?.info("session.idle → task done ✅", {
        child: sessionID,
        agent: task.agent,
      });
      registry.markStatus(sessionID, "done", { summary: "session idle", latestEvent: "session idle" });
      void onChildIdle?.(task);
    },
  );

  // session.error — child failed (payload: { properties: { sessionID?, error? }})
  const disposeError = api.event.on(
    "session.error",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      const sessionID = extractSessionID(e);
      if (!sessionID) return;
      const task = registry.getTask(sessionID);
      if (!task) return;
      const errMsg = extractError(e);
      logger?.warn("session.error → task failed", {
        child: sessionID,
        agent: task.agent,
        error: errMsg,
      });
      const compactError = compactTaskSignal(errMsg);
      registry.markStatus(sessionID, "error", {
        latestEvent: compactError ?? "session error",
        summary: compactError ?? "session error",
        ...(compactError ? { errorMessage: compactError } : {}),
      });
    },
  );

  const disposeStatus = api.event.on(
    "session.status",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      const sessionID = extractSessionID(e);
      const status = e?.properties?.status ?? e?.status;
      if (!sessionID || !isTaskStatus(status)) return;
      const task = registry.getTask(sessionID);
      if (!task) return;
      registry.markStatus(sessionID, status, { latestEvent: `status: ${status}` });
    },
  );

  const disposePartUpdated = api.event.on(
    "message.part.updated",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      const sessionID = extractSessionID(e);
      if (!sessionID) return;
      const task = registry.getTask(sessionID);
      if (!task) return;
      const latestEvent = extractProgressSignal(e) ?? "progress update";
      registry.markStatus(sessionID, task.status, { latestEvent });
    },
  );

  return () => {
    disposeCreated?.();
    disposeIdle?.();
    disposeError?.();
    disposeStatus?.();
    disposePartUpdated?.();
  };
}
