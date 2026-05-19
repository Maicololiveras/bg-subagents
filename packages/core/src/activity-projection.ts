export type ActivitySourceKind =
  | "core-task"
  | "control-active-task"
  | "orchestrator-snippet"
  | "host-event"
  | "delivery";

export type ActivityMode = "background" | "foreground" | "unknown";
export type ActivityState = "queued" | "running" | "completed" | "failed" | "cancelled" | "detached";
export type ActivityAction = "inspect" | "focus" | "enter" | "kill" | "cancel" | "move-to-BG";

export interface AgentActivitySource {
  readonly source: ActivitySourceKind;
  readonly id: string;
  readonly taskId?: string;
  readonly childSessionId?: string;
  readonly parentSessionId?: string;
  readonly agentName?: string;
  readonly mode?: ActivityMode | "BG" | "FG" | "bg" | "fg";
  readonly status?: string;
  readonly startedAt?: number;
  readonly updatedAt?: number;
  readonly endedAt?: number;
  readonly prompt?: string;
  readonly description?: string;
  readonly latestSignal?: string;
  readonly progressSignals?: readonly string[];
  readonly resultPreview?: string;
  readonly errorPreview?: string;
  readonly detailRef?: string;
  readonly delivered?: boolean;
  readonly raw?: unknown;
}

export interface ProjectedSignal {
  readonly kind: "state" | "tool" | "progress" | "result" | "error" | "reference";
  readonly text: string;
  readonly ts?: number;
}

export interface ProjectedAction {
  readonly action: ActivityAction;
  readonly enabled: boolean;
  readonly reason?: string | undefined;
  readonly sideEffect: boolean;
}

export interface TranscriptSummaryVM {
  readonly activityId: string;
  readonly shouldEmit: boolean;
  readonly text: string;
  readonly reference: string;
}

export interface AgentActivityProjection {
  readonly id: string;
  readonly sourceIds: readonly string[];
  readonly mode: ActivityMode;
  readonly state: ActivityState;
  readonly blocking: boolean;
  readonly agentName: string;
  readonly title: string;
  readonly subtitle: string;
  readonly latestSignal: string;
  readonly signals: readonly ProjectedSignal[];
  readonly detailRef: string;
  readonly startedAt?: number | undefined;
  readonly updatedAt?: number | undefined;
  readonly endedAt?: number | undefined;
  readonly actions: readonly ProjectedAction[];
  readonly transcript: TranscriptSummaryVM;
}

export interface ActivityBoxVM {
  readonly id: string;
  readonly title: string;
  readonly badge: "BG" | "FG" | "?";
  readonly stateLabel: string;
  readonly tone: "neutral" | "running" | "success" | "warning" | "danger";
  readonly compactLine: string;
  readonly latestSignal: string;
  readonly elapsedLabel: string;
  readonly expandable: boolean;
  readonly blocking: boolean;
  readonly allowedActions: readonly ProjectedAction[];
}

export interface DetailRowVM {
  readonly label: string;
  readonly value: string;
}

export interface DetailVM {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly DetailRowVM[];
  readonly signals: readonly ProjectedSignal[];
  readonly reference: string;
  readonly notice?: string;
}

const MAX_SIGNAL_CHARS = 120;
const MAX_SUMMARY_CHARS = 1600;
const MAX_DETAIL_SIGNALS = 8;

export function projectActivities(sources: readonly AgentActivitySource[]): AgentActivityProjection[] {
  const buckets = new Map<string, AgentActivitySource[]>();
  for (const source of sources) {
    const key = computeIdentity(source);
    const current = buckets.get(key) ?? [];
    current.push(source);
    buckets.set(key, current);
  }

  return [...buckets.entries()].map(([identity, grouped]) => {
    const selected = selectAuthoritative(grouped);
    const mode = normalizeMode(selected.mode);
    const state = normalizeState(selected.status);
    const latestSignal = compactSignal(
      selected.resultPreview ?? selected.errorPreview ?? selected.latestSignal ?? "No recent signal",
    );

    const signals = collectSignals(grouped);
    const actions = projectActions(state, mode, mode === "foreground");
    const projection: AgentActivityProjection = {
      id: selected.taskId ? `task:${selected.taskId}` : identity,
      sourceIds: grouped.map((item) => item.id),
      mode,
      state,
      blocking: mode === "foreground" && (state === "running" || state === "queued"),
      agentName: selected.agentName ?? "bg-subagent",
      title: `${selected.agentName ?? "bg-subagent"}`,
      subtitle: `${state} · ${mode}`,
      latestSignal,
      signals,
      detailRef: selected.detailRef ?? selected.childSessionId ?? selected.taskId ?? identity,
      startedAt: selected.startedAt,
      updatedAt: selected.updatedAt,
      endedAt: selected.endedAt,
      actions,
      transcript: {
        activityId: selected.taskId ? `task:${selected.taskId}` : identity,
        shouldEmit: state === "completed" || state === "failed" || state === "cancelled",
        text: "",
        reference: `Logs/history: ${selected.taskId ? `task:${selected.taskId}` : identity}`,
      },
    };

    return { ...projection, transcript: projectTranscriptSummary(projection) };
  });
}


export function projectActions(state: ActivityState, mode: ActivityMode, identityOrBlocking: string | boolean): ProjectedAction[] {
  const blocking = typeof identityOrBlocking === "boolean" ? identityOrBlocking : mode === "foreground";
  const running = state === "running" || state === "queued";
  const terminal = state === "completed" || state === "failed" || state === "cancelled" || state === "detached";
  const actions: ProjectedAction[] = [
    { action: "inspect", enabled: true, sideEffect: false },
    { action: "focus", enabled: true, sideEffect: false },
    { action: "enter", enabled: true, sideEffect: false },
    { action: "kill", enabled: running, sideEffect: true, reason: running ? undefined : "Only running tasks can be killed" },
    {
      action: "cancel",
      enabled: running,
      sideEffect: true,
      reason: running ? undefined : "Only running tasks can be cancelled",
    },
    {
      action: "move-to-BG",
      enabled: running && mode === "foreground" && blocking,
      sideEffect: true,
      reason: running && mode === "foreground" && blocking ? undefined : "Only running foreground tasks can move to BG",
    },
  ];

  return actions.map((item) => (terminal && (item.action === "kill" || item.action === "cancel" || item.action === "move-to-BG")
    ? { ...item, enabled: false }
    : item));
}

export function projectTranscriptSummary(
  projectionOrId: AgentActivityProjection | string,
  state?: ActivityState,
  agentName?: string,
  latestSignal?: string,
  reference?: string,
): TranscriptSummaryVM {
  if (typeof projectionOrId === "string") {
    return projectTranscriptSummaryFromParts(
      projectionOrId,
      state ?? "running",
      agentName ?? "bg-subagent",
      latestSignal ?? "",
      reference ?? projectionOrId,
    );
  }

  const projection = projectionOrId;
  return projectTranscriptSummaryFromParts(
    projection.id,
    projection.state,
    projection.agentName,
    projection.latestSignal,
    projection.id,
  );
}

export function projectAgentActivities(sources: readonly AgentActivitySource[]): AgentActivityProjection[] {
  return projectActivities(sources);
}

export function normalizeActivityMode(mode: AgentActivitySource["mode"]): ActivityMode {
  return normalizeMode(mode);
}

export function normalizeActivityState(status: string | undefined): ActivityState {
  return normalizeState(status);
}

export function compactActivitySignal(signal: string, max = MAX_SIGNAL_CHARS): string {
  const sanitized = sanitizeSignal(signal);
  if (!sanitized) return "detail reference only";
  return compactSignal(sanitized, max);
}

export function projectTranscriptSummaryFromParts(
  activityId: string,
  state: ActivityState,
  agentName: string,
  latestSignal: string,
  reference: string,
): TranscriptSummaryVM {
  return {
    activityId,
    shouldEmit: state === "completed" || state === "failed" || state === "cancelled",
    text: `[${agentName}] ${state}: ${compactSignal(latestSignal, MAX_SUMMARY_CHARS - 40)}`,
    reference: `Logs/history: ${reference}`,
  };
}

export function projectTranscriptSummaryLegacy(
  activityId: string,
  state: ActivityState,
  agentName: string,
  latestSignal: string,
  reference: string,
): TranscriptSummaryVM {
  return projectTranscriptSummaryFromParts(activityId, state, agentName, latestSignal, reference);
}

export function buildActivityBox(projection: AgentActivityProjection): ActivityBoxVM {
  const badge = projection.mode === "background" ? "BG" : projection.mode === "foreground" ? "FG" : "?";
  const tone =
    projection.state === "running"
      ? "running"
      : projection.state === "completed"
        ? "success"
        : projection.state === "failed"
          ? "danger"
          : projection.state === "cancelled"
            ? "warning"
            : "neutral";

  return {
    id: projection.id,
    title: projection.title,
    badge,
    stateLabel: projection.state,
    tone,
    compactLine: compactSignal(`${projection.subtitle} · ${projection.latestSignal}`, 72),
    latestSignal: projection.latestSignal,
    elapsedLabel: "",
    expandable: true,
    blocking: projection.blocking,
    allowedActions: projection.actions,
  };
}

export function buildDetail(projection: AgentActivityProjection): DetailVM {
  return {
    id: projection.id,
    title: projection.title,
    rows: [
      { label: "State", value: projection.state },
      { label: "Mode", value: projection.mode },
      { label: "Agent", value: projection.agentName },
      { label: "Reference", value: projection.detailRef },
    ],
    signals: projection.signals.slice(-MAX_DETAIL_SIGNALS),
    reference: projection.detailRef,
    notice: `Showing last ${MAX_DETAIL_SIGNALS} safe signals. Raw internals remain reference-only.`,
  };
}

export function sanitizeSignal(signal: string): string {
  const line = signal.replace(/\s+/g, " ").trim();
  if (!line) return "";
  if (/^\s*(debug|trace)\b/i.test(line)) return "";
  if (/^(stdout|stderr|log)( \1){6,}/i.test(line)) return "";
  if (/<\/?thinking>/i.test(line)) return "";
  if (/^reasoning\s*:/i.test(line)) return "";
  if (/^assistant\s*:/i.test(line)) return "";
  if (/^transcript\s*:/i.test(line)) return "";
  try {
    const parsed = JSON.parse(line) as { type?: unknown };
    if (typeof parsed.type === "string" && /^(message\.|session\.|step_|step-|tool\.|event\.)/.test(parsed.type)) {
      return "";
    }
  } catch {
    // keep non-json lines
  }

  return compactSignal(line);
}

export function compactSignal(signal: string, max = MAX_SIGNAL_CHARS): string {
  const compact = signal.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length <= max ? compact : `${compact.slice(0, Math.max(1, max - 1))}…`;
}


function collectSignals(sources: readonly AgentActivitySource[]): ProjectedSignal[] {
  let redacted = false;
  const signals: ProjectedSignal[] = sources
    .flatMap((source) => [source.latestSignal, ...(source.progressSignals ?? []), source.resultPreview, source.errorPreview])
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      const sanitized = sanitizeSignal(value);
      if (!sanitized && value.trim().length > 0) redacted = true;
      return sanitized;
    })
    .filter((value): value is string => Boolean(value))
    .map((text) => ({ kind: "progress", text }));

  if (redacted) {
    signals.push({ kind: "reference", text: "Raw internal events omitted; inspect by reference." });
  }

  return signals.slice(-MAX_DETAIL_SIGNALS);
}

function normalizeMode(mode: AgentActivitySource["mode"]): ActivityMode {
  const value = `${mode ?? ""}`.toLowerCase();
  if (value === "bg" || value === "background") return "background";
  if (value === "fg" || value === "foreground") return "foreground";
  return "unknown";
}


function normalizeState(status: string | undefined): ActivityState {
  const value = (status ?? "").toLowerCase();
  if (["queued", "pending"].includes(value)) return "queued";
  if (["running", "in_progress", "active"].includes(value)) return "running";
  if (["completed", "success", "done"].includes(value)) return "completed";
  if (["failed", "error"].includes(value)) return "failed";
  if (["cancelled", "canceled", "aborted", "killed"].includes(value)) return "cancelled";
  if (["detached"].includes(value)) return "detached";
  return "running";
}


function computeIdentity(source: AgentActivitySource): string {
  return source.taskId ?? source.childSessionId ?? source.id;
}

function selectAuthoritative(sources: readonly AgentActivitySource[]): AgentActivitySource {
  const sorted = [...sources].sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
  return sorted[0] ?? sources[0]!;
}

function sourceRank(source: ActivitySourceKind): number {
  switch (source) {
    case "core-task":
      return 0;
    case "control-active-task":
      return 1;
    case "orchestrator-snippet":
      return 2;
    case "host-event":
      return 3;
    case "delivery":
      return 4;
    default:
      return 10;
  }
}
