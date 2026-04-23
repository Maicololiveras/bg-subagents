// @ts-check
/**
 * Spike TQ-1 (tui half) — shared singleton between server + tui
 *
 * Registers as a TuiPluginModule.tui. On init, logs PID + INIT_TOKEN, then
 * reads the shared counter every 2 seconds until disposed.
 *
 * If OpenCode loads this in the same Node process as server.mjs AND both
 * resolve to the same ./shared-state.mjs URL, the counter read here should
 * grow over time as the server plugin's chat.params hook fires.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { state, INIT_TOKEN, INIT_TIME } from "./shared-state.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, "..", "..", "docs", "spikes", "tq-1-output.log");
const MARKER = "[SPIKE-TQ1:tui]";

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

/** @type {import("@opencode-ai/plugin/tui").TuiPluginModule} */
const tuiPlugin = {
  id: "spike-tq-1-tui",
  async tui(api, _options, meta) {
    log(
      `tui() entry pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} meta.id=${meta?.id} apiKeys=[${Object.keys(api ?? {}).slice(0, 12).join(",")}] initialCounter=${state.counter}`,
    );

    const interval = setInterval(() => {
      log(
        `POLL pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} counter=${state.counter} writes=${state.writes.length} lastWriteFrom=${state.writes[state.writes.length - 1]?.from ?? "<none>"}`,
      );
    }, 2000);

    api?.lifecycle?.onDispose?.(() => {
      clearInterval(interval);
      log(`DISPOSE counter=${state.counter}`);
    });
  },
};

export default tuiPlugin;
