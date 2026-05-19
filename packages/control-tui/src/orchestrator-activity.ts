import { createSignal, type Accessor, type Setter } from "solid-js";

import { compactTaskSignal, type TaskRegistry } from "./events.js";

export type OrchestratorActivityKind = "thinking" | "tool" | "status" | "delivery";

export interface OrchestratorActivitySnippet {
  readonly sessionID: string;
  readonly turnID: string;
  readonly kind: OrchestratorActivityKind;
  readonly text: string;
  readonly timestamp: number;
}

export interface OrchestratorActivityRegistry {
  readonly snippets: Accessor<readonly OrchestratorActivitySnippet[]>;
  readonly setSnippets: Setter<OrchestratorActivitySnippet[]>;
  readonly append: (snippet: OrchestratorActivitySnippet) => void;
}

const MAX_ORCHESTRATOR_SNIPPETS = 24;
const MAX_RENDERED_LINES = 6;

export function createOrchestratorActivityRegistry(): OrchestratorActivityRegistry {
  const [snippets, setSnippets] = createSignal<OrchestratorActivitySnippet[]>([]);
  const append = (snippet: OrchestratorActivitySnippet) => {
    setSnippets((prev) => [...prev, snippet].slice(-MAX_ORCHESTRATOR_SNIPPETS));
  };
  return { snippets, setSnippets, append };
}

export interface OrchestratorSubscriptionOpts {
  readonly registry: OrchestratorActivityRegistry;
  readonly taskRegistry: Pick<TaskRegistry, "getTask">;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly api: any;
}

export function formatOrchestratorActivityLines(
  snippets: readonly OrchestratorActivitySnippet[],
  maxLines = MAX_RENDERED_LINES,
): readonly string[] {
  return collapseOrchestratorSnippetDuplicates(snippets).slice(-maxLines).map((snippet) => {
    const label = snippet.kind === "thinking"
      ? "think"
      : snippet.kind === "tool"
        ? "tool"
        : snippet.kind === "delivery"
          ? "deliver"
          : "status";
    return `${label}: ${snippet.text}`;
  });
}

export function collapseOrchestratorSnippetDuplicates(
  snippets: readonly OrchestratorActivitySnippet[],
): readonly OrchestratorActivitySnippet[] {
  const deduped = new Map<string, OrchestratorActivitySnippet>();
  for (const snippet of snippets) {
    deduped.set(`${snippet.sessionID}:${snippet.turnID}:${snippet.kind}:${snippet.text}`, snippet);
  }
  return [...deduped.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function subscribeToOrchestratorActivity(opts: OrchestratorSubscriptionOpts): () => void {
  const { registry, taskRegistry, api } = opts;

  const disposePartUpdated = api.event.on(
    "message.part.updated",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      const sessionID = extractSessionID(event);
      if (!sessionID || taskRegistry.getTask(sessionID)) return;
      const text = extractActivityText(event);
      if (!text) return;
      registry.append({
        sessionID,
        turnID: extractTurnID(event),
        kind: classifyActivity(event, text),
        text,
        timestamp: Date.now(),
      });
    },
  );

  const disposeStatus = api.event.on(
    "session.status",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      const sessionID = extractSessionID(event);
      if (!sessionID || taskRegistry.getTask(sessionID)) return;
      const status = event?.properties?.status ?? event?.status;
      const text = compactTaskSignal(typeof status === "string" ? `status: ${status}` : undefined);
      if (!text) return;
      registry.append({
        sessionID,
        turnID: extractTurnID(event),
        kind: "status",
        text,
        timestamp: Date.now(),
      });
    },
  );

  return () => {
    disposePartUpdated?.();
    disposeStatus?.();
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSessionID(event: any): string | undefined {
  if (typeof event?.properties?.sessionID === "string") return event.properties.sessionID;
  if (typeof event?.sessionID === "string") return event.sessionID;
  if (typeof event?.properties?.info?.id === "string") return event.properties.info.id;
  if (typeof event?.session?.id === "string") return event.session.id;
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTurnID(event: any): string {
  const props = event?.properties ?? event;
  return props?.messageID ?? props?.messageId ?? props?.turnID ?? props?.turnId ?? "current";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractActivityText(event: any): string | undefined {
  const props = event?.properties ?? event;
  const part = props?.part ?? event?.part;
  const toolName = part?.toolName ?? part?.tool ?? props?.toolName ?? props?.tool;
  if (typeof toolName === "string") return compactTaskSignal(toolName, 96);
  return compactTaskSignal(part?.text ?? props?.text ?? props?.delta ?? props?.message ?? props?.summary, 96);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classifyActivity(event: any, text: string): OrchestratorActivityKind {
  const props = event?.properties ?? event;
  const part = props?.part ?? event?.part;
  const partType = String(part?.type ?? props?.type ?? "").toLowerCase();
  const lower = text.toLowerCase();
  if (partType.includes("tool") || part?.toolName || props?.toolName) return "tool";
  if (lower.includes("referencia:") || lower.includes("que hizo") || lower.includes("qué hizo")) return "delivery";
  if (partType.includes("reason") || partType.includes("think")) return "thinking";
  return "status";
}
