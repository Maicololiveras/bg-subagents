import { describe, expect, it } from "vitest";

import { createCodexAnalyticsWebProvider } from "./codex-analytics-web.js";

const SAMPLE = `
Límite de uso de 5 horas
65% restante
Se restablecerá 7:37 p.m.
Límite de uso semanal
32% restante
Se restablecerá 5 may 2026 8:22 p.m.
Créditos restantes
0
`;

describe("codex analytics web provider", () => {
  it("reads analytics through an injected page text provider", async () => {
    const provider = createCodexAnalyticsWebProvider({
      pageTextProvider: async () => SAMPLE,
    });

    const snapshot = await provider.read(new Date("2026-05-04T10:00:00.000Z"));

    expect(snapshot).toMatchObject({
      timestamp: "2026-05-04T10:00:00.000Z",
      source: "chatgpt-web-analytics",
      usage: {
        limit5h: "65%",
        limit5hReset: "7:37 p.m.",
        weeklyLimit: "32%",
        weeklyLimitReset: "5 may 2026 8:22 p.m.",
        creditsRemaining: "0",
      },
    });
  });

  it("throws an actionable error when the profile is not logged in", async () => {
    const provider = createCodexAnalyticsWebProvider({
      profileDir: "test-profile",
      pageTextProvider: async () => "Log in Sign up",
    });

    await expect(provider.read()).rejects.toThrow(
      "ChatGPT Codex analytics requires login in the dedicated browser profile: test-profile",
    );
  });
});
