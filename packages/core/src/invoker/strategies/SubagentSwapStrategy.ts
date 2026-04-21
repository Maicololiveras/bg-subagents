/**
 * SubagentSwapStrategy — placeholder strategy for Claude-Code-style agent
 * pairs where the host installs `<name>-bg` alongside `<name>` (or `<name>-fg`).
 * When the host advertises a `-bg` variant via
 * `host_context.agent_variants[agent_name] === true`, we rewrite the outgoing
 * `agent_name` to `<name>-bg`.
 *
 * The rewrite is idempotent: if the incoming `agent_name` already ends in
 * `-bg`, we return the same name rather than stacking suffixes.
 */
import type {
  BackgroundStrategy,
  InvocationRewrite,
  InvocationSpec,
  Mode,
  StrategyCapabilities,
} from "../BackgroundInvoker.js";

const BG_SUFFIX = "-bg";

/** Typed accessor for `host_context.agent_variants`. */
function readVariantsMap(
  ctx: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, boolean>> | undefined {
  if (ctx === undefined) {
    return undefined;
  }
  const raw = ctx["agent_variants"];
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  return raw as Readonly<Record<string, boolean>>;
}

export class SubagentSwapStrategy implements BackgroundStrategy {
  public readonly name = "subagent-swap";

  public async capabilities(
    _host_context?: Readonly<Record<string, unknown>>,
  ): Promise<StrategyCapabilities> {
    void _host_context;
    // Static capability — the host-specific probe is whether a variant is
    // registered for a GIVEN agent (handled in canInvokeInBackground). The
    // chain advertises "I support swap" regardless, so adapters can steer the
    // user toward generating a pair if nothing is registered yet.
    return {
      supports_native_bg: false,
      supports_subagent_swap: true,
      supports_prompt_injection: false,
      name: this.name,
    };
  }

  public async canInvokeInBackground(spec: InvocationSpec): Promise<boolean> {
    const variants = readVariantsMap(spec.host_context);
    if (variants === undefined) {
      return false;
    }
    return variants[spec.agent_name] === true;
  }

  public async invokeRewrite(spec: InvocationSpec, mode: Mode): Promise<InvocationRewrite> {
    if (mode !== "background") {
      return {};
    }
    const already = spec.agent_name.endsWith(BG_SUFFIX);
    const swapped = already ? spec.agent_name : `${spec.agent_name}${BG_SUFFIX}`;
    return {
      agent_name: swapped,
      note: already
        ? `agent_name ${spec.agent_name} already ends in -bg (noop swap)`
        : `swapped ${spec.agent_name} -> ${swapped}`,
    };
  }
}
