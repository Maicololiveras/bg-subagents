// @ts-check
/**
 * Spike TQ-1 (server half) — shared singleton between server + tui
 *
 * Registers as a Plugin function. On every chat.params hook fire, bumps the
 * shared counter imported from ./shared-state.mjs. Pairs with ./tui.mjs.
 *
 * --- How to run (server + tui together) ---
 * 1. Copy BOTH files into OpenCode's plugin dir:
 *      cp -r C:/SDK/bg-subagents/scripts/spike-tq1 \
 *            /c/Users/maicolj/.config/opencode/plugins/
 *    (That produces .../plugins/spike-tq1/{server,tui,shared-state}.mjs.)
 * 2. Start opencode, open a session, send 3-4 short prompts.
 * 3. cat C:/SDK/bg-subagents/docs/spikes/tq-1-output.log
 * 4. rm -rf /c/Users/maicolj/.config/opencode/plugins/spike-tq1
 *
 * Outcomes:
 *   same PID + same INIT_TOKEN  => shared module instance => GO
 *   same PID + diff INIT_TOKEN  => separate graph per entry => NO-GO (needs globalThis)
 *   diff PIDs                   => separate processes => NO-GO (needs IPC)
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { state, bumpCounter, INIT_TOKEN, INIT_TIME } from "./spike-tq1-shared-state.mjs";

const LOG_PATH = "C:/SDK/bg-subagents/docs/spikes/tq-1-output.log";
const MARKER = "[SPIKE-TQ1:server]";

function ensureLogDir() {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
  } catch {}
}

function log(entry) {
  ensureLogDir();
  const line = `[${new Date().toISOString()}] ${MARKER} ${entry}\n`;
  try {
    appendFileSync(LOG_PATH, line, "utf8");
  } catch (err) {
    console.error(`${MARKER} log write failed:`, err);
  }
  console.error(`${MARKER} ${entry}`);
}

log(
  `MODULE-LOAD pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} INIT_TIME=${INIT_TIME} import.meta.url=${import.meta.url}`,
);

/** @type {import("@opencode-ai/plugin").Plugin} */
export const SpikeTq1Server = async (input) => {
  log(
    `BOOT plugin called pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} state.counter=${state.counter}`,
  );

  return {
    "chat.params": async (hookInput, _hookOutput) => {
      const c = bumpCounter(`server:chat.params:${hookInput?.sessionID ?? "?"}`);
      log(
        `chat.params fired counter=${c} pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} writes=${state.writes.length}`,
      );
    },
  };
};

export default SpikeTq1Server;
