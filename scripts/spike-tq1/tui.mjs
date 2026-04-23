// @ts-check
/**
 * Spike TQ-1 (tui half) — shared singleton between server + tui
 *
 * Registers as a TuiPlugin function. Polls the shared counter every 2s.
 * If OpenCode loads server.mjs and tui.mjs in the same Node process AND
 * resolves ./shared-state.mjs to the same URL, the counter grows as the
 * server hook fires.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { state, INIT_TOKEN, INIT_TIME } from "./spike-tq1-shared-state.mjs";

const LOG_PATH = "C:/SDK/bg-subagents/docs/spikes/tq-1-output.log";
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
  `MODULE-LOAD pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} INIT_TIME=${INIT_TIME} import.meta.url=${import.meta.url}`,
);

/** @type {import("@opencode-ai/plugin/tui").TuiPlugin} */
export const SpikeTq1Tui = async (api, _options, meta) => {
  log(
    `BOOT tui called pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} meta.id=${meta?.id} initialCounter=${state.counter}`,
  );

  const interval = setInterval(() => {
    log(
      `POLL pid=${process.pid} INIT_TOKEN=${INIT_TOKEN} counter=${state.counter} writes=${state.writes.length} lastFrom=${state.writes[state.writes.length - 1]?.from ?? "<none>"}`,
    );
  }, 2000);

  api?.lifecycle?.onDispose?.(() => {
    clearInterval(interval);
    log(`DISPOSE counter=${state.counter}`);
  });
};

export default SpikeTq1Tui;
