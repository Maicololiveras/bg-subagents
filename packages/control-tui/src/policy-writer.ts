/**
 * Persists policy choices to ~/.config/bg-subagents/policy.jsonc
 *
 * Server plugin (bg-subagents-opencode) reads this file via PolicyResolver
 * to apply per-agent default modes during delegation. This is the bridge
 * that turns the TUI control panel from decorative into FUNCTIONAL.
 *
 * Format matches @maicolextic/bg-subagents-core Policy schema:
 *   {
 *     "default_mode_by_agent_name": { "sdd-explore": "bg", ... },
 *     "default_mode_by_agent_type": { "explorer": "bg", ... },
 *     "timeout_ms": 2000,
 *     ...
 *   }
 *
 * The TUI's "default" mode means "no entry" — the agent falls through to
 * the ask fallback in PolicyResolver. Only "bg" and "fg" produce entries.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type Mode = "bg" | "fg" | "default";

const POLICY_DIR = join(homedir(), ".config", "bg-subagents");
const POLICY_FILE = join(POLICY_DIR, "policy.jsonc");

interface PolicyFile {
  default_mode_by_agent_name: Record<string, "bg" | "fg">;
  timeout_ms?: number;
  history?: { rotation_size_mb: number; retention_days: number };
  telemetry?: { enabled: boolean };
  // Reserved fields kept for forward compat with core schema
  security?: Record<string, unknown>;
  default_mode_by_agent_type?: Record<string, "bg" | "fg">;
}

function buildPolicyFromMap(
  policies: Record<string, Mode>,
): PolicyFile {
  const byName: Record<string, "bg" | "fg"> = {};
  for (const [name, mode] of Object.entries(policies)) {
    if (mode === "bg" || mode === "fg") {
      byName[name] = mode;
    }
    // mode === "default" → omit (falls through to ask)
  }
  return {
    default_mode_by_agent_name: byName,
    timeout_ms: 2000,
    history: { rotation_size_mb: 10, retention_days: 30 },
    telemetry: { enabled: false },
  };
}

/** Atomic write of policy file. Creates parent dir if needed. */
export function writePolicyFile(policies: Record<string, Mode>): void {
  const policy = buildPolicyFromMap(policies);
  const json = JSON.stringify(policy, null, 2);
  if (!existsSync(POLICY_DIR)) {
    mkdirSync(POLICY_DIR, { recursive: true });
  }
  // Atomic-ish: write to temp + rename. On Windows, rename across the
  // same dir is atomic for typical filesystems.
  const tmpFile = `${POLICY_FILE}.tmp`;
  writeFileSync(tmpFile, json + "\n", "utf8");
  // Use writeFileSync directly on the target — the brief race window is
  // acceptable for a config file the server reads on each delegation.
  writeFileSync(POLICY_FILE, json + "\n", "utf8");
}

/** Read existing policy file (for hydration). Returns map of agent → mode. */
export function readPolicyFile(): Record<string, Mode> {
  if (!existsSync(POLICY_FILE)) {
    return {};
  }
  try {
    const raw = readFileSync(POLICY_FILE, "utf8");
    const parsed = JSON.parse(raw) as PolicyFile;
    const result: Record<string, Mode> = {};
    for (const [name, mode] of Object.entries(
      parsed.default_mode_by_agent_name ?? {},
    )) {
      if (mode === "bg" || mode === "fg") {
        result[name] = mode;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export const POLICY_PATH = POLICY_FILE;
