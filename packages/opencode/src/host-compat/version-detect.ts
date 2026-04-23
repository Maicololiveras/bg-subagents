/**
 * Host version detection for the bg-subagents plugin.
 *
 * Classifies the plugin ctx as one of:
 *   - "v14"    — OpenCode 1.14+ shape (PluginInput: client, project, directory, $, serverUrl)
 *   - "legacy" — pre-1.14 shape (session_id + bus + session)
 *   - "unknown" — neither shape matches
 *
 * Environment override: `BG_SUBAGENTS_FORCE_COMPAT` (values: `v14` | `legacy`).
 * Invalid values emit a warn log and fall through to auto-detection.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/host-compat/spec.md
 */

export type HostVersion = "v14" | "legacy" | "unknown";

export interface VersionDetectLogger {
  info?(entry: Record<string, unknown>): void;
  warn?(entry: Record<string, unknown>): void;
}

export interface DetectHostVersionOpts {
  logger?: VersionDetectLogger;
}

const ENV_KEY = "BG_SUBAGENTS_FORCE_COMPAT";
const VALID_FORCE_VALUES: ReadonlySet<HostVersion> = new Set(["v14", "legacy"]);

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasV14Shape(ctx: Record<string, unknown>): boolean {
  // v14 PluginInput always exposes `client`. It does NOT carry `bus` or
  // `session_id` at the top level.
  return (
    isNonNullObject(ctx["client"]) &&
    !("bus" in ctx) &&
    !("session_id" in ctx)
  );
}

function hasLegacyShape(ctx: Record<string, unknown>): boolean {
  // Legacy PluginServerContext (pre-1.14) carries session_id + bus + session.
  const hasSessionId = typeof ctx["session_id"] === "string";
  const bus = ctx["bus"];
  const hasBusEmit =
    isNonNullObject(bus) && typeof (bus as { emit?: unknown }).emit === "function";
  const hasSession = isNonNullObject(ctx["session"]);
  return hasSessionId && hasBusEmit && hasSession;
}

function readForceEnv(
  logger: VersionDetectLogger | undefined,
): HostVersion | null {
  const raw = process.env[ENV_KEY];
  if (raw === undefined || raw === "") return null;
  if (VALID_FORCE_VALUES.has(raw as HostVersion)) {
    return raw as HostVersion;
  }
  logger?.warn?.({
    msg: "host-compat:bad-force-value",
    value: raw,
    allowed: Array.from(VALID_FORCE_VALUES),
  });
  return null;
}

export function detectHostVersion(
  ctx: unknown,
  opts: DetectHostVersionOpts = {},
): HostVersion {
  const { logger } = opts;

  const forced = readForceEnv(logger);
  if (forced !== null) {
    logger?.info?.({ msg: "host-compat:forced", value: forced });
    return forced;
  }

  if (!isNonNullObject(ctx)) return "unknown";

  if (hasV14Shape(ctx)) return "v14";
  if (hasLegacyShape(ctx)) return "legacy";
  return "unknown";
}
