/**
 * Tests for the policy loader.
 *
 * Covers FR-12 + Scenario 7 (invalid policy.jsonc → fail-closed with clear error)
 * and Q3 resolution (major schema bump fail-closed, minor auto-migrate with .bak).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  HARDCODED_DEFAULT_POLICY,
  loadPolicy,
  type LoadedPolicy,
} from "../loader.js";
import { PolicyValidationError } from "@maicolextic/bg-subagents-protocol";

// Unique temp dir per test to keep parallel vitest workers isolated.
async function mkTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bg-subagents-loader-"));
  return dir;
}

describe("loadPolicy", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkTempDir();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads a valid .jsonc file (with comments + trailing commas) and returns parsed + validated Policy", async () => {
    const file = path.join(tmpDir, "policy.jsonc");
    const jsonc = `{
      // top-of-file comment
      "default_mode_by_agent_type": {
        "research": "background", // trailing comment
      },
      "timeout_ms": 1500,
      /* block comment */
      "telemetry": { "enabled": false },
    }`;
    await fs.writeFile(file, jsonc, "utf8");

    const loaded: LoadedPolicy = await loadPolicy(file);

    expect(loaded.source).toBe("file");
    expect(loaded.policy.default_mode_by_agent_type).toEqual({
      research: "background",
    });
    expect(loaded.policy.timeout_ms).toBe(1500);
    expect(loaded.policy.telemetry.enabled).toBe(false);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.migrated).toBeUndefined();
  });

  it("returns hardcoded default policy with source: 'default' when file does not exist", async () => {
    const missing = path.join(tmpDir, "does-not-exist.jsonc");

    const loaded = await loadPolicy(missing);

    expect(loaded.source).toBe("default");
    expect(loaded.policy).toEqual(HARDCODED_DEFAULT_POLICY);
    // Non-fatal; warning about missing file is acceptable.
    expect(loaded.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("throws PolicyValidationError with file path + approx line/col on fatal JSONC syntax error", async () => {
    const file = path.join(tmpDir, "bad.jsonc");
    // Unterminated string — fatal parse error.
    await fs.writeFile(file, '{ "timeout_ms": 2000, "bogus": "open', "utf8");

    await expect(loadPolicy(file)).rejects.toBeInstanceOf(PolicyValidationError);
    try {
      await loadPolicy(file);
      expect.fail("loadPolicy should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyValidationError);
      const pve = err as PolicyValidationError;
      // jsonc-parser gives us offset → we translate to line/col.
      expect(typeof pve.approx_line).toBe("number");
      expect(pve.message).toContain("Policy validation failed");
    }
  });

  it("throws PolicyValidationError with zod-flatten path on schema-invalid file", async () => {
    const file = path.join(tmpDir, "schema-invalid.jsonc");
    // `default_mode_by_agent_type` must be a record of Mode; string is invalid.
    await fs.writeFile(
      file,
      '{ "default_mode_by_agent_type": "not-an-object" }',
      "utf8",
    );

    await expect(loadPolicy(file)).rejects.toBeInstanceOf(PolicyValidationError);
    try {
      await loadPolicy(file);
      expect.fail("loadPolicy should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyValidationError);
      const pve = err as PolicyValidationError;
      expect(pve.path).toContain("default_mode_by_agent_type");
      // zod flatten surfaces type mismatch
      expect(pve.got.toLowerCase()).toMatch(/string/);
    }
  });

  it("fails closed on MAJOR schema mismatch with upgrade URL in error message", async () => {
    const file = path.join(tmpDir, "v2.jsonc");
    const jsonc = `{
      "$schema": "https://bg-subagents.dev/schema/policy-v2.json",
      "default_mode_by_agent_type": {}
    }`;
    await fs.writeFile(file, jsonc, "utf8");

    await expect(loadPolicy(file)).rejects.toBeInstanceOf(PolicyValidationError);
    try {
      await loadPolicy(file);
      expect.fail("loadPolicy should have thrown on major bump");
    } catch (err) {
      const pve = err as PolicyValidationError;
      expect(pve.message).toMatch(/upgrade|migration|schema/i);
      expect(pve.message).toContain("policy-v1.json");
    }
  });

  it("auto-migrates compatible MINOR schema bump + writes .bak sidecar + returns warning", async () => {
    const file = path.join(tmpDir, "v1-minor.jsonc");
    // A minor bump like v1.5 should still load but warn.
    const jsonc = `{
      "$schema": "https://bg-subagents.dev/schema/policy-v1.5.json",
      "default_mode_by_agent_type": { "research": "background" }
    }`;
    await fs.writeFile(file, jsonc, "utf8");

    const loaded = await loadPolicy(file);

    expect(loaded.source).toBe("file");
    expect(loaded.migrated).toBe(true);
    expect(loaded.warnings.length).toBeGreaterThanOrEqual(1);
    expect(loaded.warnings.join(" ")).toMatch(/minor|migrat/i);

    // .bak sidecar exists with original content
    const bakFiles = (await fs.readdir(tmpDir)).filter((f) =>
      f.startsWith("v1-minor.jsonc.bak"),
    );
    expect(bakFiles.length).toBeGreaterThanOrEqual(1);
    const firstBak = bakFiles[0];
    expect(firstBak).toBeDefined();
    const bakContent = await fs.readFile(
      path.join(tmpDir, firstBak as string),
      "utf8",
    );
    expect(bakContent).toContain("policy-v1.5.json");
  });

  it("exposes LoadedPolicy shape: policy + source + warnings + optional migrated", async () => {
    const file = path.join(tmpDir, "valid.jsonc");
    await fs.writeFile(file, '{ "timeout_ms": 500 }', "utf8");

    const loaded = await loadPolicy(file);

    // Shape sanity — enforces the public contract.
    expect(loaded).toHaveProperty("policy");
    expect(loaded).toHaveProperty("source");
    expect(loaded).toHaveProperty("warnings");
    expect(["file", "default"]).toContain(loaded.source);
    expect(Array.isArray(loaded.warnings)).toBe(true);
  });

  it("uses the default path when no path argument is provided", async () => {
    // We cannot write to the real user home during tests. Instead we assert
    // that calling loadPolicy() (no args) does not throw unexpectedly when the
    // default file does not exist — it must fall back to HARDCODED defaults.
    const loaded = await loadPolicy();
    // Either loads a real user file (source: "file") or falls back (source: "default").
    expect(["file", "default"]).toContain(loaded.source);
  });
});
