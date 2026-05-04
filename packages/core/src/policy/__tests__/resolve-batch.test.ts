/**
 * RED gate for PolicyResolver.resolveBatch — Phase 8.5
 *
 * Spec: tasks.md 8.5 — "PolicyResolver batch decision test"
 *
 * resolveBatch(agentNames: string[], config, sessionOverride?) returns
 * PolicyDecision[] where each entry has { call_id, agent_name, mode }.
 *
 * Config shape from opencode.json bgSubagents.policy:
 *   { [agentName | "*"]: "background" | "foreground" }
 *
 * Priority:
 *   1. sessionOverride (if set to "bg" or "fg") wins for ALL entries
 *   2. per-agent exact-match from config
 *   3. wildcard "*" key falls back when no exact match
 *   4. hardcoded fallback: "background" (plan review: when no config exists, go BG)
 *
 * sessionOverride values:
 *   "bg"      → force all to "background"
 *   "fg"      → force all to "foreground"
 *   "default" → ignore (same as undefined) → per-agent config
 *   undefined → per-agent config
 *
 * Scenarios:
 *   - per-agent exact match returns correct mode
 *   - wildcard "*" fallback when agent not in config
 *   - sessionOverride "bg" wins over per-agent config
 *   - sessionOverride "fg" wins over per-agent config
 *   - sessionOverride "default" reverts to per-agent config
 *   - empty agentNames returns empty array
 *   - multiple agents with mixed modes
 *   - call_id is preserved in the output
 */

import { describe, expect, it } from "vitest";

import { resolveBatch, type BatchPolicyInput } from "../resolve-batch.js";
import type { PolicyDecision } from "../resolve-batch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  entries: Array<{ call_id: string; agent_name: string }>,
  policy: Record<string, "background" | "foreground">,
  sessionOverride?: "bg" | "fg" | "default",
): BatchPolicyInput {
  return { entries, policy, sessionOverride };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveBatch — empty input", () => {
  it("returns empty array when entries is empty", () => {
    const result = resolveBatch(makeInput([], { "*": "background" }));
    expect(result).toHaveLength(0);
  });
});

describe("resolveBatch — per-agent exact match", () => {
  it("uses per-agent config for a known agent name → background", () => {
    const result = resolveBatch(
      makeInput(
        [{ call_id: "call_1", agent_name: "sdd-explore" }],
        { "sdd-explore": "background", "*": "foreground" },
      ),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.mode).toBe("background");
    expect(result[0]!.agent_name).toBe("sdd-explore");
    expect(result[0]!.call_id).toBe("call_1");
  });

  it("uses per-agent config for a known agent name → foreground", () => {
    const result = resolveBatch(
      makeInput(
        [{ call_id: "call_2", agent_name: "sdd-apply" }],
        { "sdd-apply": "foreground", "*": "background" },
      ),
    );
    expect(result[0]!.mode).toBe("foreground");
  });
});

describe("resolveBatch — wildcard fallback", () => {
  it("falls back to wildcard '*' when agent not in config", () => {
    const result = resolveBatch(
      makeInput(
        [{ call_id: "call_wc", agent_name: "unknown-agent" }],
        { "*": "background" },
      ),
    );
    expect(result[0]!.mode).toBe("background");
  });

  it("wildcard '*' as foreground applies to unrecognized agents", () => {
    const result = resolveBatch(
      makeInput(
        [{ call_id: "call_wc2", agent_name: "custom-agent" }],
        { "*": "foreground" },
      ),
    );
    expect(result[0]!.mode).toBe("foreground");
  });

  it("falls back to 'background' hardcoded when no '*' key and no exact match", () => {
    const result = resolveBatch(
      makeInput(
        [{ call_id: "call_fallback", agent_name: "unknown-agent" }],
        { "sdd-explore": "foreground" }, // no wildcard, no match
      ),
    );
    expect(result[0]!.mode).toBe("background");
  });
});

describe("resolveBatch — session override 'bg'", () => {
  it("sessionOverride 'bg' forces all entries to background", () => {
    const result = resolveBatch(
      makeInput(
        [
          { call_id: "c1", agent_name: "sdd-apply" },   // config says FG
          { call_id: "c2", agent_name: "sdd-explore" }, // config says BG
        ],
        { "sdd-apply": "foreground", "sdd-explore": "background" },
        "bg",
      ),
    );
    expect(result).toHaveLength(2);
    for (const dec of result) {
      expect(dec.mode).toBe("background");
    }
  });
});

describe("resolveBatch — session override 'fg'", () => {
  it("sessionOverride 'fg' forces all entries to foreground", () => {
    const result = resolveBatch(
      makeInput(
        [
          { call_id: "c1", agent_name: "sdd-explore" }, // config says BG
          { call_id: "c2", agent_name: "sdd-tasks" },   // config says BG
        ],
        { "sdd-explore": "background", "*": "background" },
        "fg",
      ),
    );
    expect(result).toHaveLength(2);
    for (const dec of result) {
      expect(dec.mode).toBe("foreground");
    }
  });
});

describe("resolveBatch — session override 'default'", () => {
  it("sessionOverride 'default' reverts to per-agent config", () => {
    const result = resolveBatch(
      makeInput(
        [
          { call_id: "c1", agent_name: "sdd-apply" },
          { call_id: "c2", agent_name: "sdd-explore" },
        ],
        { "sdd-apply": "foreground", "sdd-explore": "background" },
        "default",
      ),
    );
    const byCallId = Object.fromEntries(result.map((d) => [d.call_id, d.mode]));
    expect(byCallId["c1"]).toBe("foreground");
    expect(byCallId["c2"]).toBe("background");
  });
});

describe("resolveBatch — multiple agents mixed", () => {
  it("returns one PolicyDecision per entry with correct mode", () => {
    const result = resolveBatch(
      makeInput(
        [
          { call_id: "e1", agent_name: "sdd-explore" },
          { call_id: "e2", agent_name: "sdd-apply" },
          { call_id: "e3", agent_name: "sdd-verify" },
        ],
        {
          "sdd-explore": "background",
          "sdd-apply":   "foreground",
          "*":           "background",
        },
      ),
    );
    expect(result).toHaveLength(3);
    const byCallId = Object.fromEntries(result.map((d) => [d.call_id, d.mode]));
    expect(byCallId["e1"]).toBe("background");
    expect(byCallId["e2"]).toBe("foreground");
    expect(byCallId["e3"]).toBe("background"); // wildcard
  });
});

describe("resolveBatch — output shape", () => {
  it("each PolicyDecision has call_id, agent_name, and mode", () => {
    const result = resolveBatch(
      makeInput(
        [{ call_id: "call_shape", agent_name: "sdd-explore" }],
        { "sdd-explore": "background" },
      ),
    );
    const dec: PolicyDecision = result[0]!;
    expect(typeof dec.call_id).toBe("string");
    expect(typeof dec.agent_name).toBe("string");
    expect(["background", "foreground"]).toContain(dec.mode);
  });
});
