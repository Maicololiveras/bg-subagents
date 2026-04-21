/**
 * Cross-platform path resolution for bg-subagents.
 *
 * Single source of truth for XDG-with-Windows-fallback semantics (FR-5, NFR-6).
 * Consumers: policy loader (`policy/loader.ts`), history store default, CLI
 * format/commands, and host adapters that need to print paths in help text.
 *
 * Resolution table:
 *   resolveConfigDir()  — config root
 *     POSIX:   $XDG_CONFIG_HOME/bg-subagents  →  ~/.config/bg-subagents
 *     Windows: %APPDATA%\bg-subagents         →  %USERPROFILE%\.config\bg-subagents
 *   resolveStateDir()   — mutable state root (history, caches)
 *     POSIX:   $XDG_STATE_HOME/bg-subagents   →  ~/.local/state/bg-subagents
 *     Windows: %LOCALAPPDATA%\bg-subagents    →  %USERPROFILE%\.local\state\bg-subagents
 *   resolveHistoryPath(override?) — overrides win; else state/history.jsonl
 *   resolvePolicyPath()           — config/policy.jsonc
 *
 * Helpers:
 *   safePathSegment(s) — sanitises illegal Windows filename chars + separators
 *   expandTilde(p)     — "~/foo" → homedir/foo; bare "~" → homedir
 *   expandEnv(p)       — %VAR% (win) / $VAR / ${VAR} (POSIX) expansion
 *
 * Platform override: because `os.platform` is a non-configurable own property
 * (and can't be spied on with `vi.spyOn`), resolvers accept an optional
 * `PlatformOverride` produced by `__forPlatform__("win32" | ...)`. Production
 * callers never pass it — tests use it to exercise each branch deterministically.
 */
import * as os from "node:os";
import * as path from "node:path";

// -----------------------------------------------------------------------------
// Platform override seam
// -----------------------------------------------------------------------------

export interface PlatformOverride {
  readonly __bgPlatformOverride: NodeJS.Platform;
  readonly __bgHomeOverride?: string;
}

/**
 * Build a platform override token used by tests to force a branch without
 * mutating `os.platform` (a non-configurable own property). Optionally pass a
 * `home` to force `os.homedir()` as well — also non-configurable, so this is
 * the only safe way to exercise homedir-dependent fallbacks cross-platform.
 * Never call this from production code.
 */
export function __forPlatform__(
  platform: NodeJS.Platform,
  home?: string,
): PlatformOverride {
  if (home !== undefined) {
    return { __bgPlatformOverride: platform, __bgHomeOverride: home };
  }
  return { __bgPlatformOverride: platform };
}

function platformOf(override?: PlatformOverride): NodeJS.Platform {
  return override?.__bgPlatformOverride ?? os.platform();
}

function homeOf(override?: PlatformOverride): string {
  return override?.__bgHomeOverride ?? os.homedir();
}

// -----------------------------------------------------------------------------
// Directory resolvers
// -----------------------------------------------------------------------------

/**
 * Config directory root — policy.jsonc + caches live here.
 */
export function resolveConfigDir(platform?: PlatformOverride): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg !== undefined && xdg.length > 0) {
    return path.join(xdg, "bg-subagents");
  }
  if (platformOf(platform) === "win32") {
    const appData = process.env["APPDATA"];
    if (appData !== undefined && appData.length > 0) {
      return path.join(appData, "bg-subagents");
    }
    return path.join(homeOf(platform), ".config", "bg-subagents");
  }
  return path.join(homeOf(platform), ".config", "bg-subagents");
}

/**
 * State directory root — history.jsonl + rotated archives.
 */
export function resolveStateDir(platform?: PlatformOverride): string {
  const xdg = process.env["XDG_STATE_HOME"];
  if (xdg !== undefined && xdg.length > 0) {
    return path.join(xdg, "bg-subagents");
  }
  if (platformOf(platform) === "win32") {
    const local = process.env["LOCALAPPDATA"];
    if (local !== undefined && local.length > 0) {
      return path.join(local, "bg-subagents");
    }
    return path.join(homeOf(platform), ".local", "state", "bg-subagents");
  }
  return path.join(homeOf(platform), ".local", "state", "bg-subagents");
}

/**
 * Active history file path. Prefers a caller-provided policy override; falls
 * back to the default state directory. Tilde expansion is applied to overrides.
 */
export function resolveHistoryPath(
  override?: string,
  platform?: PlatformOverride,
): string {
  if (override !== undefined && override.length > 0) {
    return expandTilde(override);
  }
  return path.join(resolveStateDir(platform), "history.jsonl");
}

/**
 * Policy file path — `policy.jsonc` under the config directory.
 */
export function resolvePolicyPath(platform?: PlatformOverride): string {
  return path.join(resolveConfigDir(platform), "policy.jsonc");
}

// -----------------------------------------------------------------------------
// Segment sanitisers + expanders
// -----------------------------------------------------------------------------

const ILLEGAL_SEGMENT_CHARS = /[\\\/:*?"<>|]/g;

/**
 * Replace characters that are illegal in a Windows filename (or that collide
 * with path separators) with `-`. Intended for timestamp/task-id embedding.
 */
export function safePathSegment(input: string): string {
  return input.replace(ILLEGAL_SEGMENT_CHARS, "-");
}

/**
 * Expand a leading `~/` to `os.homedir()`. Bare `~` → homedir. Every other
 * form is returned untouched (`~user/foo` is a shell-only feature we don't
 * emulate).
 */
export function expandTilde(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    const rest = input.slice(2);
    return path.join(os.homedir(), rest);
  }
  return input;
}

const WIN_VAR_RE = /%([A-Za-z_][A-Za-z0-9_]*)%/g;
const POSIX_VAR_BRACED_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const POSIX_VAR_BARE_RE = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Expand environment-variable references. Windows uses `%VAR%`; POSIX uses
 * `$VAR` and `${VAR}`. When the variable is not set we leave the token in
 * place so callers can surface the failure (rather than producing an empty
 * path by accident).
 */
export function expandEnv(input: string, platform?: PlatformOverride): string {
  if (platformOf(platform) === "win32") {
    return input.replace(WIN_VAR_RE, (match, name: string) => {
      const value = process.env[name];
      return value !== undefined ? value : match;
    });
  }
  return input
    .replace(POSIX_VAR_BRACED_RE, (match, name: string) => {
      const value = process.env[name];
      return value !== undefined ? value : match;
    })
    .replace(POSIX_VAR_BARE_RE, (match, name: string) => {
      const value = process.env[name];
      return value !== undefined ? value : match;
    });
}
