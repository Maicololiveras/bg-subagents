import { describe, expect, it } from "vitest";

import { formatCompactAgentDelivery } from "../delivery-format.js";

describe("formatCompactAgentDelivery", () => {
  it("preserves structured delivery fields in compact parent-facing output", () => {
    const delivery = formatCompactAgentDelivery({
      taskId: "task-structured",
      agent: "sdd-apply",
      status: "completed",
      resultText: [
        "status: success",
        "executive_summary: Batch 1 completed safely.",
        "artifacts: delivery-format.test.ts",
        "risks: baseline dependencies are missing.",
        "next_recommended: run focused tests after install.",
      ].join("\n"),
      reference: "Logs/history: task-structured",
    });

    expect(delivery).toContain("executive_summary: Batch 1 completed safely.");
    expect(delivery).toContain("artifacts: delivery-format.test.ts");
    expect(delivery).toContain("Referencia: Logs/history: task-structured");
    expect(delivery.length).toBeLessThanOrEqual(1_600);
  });

  it("compacts raw NDJSON/stdout/log-like output and keeps detail available by reference", () => {
    const ndjson = [
      JSON.stringify({ type: "message.part.updated", part: { type: "text", text: "internal chunk" } }),
      JSON.stringify({ type: "session.idle", properties: { sessionID: "child-1" } }),
      "debug verbose trace that should not lead the parent transcript",
      "User-facing result line",
      "log ".repeat(500),
    ].join("\n");

    const delivery = formatCompactAgentDelivery({
      taskId: "task-raw",
      agent: "sdd-apply",
      status: "completed",
      resultText: ndjson,
      reference: "Logs/history: task-raw",
    });

    expect(delivery).toContain("User-facing result line");
    expect(delivery).toContain("Logs/history: task-raw");
    expect(delivery).not.toContain("message.part.updated");
    expect(delivery).not.toContain("session.idle");
    expect(delivery).not.toContain("log log log log log log log log log log log log");
    expect(delivery.length).toBeLessThanOrEqual(1_600);
  });

  it("rejects reasoning-like and full transcript payloads by default", () => {
    const raw = [
      "<thinking>I should inspect internal state deeply</thinking>",
      "Reasoning: step-by-step hidden chain",
      "User: what changed?",
      "Assistant: internal answer with private reasoning",
      "Visible result: task complete",
    ].join("\n");

    const delivery = formatCompactAgentDelivery({
      taskId: "task-safety",
      agent: "sdd-apply",
      status: "completed",
      resultText: raw,
      reference: "Logs/history: task-safety",
    });

    expect(delivery).toContain("Visible result: task complete");
    expect(delivery).not.toContain("<thinking>");
    expect(delivery).not.toContain("Reasoning:");
    expect(delivery).not.toContain("Assistant: internal answer");
  });
});
