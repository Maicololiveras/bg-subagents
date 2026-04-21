/**
 * RED gate for `src/obs/paths.ts`.
 *
 * Path resolution contract — unifies the XDG-with-Windows-fallback logic used
 * across the codebase (FR-5, NFR-6). All resolvers are pure functions of
 * `process.env` + `os.platform()` + `os.homedir()`.
 *
 * NOTE: Node forbids `vi.spyOn(os, "platform")` and `vi.spyOn(os, "homedir")`
 * (non-configurable own properties). Branches are exercised via the
 * `__forPlatform__` dependency-injection seam + real env-var swaps (HOME /
 * USERPROFILE drive `os.homedir()` on POSIX / Windows respectively). That
 * keeps the tests deterministic without mutating `os` internals.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

import {
  __forPlatform__,
  expandEnv,
  expandTilde,
  resolveConfigDir,
  resolveHistoryPath,
  resolvePolicyPath,
  resolveStateDir,
  safePathSegment,
} from "../paths.js";

// -----------------------------------------------------------------------------
// Helpers — clean env per test
// -----------------------------------------------------------------------------

const ENV_KEYS = [
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HOME",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    const v = snap[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

// -----------------------------------------------------------------------------
// resolveConfigDir
// -----------------------------------------------------------------------------

describe("resolveConfigDir", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it("POSIX: uses $XDG_CONFIG_HOME/bg-subagents when set", () => {
    process.env["XDG_CONFIG_HOME"] = "/custom/xdg";
    expect(resolveConfigDir(__forPlatform__("linux"))).toBe(
      path.join("/custom/xdg", "bg-subagents"),
    );
  });

  it("POSIX: falls back to ~/.config/bg-subagents when XDG unset", () => {
    expect(resolveConfigDir(__forPlatform__("linux", "/home/m"))).toBe(
      path.join("/home/m", ".config", "bg-subagents"),
    );
  });

  it("Windows: uses %APPDATA%\\bg-subagents when set", () => {
    process.env["APPDATA"] = "C:\\Users\\m\\AppData\\Roaming";
    const result = resolveConfigDir(__forPlatform__("win32", "C:\\Users\\m"));
    expect(result).toBe(path.join("C:\\Users\\m\\AppData\\Roaming", "bg-subagents"));
  });

  it("Windows: falls back to %USERPROFILE%\\.config\\bg-subagents when APPDATA unset", () => {
    expect(resolveConfigDir(__forPlatform__("win32", "C:\\Users\\m"))).toBe(
      path.join("C:\\Users\\m", ".config", "bg-subagents"),
    );
  });
});

// -----------------------------------------------------------------------------
// resolveStateDir
// -----------------------------------------------------------------------------

describe("resolveStateDir", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it("POSIX: uses $XDG_STATE_HOME/bg-subagents when set", () => {
    process.env["XDG_STATE_HOME"] = "/custom/state";
    expect(resolveStateDir(__forPlatform__("darwin"))).toBe(
      path.join("/custom/state", "bg-subagents"),
    );
  });

  it("POSIX: falls back to ~/.local/state/bg-subagents", () => {
    expect(resolveStateDir(__forPlatform__("linux", "/home/m"))).toBe(
      path.join("/home/m", ".local", "state", "bg-subagents"),
    );
  });

  it("Windows: uses %LOCALAPPDATA%\\bg-subagents when set", () => {
    process.env["LOCALAPPDATA"] = "C:\\Users\\m\\AppData\\Local";
    expect(resolveStateDir(__forPlatform__("win32", "C:\\Users\\m"))).toBe(
      path.join("C:\\Users\\m\\AppData\\Local", "bg-subagents"),
    );
  });

  it("Windows: falls back to %USERPROFILE%\\.local\\state\\bg-subagents", () => {
    expect(resolveStateDir(__forPlatform__("win32", "C:\\Users\\m"))).toBe(
      path.join("C:\\Users\\m", ".local", "state", "bg-subagents"),
    );
  });
});

// -----------------------------------------------------------------------------
// resolveHistoryPath
// -----------------------------------------------------------------------------

describe("resolveHistoryPath", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it("uses policy override when present", () => {
    expect(resolveHistoryPath("/tmp/foo/history.jsonl")).toBe(
      "/tmp/foo/history.jsonl",
    );
  });

  it("expands tilde in policy override", () => {
    // expandTilde relies on os.homedir() — anchor expectation to it directly.
    const actualHome = os.homedir();
    expect(resolveHistoryPath("~/custom/history.jsonl")).toBe(
      path.join(actualHome, "custom", "history.jsonl"),
    );
  });

  it("defaults to state/history.jsonl when no override", () => {
    expect(
      resolveHistoryPath(undefined, __forPlatform__("linux", "/home/m")),
    ).toBe(
      path.join("/home/m", ".local", "state", "bg-subagents", "history.jsonl"),
    );
  });
});

// -----------------------------------------------------------------------------
// resolvePolicyPath
// -----------------------------------------------------------------------------

describe("resolvePolicyPath", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it("returns config/policy.jsonc", () => {
    expect(resolvePolicyPath(__forPlatform__("linux", "/home/m"))).toBe(
      path.join("/home/m", ".config", "bg-subagents", "policy.jsonc"),
    );
  });
});

// -----------------------------------------------------------------------------
// safePathSegment
// -----------------------------------------------------------------------------

describe("safePathSegment", () => {
  it("replaces colons with dashes (Windows)", () => {
    expect(safePathSegment("2026:04:20")).toBe("2026-04-20");
  });

  it("replaces other illegal chars: * ? \" < > |", () => {
    expect(safePathSegment('a*b?c"d<e>f|g')).toBe("a-b-c-d-e-f-g");
  });

  it("preserves safe chars (alphanumeric, dot, underscore, dash)", () => {
    expect(safePathSegment("foo_bar-baz.123")).toBe("foo_bar-baz.123");
  });

  it("collapses path separators (forward + back slash)", () => {
    expect(safePathSegment("a/b\\c")).toBe("a-b-c");
  });
});

// -----------------------------------------------------------------------------
// expandTilde
// -----------------------------------------------------------------------------

describe("expandTilde", () => {
  it("expands leading ~/ to the real homedir", () => {
    const home = os.homedir();
    expect(expandTilde("~/foo/bar")).toBe(path.join(home, "foo", "bar"));
  });

  it("returns bare ~ as homedir", () => {
    expect(expandTilde("~")).toBe(os.homedir());
  });

  it("leaves other paths alone", () => {
    expect(expandTilde("/abs/path")).toBe("/abs/path");
    expect(expandTilde("rel/path")).toBe("rel/path");
    expect(expandTilde("~user/foo")).toBe("~user/foo");
  });
});

// -----------------------------------------------------------------------------
// expandEnv
// -----------------------------------------------------------------------------

describe("expandEnv", () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it("Windows: expands %VAR% tokens", () => {
    process.env["APPDATA"] = "C:\\App";
    expect(expandEnv("%APPDATA%\\foo", __forPlatform__("win32"))).toBe(
      "C:\\App\\foo",
    );
  });

  it("POSIX: expands $VAR tokens", () => {
    process.env["HOME"] = "/home/m";
    expect(expandEnv("$HOME/foo", __forPlatform__("linux"))).toBe("/home/m/foo");
  });

  it("POSIX: expands ${VAR} tokens", () => {
    process.env["HOME"] = "/home/m";
    expect(expandEnv("${HOME}/foo", __forPlatform__("linux"))).toBe("/home/m/foo");
  });

  it("leaves unset variables as-is (no accidental empty string)", () => {
    expect(expandEnv("$NOT_SET/foo", __forPlatform__("linux"))).toBe(
      "$NOT_SET/foo",
    );
  });
});
