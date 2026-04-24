/**
 * Phase 11 Spike TQ-1 (runtime verification) — TUI plugin minimal.
 *
 * Goal: confirm that a TUI plugin loads when declared in `opencode.json`'s
 * `plugin` array (the prior spike attempt dropped a TUI file into the
 * auto-discover dir `~/.config/opencode/plugins/` and crashed at boot with
 * `TypeError: undefined is not an object (evaluating 'f.auth')`).
 *
 * Logs PID + INIT_TOKEN at module load AND at boot. Checks a Symbol.for
 * shared-state key (so we can later probe server↔tui sharing). Uses
 * `api.ui.toast` as a visible signal that the TUI API wired through.
 *
 * MUST export a default object `{ tui: TuiPlugin }` per the SDK type
 * `TuiPluginModule`. This is DIFFERENT from server plugins, which expect
 * a function default export.
 */

import type {
  TuiPluginApi,
  TuiPluginMeta,
} from "@opencode-ai/plugin/tui";

const INIT_TOKEN = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const SHARED_KEY = Symbol.for("@maicolextic/bg-subagents-spike-tq1");

type SharedState = {
  source: "server" | "tui";
  pid: number;
  token: string;
  setAt: number;
};

console.log(
  `[SPIKE-TQ1-TUI] MODULE-LOAD pid=${process.pid} token=${INIT_TOKEN}`,
);

const preBoot = (globalThis as Record<symbol, unknown>)[SHARED_KEY] as
  | SharedState
  | undefined;
console.log(
  `[SPIKE-TQ1-TUI] shared-state pre-boot: ${
    preBoot ? JSON.stringify(preBoot) : "none"
  }`,
);

(globalThis as Record<symbol, unknown>)[SHARED_KEY] = {
  source: "tui",
  pid: process.pid,
  token: INIT_TOKEN,
  setAt: Date.now(),
} satisfies SharedState;

const Tui = async (
  api: TuiPluginApi,
  _options: unknown,
  meta: TuiPluginMeta,
) => {
  console.log(
    `[SPIKE-TQ1-TUI] BOOT pid=${process.pid} token=${INIT_TOKEN} meta.id=${meta.id} meta.state=${meta.state} meta.source=${meta.source} meta.spec=${meta.spec}`,
  );

  const onBoot = (globalThis as Record<symbol, unknown>)[SHARED_KEY] as
    | SharedState
    | undefined;
  console.log(
    `[SPIKE-TQ1-TUI] shared-state on-boot: ${
      onBoot ? JSON.stringify(onBoot) : "none"
    }`,
  );

  api.ui.toast({
    variant: "info",
    title: "bg-subagents TUI spike",
    message: `Loaded. pid=${process.pid} token=${INIT_TOKEN.slice(0, 8)}`,
    duration: 4000,
  });

  api.lifecycle.onDispose(() => {
    console.log(`[SPIKE-TQ1-TUI] DISPOSE token=${INIT_TOKEN}`);
  });
};

export default { tui: Tui };
