/**
 * Typed error subclasses for the adapter→host contract.
 *
 * All errors expose a stable `.code` string so host adapters can pattern-match
 * without relying on `instanceof` checks across package boundaries (which break
 * under dual ESM/CJS + symbol-keyed prototype chains).
 */

// -----------------------------------------------------------------------------
// IncompatibleProtocolError
// -----------------------------------------------------------------------------

export type IncompatibleProtocolCode =
  | "INCOMPATIBLE_PROTOCOL_MAJOR"
  | "INCOMPATIBLE_PROTOCOL_MINOR";

export interface IncompatibleProtocolContext {
  readonly required: string;
  readonly installed: string;
  readonly adapter: string;
  readonly severity?: "major" | "minor";
}

export class IncompatibleProtocolError extends Error {
  public readonly code: IncompatibleProtocolCode;
  public readonly required: string;
  public readonly installed: string;
  public readonly adapter: string;

  constructor(ctx: IncompatibleProtocolContext) {
    const severity = ctx.severity ?? "major";
    const code: IncompatibleProtocolCode =
      severity === "minor"
        ? "INCOMPATIBLE_PROTOCOL_MINOR"
        : "INCOMPATIBLE_PROTOCOL_MAJOR";
    const severityLabel = severity === "minor" ? "minor" : "major";
    super(
      `[${ctx.adapter}] protocol ${severityLabel} incompatibility: ` +
        `required ${ctx.required}, installed ${ctx.installed}`,
    );
    this.name = "IncompatibleProtocolError";
    this.code = code;
    this.required = ctx.required;
    this.installed = ctx.installed;
    this.adapter = ctx.adapter;
  }
}

// -----------------------------------------------------------------------------
// PolicyValidationError
// -----------------------------------------------------------------------------

export interface PolicyValidationContext {
  readonly path: string;
  readonly expected: string;
  readonly got: string;
  readonly approx_line?: number;
  readonly approx_col?: number;
}

export class PolicyValidationError extends Error {
  public readonly code = "POLICY_VALIDATION_FAILED" as const;
  public readonly path: string;
  public readonly expected: string;
  public readonly got: string;
  public readonly approx_line?: number;
  public readonly approx_col?: number;

  constructor(ctx: PolicyValidationContext) {
    const location =
      ctx.approx_line !== undefined
        ? ` (approx line ${ctx.approx_line}${
            ctx.approx_col !== undefined ? `, col ${ctx.approx_col}` : ""
          })`
        : "";
    super(
      `Policy validation failed at "${ctx.path}": expected ${ctx.expected}, got ${ctx.got}${location}`,
    );
    this.name = "PolicyValidationError";
    this.path = ctx.path;
    this.expected = ctx.expected;
    this.got = ctx.got;
    if (ctx.approx_line !== undefined) this.approx_line = ctx.approx_line;
    if (ctx.approx_col !== undefined) this.approx_col = ctx.approx_col;
  }
}

// -----------------------------------------------------------------------------
// BgLimitError (v0.2+ forward contract, shape locked in v0.1)
// -----------------------------------------------------------------------------

export interface BgLimitContext {
  readonly limit: number;
  readonly running: number;
  readonly retry_after_hint_ms?: number;
}

export class BgLimitError extends Error {
  public readonly code = "BG_LIMIT_REACHED" as const;
  public readonly limit: number;
  public readonly running: number;
  public readonly retry_after_hint_ms?: number;

  constructor(ctx: BgLimitContext) {
    super(
      `Background task limit reached: ${ctx.running}/${ctx.limit} concurrent tasks running.`,
    );
    this.name = "BgLimitError";
    this.limit = ctx.limit;
    this.running = ctx.running;
    if (ctx.retry_after_hint_ms !== undefined) {
      this.retry_after_hint_ms = ctx.retry_after_hint_ms;
    }
  }
}
