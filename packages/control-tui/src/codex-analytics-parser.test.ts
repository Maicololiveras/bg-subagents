import { describe, expect, it } from "vitest";

import { parseCodexAnalyticsSnapshot, parseCodexAnalyticsUsage } from "./codex-analytics-parser.js";

const SPANISH_SAMPLE = `
Análisis de Codex
Saldo
Límite de uso de 5 horas
65% restante
Se restablecerá 7:37 p.m.
Límite de uso semanal
32% restante
Se restablecerá 5 may 2026 8:22 p.m.
Créditos restantes
0
`;

describe("codex analytics parser", () => {
  it("parses the Spanish analytics usage sample", () => {
    expect(parseCodexAnalyticsUsage(SPANISH_SAMPLE)).toEqual({
      limit5h: "65%",
      limit5hReset: "7:37 p.m.",
      weeklyLimit: "32%",
      weeklyLimitReset: "5 may 2026 8:22 p.m.",
      creditsRemaining: "0",
    });
  });

  it("tolerates extra whitespace and newlines", () => {
    const text = `Límite de uso de 5 horas\n\n  65%    restante\n Se restablecerá   7:37 p.m.\n\nLímite de uso semanal\n 32% restante\nSe restablecerá 5 may 2026 8:22 p.m.\nCréditos restantes\n 0`;

    expect(parseCodexAnalyticsUsage(text)).toEqual({
      limit5h: "65%",
      limit5hReset: "7:37 p.m.",
      weeklyLimit: "32%",
      weeklyLimitReset: "5 may 2026 8:22 p.m.",
      creditsRemaining: "0",
    });
  });

  it("returns a sanitized web snapshot without email lines", () => {
    const snapshot = parseCodexAnalyticsSnapshot(
      `maicol@example.com\n${SPANISH_SAMPLE}`,
      new Date("2026-05-04T10:00:00.000Z"),
    );

    expect(snapshot).toMatchObject({
      timestamp: "2026-05-04T10:00:00.000Z",
      source: "chatgpt-web-analytics",
      model: "codex",
      usage: { limit5h: "65%", weeklyLimit: "32%", creditsRemaining: "0" },
    });
    expect(snapshot.raw).not.toContain("maicol@example.com");
    expect(snapshot.raw).not.toContain("<html");
  });
});
