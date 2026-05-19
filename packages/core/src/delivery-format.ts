import type { TranscriptSummaryVM } from "./activity-projection.js";

export interface CompactDeliveryInput {
  readonly taskId?: string;
  readonly agent?: string;
  readonly description?: string;
  readonly status: "completed" | "error" | "cancelled" | "running" | string;
  readonly resultText?: string;
  readonly error?: string;
  readonly reference?: string;
}

const MAX_DELIVERY_CHARS = 1_600;
const MAX_RAW_LINES = 8;
const STRUCTURED_MARKERS = [
  "status:",
  "executive_summary:",
  "artifacts:",
  "changes:",
  "validation:",
  "risks:",
  "next_recommended:",
  "qué hizo",
  "que hizo",
  "qué encontró",
  "que encontro",
  "qué falta",
  "que falta",
  "siguiente paso",
];

export function formatCompactAgentDelivery(input: CompactDeliveryInput): string {
  const vm = formatCompactDeliverySummary(input);
  return hardLimit(`${vm.text}\n\nReferencia: ${vm.reference}`);
}

export function formatCompactDeliverySummary(input: CompactDeliveryInput): TranscriptSummaryVM {
  const statusIcon = input.status === "error" ? "✗ error" : input.status === "cancelled" ? "cancelled" : "✓ completed";
  const who = input.agent ? `**[${input.agent}]**` : "**[bg-subagents]**";
  const description = input.description ? ` — ${input.description}` : "";
  const taskRef = input.taskId ? `task ${input.taskId}` : "task";
  const reference = input.reference ?? (input.taskId ? `Logs/history: ${input.taskId}` : "Logs/history available on demand.");
  const activityId = input.taskId ?? "task:unknown";

  if (input.status === "error") {
    return {
      activityId,
      shouldEmit: true,
      reference,
      text: hardLimit([
      `${who}${description} · ${statusIcon}`,
      "",
      `- Qué hizo: intentó ejecutar ${taskRef}.`,
      `- Qué encontró: ${oneLine(input.error ?? input.resultText ?? "Error desconocido")}`,
      "- Qué falta / estado: falló; el detalle completo queda en logs/history.",
      "- Siguiente paso recomendado: revisar el error y reintentar si corresponde.",
    ].join("\n")),
    };
  }

  const text = normalize(input.resultText);
  if (text && isStructuredCompact(text)) {
    return {
      activityId,
      shouldEmit: true,
      reference,
      text: hardLimit([
      `${who}${description} · ${statusIcon}`,
      "",
      text,
    ].join("\n")),
    };
  }

  const excerpt = text ? rawExcerpt(text) : "Sin resultado textual entregado.";
  const omitted = text.length > excerpt.length ? " El transcript/stdout completo queda en logs/history." : "";

  return {
    activityId,
    shouldEmit: true,
    reference,
    text: hardLimit([
      `${who}${description} · ${statusIcon}`,
      "",
      `- Qué hizo: completó ${taskRef}.`,
      `- Qué encontró: ${excerpt}`,
      `- Qué falta / estado: ${input.status === "completed" ? "completado" : input.status}.${omitted}`,
      "- Siguiente paso recomendado: revisar el resumen y pedir logs si necesitás el detalle completo.",
    ].join("\n")),
  };
}

function normalize(value: string | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function isStructuredCompact(text: string): boolean {
  if (text.length > MAX_DELIVERY_CHARS) return false;
  const lower = text.toLowerCase();
  return STRUCTURED_MARKERS.filter((marker) => lower.includes(marker)).length >= 2;
}

function rawExcerpt(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !looksLikeNoise(line))
    .slice(0, MAX_RAW_LINES);
  const excerpt = lines.length > 0 ? lines.join(" / ") : oneLine(text);
  return oneLine(excerpt, 700);
}

function looksLikeNoise(line: string): boolean {
  if (looksLikeReasoningOrTranscript(line)) return true;
  if (/^\s*[{}[\],]\s*$/.test(line) || /^\s*(debug|trace)\b/i.test(line)) return true;
  if (looksLikeRepeatedLogNoise(line)) return true;
  try {
    const parsed = JSON.parse(line) as { type?: unknown };
    return typeof parsed.type === "string" && /^(message\.|session\.|step_|step-|tool\.|event\.)/.test(parsed.type);
  } catch {
    return false;
  }
}

function looksLikeReasoningOrTranscript(line: string): boolean {
  const compact = line.replace(/\s+/g, " ").trim();
  if (!compact) return false;
  if (/<\/?thinking>/i.test(compact)) return true;
  if (/^reasoning\s*:/i.test(compact)) return true;
  if (/^assistant\s*:/i.test(compact)) return true;
  if (/^transcript\s*:/i.test(compact)) return true;
  return false;
}

function looksLikeRepeatedLogNoise(line: string): boolean {
  const compact = line.replace(/\s+/g, " ").trim().toLowerCase();
  if (compact.length < 120) return false;
  const words = compact.split(" ").filter(Boolean);
  if (words.length < 24) return false;
  const unique = new Set(words);
  if (unique.size <= 3) return true;
  return /^(stdout|stderr|log|debug|trace)( \1){8,}/.test(compact);
}

function oneLine(value: string, max = 700): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…(truncated; see logs/history)` : compact;
}

function hardLimit(value: string): string {
  if (value.length <= MAX_DELIVERY_CHARS) return value;
  return `${value.slice(0, MAX_DELIVERY_CHARS)}\n\n…(delivery compacted; see logs/history for full output)`;
}
