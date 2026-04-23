// @ts-check
/**
 * Spike TQ-1 (server half) — shared singleton between server + tui
 *
 * Registers as a PluginModule.server. On boot, logs PID + INIT_TOKEN.
 * On every chat.params hook fire, bumps the shared counter.
 *
 * Pairs with ./tui.mjs which reads the same shared state.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { state, bumpCounter, INIT_TOKEN, INIT_TIME } from "./shared-state.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, "..", "..", "docs", "spikes", "tq-1-output.log");
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
  `MODULE-LOAD pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} INIT_TIME=${INIT_TIME} importMetaUrl=${import.meta.url}`,
);

/** @type {import("@opencode-ai/plugin").PluginModule} */
const serverPlugin = {
  id: "spike-tq-1-server",
  async server(input) {
    log(
      `server() called pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} state.counter=${state.counter}`,
    );

    return {
      "chat.params": async (hookInput, _hookOutput) => {
        const c = bumpCounter(`server:chat.params:${hookInput?.sessionID ?? "?"}`);
        log(
          `chat.params fired counter now=${c} pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} writes=${state.writes.length}`,
        );
      },
    };
  },
};

export default serverPlugin;
