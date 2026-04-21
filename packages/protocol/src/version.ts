/**
 * Protocol version for the bg-subagents plugin ecosystem.
 *
 * Semver discipline (NFR-8):
 *   - MAJOR bump = breaking contract change; adapters ERROR and refuse to load.
 *   - MINOR bump = additive fields or activation of reserved semantics; adapters WARN.
 *   - PATCH bump = bugfix-only; transparent.
 */
export const PROTOCOL_VERSION = "1.0.0" as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;

export type ProtocolCompatibilityResult =
  | { readonly ok: true; readonly mismatch?: undefined }
  | { readonly ok: true; readonly mismatch: "minor" }
  | { readonly ok: false; readonly mismatch: "major" };

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseSemver(input: string): ParsedSemver | undefined {
  const match = SEMVER_RE.exec(input);
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return undefined;
  }
  return { major, minor, patch };
}

/**
 * Compare an installed protocol version against the adapter's pinned PROTOCOL_VERSION.
 *
 * - Unparseable input → treated as incompatible MAJOR (fail-closed).
 * - Different MAJOR → not compatible.
 * - Same MAJOR, different MINOR → compatible with WARN (mismatch = "minor").
 * - Same MAJOR + MINOR → fully compatible.
 */
export function isCompatibleProtocol(installed: string): ProtocolCompatibilityResult {
  const parsed = parseSemver(installed);
  const expected = parseSemver(PROTOCOL_VERSION);
  if (!parsed || !expected) {
    return { ok: false, mismatch: "major" };
  }
  if (parsed.major !== expected.major) {
    return { ok: false, mismatch: "major" };
  }
  if (parsed.minor !== expected.minor) {
    return { ok: true, mismatch: "minor" };
  }
  return { ok: true };
}
