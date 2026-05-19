import type { CodexStatusSnapshot } from "./codex-status.js";

export type CodexAnalyticsUsage = Pick<
  CodexStatusSnapshot["usage"],
  "limit5h" | "limit5hReset" | "weeklyLimit" | "weeklyLimitReset" | "creditsRemaining"
>;

function normalizeAnalyticsText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[1]?.trim();
}

function percent(value: string | undefined): string | undefined {
  return value ? `${value}%` : undefined;
}

export function sanitizeCodexAnalyticsText(text: string): string {
  return normalizeAnalyticsText(text)
    .split("\n")
    .filter((line) => !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line))
    .join("\n");
}

function summarizeUsage(usage: CodexAnalyticsUsage): string {
  return [
    usage.limit5h ? `5h limit: ${usage.limit5h}` : undefined,
    usage.limit5hReset ? `5h reset: ${usage.limit5hReset}` : undefined,
    usage.weeklyLimit ? `weekly limit: ${usage.weeklyLimit}` : undefined,
    usage.weeklyLimitReset ? `weekly reset: ${usage.weeklyLimitReset}` : undefined,
    usage.creditsRemaining ? `credits remaining: ${usage.creditsRemaining}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseCodexAnalyticsUsage(text: string): CodexAnalyticsUsage {
  const clean = normalizeAnalyticsText(text);
  const usage: CodexAnalyticsUsage = {};
  const limit5hBlock = firstMatch(
    clean,
    /L[ií]mite de uso de 5 horas\n([\s\S]*?)(?=\nL[ií]mite de uso semanal\b|\nCr[eé]ditos restantes\b|$)/i,
  );
  const weeklyBlock = firstMatch(
    clean,
    /L[ií]mite de uso semanal\n([\s\S]*?)(?=\nCr[eé]ditos restantes\b|$)/i,
  );

  const limit5h = percent(firstMatch(limit5hBlock ?? "", /\b(\d{1,3})\s*%\s*restante\b/i));
  const limit5hReset = firstMatch(limit5hBlock ?? "", /Se restablecer[aá]\s+(.+)/i);
  const weeklyLimit = percent(firstMatch(weeklyBlock ?? "", /\b(\d{1,3})\s*%\s*restante\b/i));
  const weeklyLimitReset = firstMatch(weeklyBlock ?? "", /Se restablecer[aá]\s+(.+)/i);
  const creditsRemaining = firstMatch(clean, /Cr[eé]ditos restantes\n\s*(\d+)\b/i);

  if (limit5h) usage.limit5h = limit5h;
  if (limit5hReset) usage.limit5hReset = limit5hReset;
  if (weeklyLimit) usage.weeklyLimit = weeklyLimit;
  if (weeklyLimitReset) usage.weeklyLimitReset = weeklyLimitReset;
  if (creditsRemaining) usage.creditsRemaining = creditsRemaining;

  return usage;
}

export function parseCodexAnalyticsSnapshot(
  text: string,
  now = new Date(),
): CodexStatusSnapshot {
  const usage = parseCodexAnalyticsUsage(text);
  return {
    timestamp: now.toISOString(),
    source: "chatgpt-web-analytics",
    model: "codex",
    usage,
    raw: summarizeUsage(usage),
  };
}
