/**
 * policy.jsonc loader.
 *
 * Responsibilities (FR-12 + Scenario 7 + Q3):
 *   1. Resolve default path (XDG / %APPDATA% / ~/.config/bg-subagents/policy.jsonc).
 *   2. Read + parse with jsonc-parser (comments + trailing commas supported).
 *   3. Honor the `$schema` URL's version:
 *        - Compatible v1 (1.x)  → proceed.
 *        - Minor bump (v1.N+)   → auto-migrate in-memory, write .bak sidecar,
 *                                 return with `migrated: true` + warning.
 *        - Major bump (vN≥2)    → FAIL CLOSED with upgrade URL.
 *   4. Validate against PolicySchema → on failure, throw PolicyValidationError
 *      (zod flatten, with file offset hint when available).
 *   5. Return LoadedPolicy { policy, source, migrated?, warnings }.
 */
import { promises as fs } from "node:fs";

import {
  type ParseError,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser";
import { ZodError, type ZodIssue } from "zod";

// jsonc-parser exports `ParseErrorCode` as an ambient `const enum`, which
// TypeScript's `verbatimModuleSyntax` refuses to import as a value. The enum
// values are stable (documented in jsonc-parser's README) so we pin the codes
// we care about as plain literals.
//   InvalidCommentToken = 10
// Source: jsonc-parser@3.3.1 lib/esm/main.d.ts
const PARSE_ERROR_CODE_INVALID_COMMENT_TOKEN = 10 as const;

import { PolicySchema, PolicyValidationError, type Policy } from "@maicolextic/bg-subagents-protocol";

import { resolvePolicyPath } from "../obs/paths.js";
import { HARDCODED_DEFAULT_POLICY } from "./hardcoded-defaults.js";
import type { LoadedPolicy } from "./schema.js";

export { HARDCODED_DEFAULT_POLICY } from "./hardcoded-defaults.js";
export type { LoadedPolicy } from "./schema.js";

const POLICY_V1_SCHEMA_URL = "https://bg-subagents.dev/schema/policy-v1.json";
const CURRENT_MAJOR = 1;
// Known minors we accept without migration. Anything higher within the same
// major triggers an auto-migration (schema is additive-only within a major).
const KNOWN_MINOR = 0;

/**
 * Default policy.jsonc path. Resolved per call to respect env changes under
 * test harnesses (e.g. vitest mutating $XDG_CONFIG_HOME). Since Batch 5b the
 * implementation delegates to `obs/paths.ts.resolvePolicyPath()` — the single
 * source of truth for XDG + Windows fallback semantics.
 */
export function resolveDefaultPolicyPath(): string {
  return resolvePolicyPath();
}

// -----------------------------------------------------------------------------
// Public entry
// -----------------------------------------------------------------------------

export async function loadPolicy(filePath?: string): Promise<LoadedPolicy> {
  const effectivePath = filePath ?? resolveDefaultPolicyPath();

  let raw: string;
  try {
    raw = await fs.readFile(effectivePath, "utf8");
  } catch (err) {
    // File missing (or unreadable) → fall back to hardcoded defaults. Never
    // fatal: spec §5.1 says "use hardcoded defaults, emit warning, activate".
    const reason = err instanceof Error ? err.message : String(err);
    return {
      policy: HARDCODED_DEFAULT_POLICY,
      source: "default",
      warnings: [`policy file not loaded (${reason}); using hardcoded defaults`],
    };
  }

  return parseAndValidate(raw, effectivePath);
}

// -----------------------------------------------------------------------------
// Pipeline: parse jsonc → migration gate → zod validate → wrap
// -----------------------------------------------------------------------------

function offsetToLineCol(
  source: string,
  offset: number,
): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < clamped; i++) {
    if (source.charCodeAt(i) === 0x0a /* \n */) {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

async function parseAndValidate(
  source: string,
  filePath: string,
): Promise<LoadedPolicy> {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    const fatals = errors.filter(isFatalJsoncError);
    if (fatals.length > 0) {
      const first = fatals[0] as ParseError;
      const { line, col } = offsetToLineCol(source, first.offset);
      throw new PolicyValidationError({
        path: filePath,
        expected: "valid JSONC",
        got: `parse error: ${printParseErrorCode(first.error)}`,
        approx_line: line,
        approx_col: col,
      });
    }
  }

  const warnings: string[] = [];
  let didMigrate = false;

  // --- Migration gate ($schema URL version check) ------------------------
  const schemaVersion = extractSchemaVersion(parsed);
  if (schemaVersion) {
    const { major, minor } = schemaVersion;
    if (major !== CURRENT_MAJOR) {
      // Major bump (up OR down) → fail closed. Error message MUST carry the
      // upgrade URL per Q3. PolicyValidationError's `got` field is the only
      // free-form carrier we have — embed the URL there so consumers see it.
      throw new PolicyValidationError({
        path: "$schema",
        expected: `policy schema v${CURRENT_MAJOR}.x (see ${POLICY_V1_SCHEMA_URL} for migration)`,
        got: `incompatible major v${major} — upgrade path: ${POLICY_V1_SCHEMA_URL}`,
      });
    }
    if (minor > KNOWN_MINOR) {
      didMigrate = true;
      warnings.push(
        `policy schema minor bump detected (v${major}.${minor}); auto-migrated in memory`,
      );
      await writeBackupSidecar(filePath, source, warnings);
    }
  }

  // --- Schema validation -------------------------------------------------
  let policy: Policy;
  try {
    policy = PolicySchema.parse(parsed) as Policy;
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const issuePath = first ? first.path.join(".") : "<root>";
      const expected = first?.message ?? "valid policy";
      const got = describeZodIssue(first);
      throw new PolicyValidationError({
        path: issuePath.length > 0 ? issuePath : "<root>",
        expected,
        got,
      });
    }
    throw err;
  }

  const loaded: LoadedPolicy = {
    policy,
    source: "file",
    ...(didMigrate ? { migrated: true as const } : {}),
    warnings,
  };
  return loaded;
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function isFatalJsoncError(err: ParseError): boolean {
  // With disallowComments: false + allowTrailingComma: true, the only
  // informational error is InvalidCommentToken — everything else is fatal.
  if (err.error === PARSE_ERROR_CODE_INVALID_COMMENT_TOKEN) {
    return false;
  }
  return true;
}

interface SchemaVersion {
  readonly major: number;
  readonly minor: number;
}

function extractSchemaVersion(parsed: unknown): SchemaVersion | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const maybe = (parsed as Record<string, unknown>)["$schema"];
  if (typeof maybe !== "string" || maybe.length === 0) return undefined;
  // Accept both policy-v1.json and policy-v1.5.json style URLs.
  const m = /policy-v(\d+)(?:\.(\d+))?\.json(?:$|[?#])/.exec(maybe);
  if (!m) return undefined;
  const majorStr = m[1];
  const minorStr = m[2];
  if (majorStr === undefined) return undefined;
  const major = Number.parseInt(majorStr, 10);
  const minor = minorStr !== undefined ? Number.parseInt(minorStr, 10) : 0;
  if (Number.isNaN(major) || Number.isNaN(minor)) return undefined;
  return { major, minor };
}

function describeZodIssue(issue: ZodIssue | undefined): string {
  if (!issue) return "unknown issue";
  if (issue.code === "invalid_type") {
    return `${issue.received} (expected ${issue.expected})`;
  }
  return issue.code;
}

async function writeBackupSidecar(
  filePath: string,
  source: string,
  warnings: string[],
): Promise<void> {
  // Policy is to never overwrite an existing user file — we write a sidecar
  // with the original content so the user can roll back. Backup timestamp
  // uses "-" instead of ":" because Windows forbids colons in filenames.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const bakPath = `${filePath}.bak.${ts}`;
  try {
    await fs.writeFile(bakPath, source, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warnings.push(`could not write policy backup sidecar: ${reason}`);
  }
}
