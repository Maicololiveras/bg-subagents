import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatCodexStatusLines,
  parseCodexStatus,
  runCodexStatusPoll,
  type CodexStatusExecutor,
  type CodexStatusPollState,
} from "./codex-status.js";

const SAMPLE = `Model: gpt-5.5 (high reasoning)\nAccount: user@example.com\nSession: 123e4567-e89b-12d3-a456-426614174000\nContext window: 82% left (164k used)\n5h limit: 51% left\nWeekly limit: 45% left\n`;

function outputPath(): string {
  return join(mkdtempSync(join(tmpdir(), "codex-status-")), "codex_status.json");
}

describe("codex status", () => {
  it("parses codex /status fields and percentages", () => {
    const snapshot = parseCodexStatus(SAMPLE, new Date("2026-05-04T10:00:00.000Z"));

    expect(snapshot).toMatchObject({
      timestamp: "2026-05-04T10:00:00.000Z",
      model: "gpt-5.5 (high reasoning)",
      account: "user@example.com",
      session: "123e4567-e89b-12d3-a456-426614174000",
      usage: {
        contextAvailable: "82%",
        limit5h: "51%",
        weeklyLimit: "45%",
      },
      raw: SAMPLE,
    });
  });

  it("keeps raw output and tolerates missing fields", () => {
    const raw = "Model: gpt-5.5\nContext window: 7% left\n";
    const snapshot = parseCodexStatus(raw);

    expect(snapshot.raw).toBe(raw);
    expect(snapshot.model).toBe("gpt-5.5");
    expect(snapshot.account).toBeUndefined();
    expect(snapshot.session).toBeUndefined();
    expect(snapshot.usage).toEqual({ contextAvailable: "7%" });
  });

  it("formats compact sidebar lines", () => {
    const snapshot = parseCodexStatus(SAMPLE);

    expect(formatCodexStatusLines(snapshot)).toEqual([
      "gpt-5.5 (high reasoning) · 82% ctx",
      "5h 51% · week 45%",
    ]);
    expect(formatCodexStatusLines()).toEqual(["Codex status: esperando..."]);
    expect(formatCodexStatusLines({
      timestamp: "now",
      usage: {},
      raw: "",
      error: "missing codex",
    })).toEqual(["Codex status: no disponible"]);
  });

  it("does not overlap polls while one is in flight", async () => {
    let calls = 0;
    let resolveFirst: (value: string) => void = () => undefined;
    const executor: CodexStatusExecutor = (() => {
      calls++;
      return new Promise<string>((resolve) => {
        resolveFirst = resolve;
      });
    }) as CodexStatusExecutor;
    const state: CodexStatusPollState = { inFlight: false };

    const first = runCodexStatusPoll({ state, executor, outputPath: outputPath() });
    const skipped = await runCodexStatusPoll({ state, executor, outputPath: outputPath() });

    expect(skipped).toBeUndefined();
    expect(calls).toBe(1);

    resolveFirst(SAMPLE);
    const snapshot = await first;

    expect(snapshot?.model).toBe("gpt-5.5 (high reasoning)");
    expect(state.inFlight).toBe(false);
  });
});
