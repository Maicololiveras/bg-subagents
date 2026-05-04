// @ts-check
/**
 * Spike EQ-1 — experimental.chat.messages.transform
 *
 * Goal: verify at runtime on OpenCode 1.14.22 that the
 * `experimental.chat.messages.transform` plugin hook:
 *   (a) fires pre-LLM-execution (i.e. before the assistant replies)
 *   (b) receives a mutable `output.messages: {info, parts}[]`
 *   (c) persists part additions into the actual turn (visible in UI)
 *
 * Signature matches OpenCode's runtime: a Plugin is an async function that
 * returns a Hooks object. The default export MUST be a function — objects
 * are rejected with "Plugin export is not a function".
 *
 * --- How to run ---
 * 1. Copy this file to OpenCode's auto-discovered plugin dir:
 *      cp C:/SDK/bg-subagents/scripts/spike-messages-transform.mjs \
 *         /c/Users/maicolj/.config/opencode/plugins/
 * 2. Start `opencode`, open a session, send 3 different short prompts
 *    (e.g. "hola", "decime la hora", "qué día es").
 * 3. Watch the UI: does `[SPIKE-EQ1]` appear appended to your OWN user turn?
 * 4. Read the log:
 *      cat C:/SDK/bg-subagents/docs/spikes/eq-1-output.log
 * 5. Remove the spike when done:
 *      rm /c/Users/maicolj/.config/opencode/plugins/spike-messages-transform.mjs
 *
 * GO  => hook fires per turn, mutation appears in UI.
 * NO-GO => hook never fires (only CANARY logs) OR mutation invisible in UI.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Log path is hardcoded ABSOLUTE so it works regardless of where OpenCode
// resolves the spike from (auto-discovery dir vs repo vs symlink).
const LOG_PATH = "C:/SDK/bg-subagents/docs/spikes/eq-1-output.log";
const MARKER = "[SPIKE-EQ1]";

function ensureLogDir() {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
  } catch {}
}

function log(entry) {
  ensureLogDir();
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  try {
    appendFileSync(LOG_PATH, line, "utf8");
  } catch (err) {
    console.error(`${MARKER} log write failed:`, err);
  }
  console.error(`${MARKER} ${entry}`);
}

function safeShape(value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value !== "object") return typeof value;
  const keys = Object.keys(value);
  return `{${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",…" : ""}}`;
}

log(`MODULE-LOAD pid=${process.pid} import.meta.url=${import.meta.url}`);

/** @type {import("@opencode-ai/plugin").Plugin} */
export const SpikeEq1MessagesTransform = async (input) => {
  log(
    `BOOT plugin called pid=${process.pid} inputKeys=[${Object.keys(input).join(",")}] directory=${input.directory} serverUrl=${input.serverUrl}`,
  );

  let fireCount = 0;

  return {
    "experimental.chat.messages.transform": async (hookInput, hookOutput) => {
      fireCount += 1;
      const fireId = `fire#${fireCount}`;

      log(`${fireId} FIRED inputKeys=${safeShape(hookInput)}`);

      const msgs = hookOutput?.messages ?? [];
      log(`${fireId} output.messages.length=${msgs.length}`);

      msgs.forEach((m, i) => {
        const role = m?.info?.role ?? "<no-role>";
        const partsLen = Array.isArray(m?.parts) ? m.parts.length : -1;
        const partTypes = Array.isArray(m?.parts)
          ? m.parts.map((p) => p?.type ?? "?").join(",")
          : "<not-array>";
        log(
          `${fireId}   msg[${i}] role=${role} parts.length=${partsLen} types=[${partTypes}]`,
        );
      });

      // Mutation: append a synthetic text part to the LAST user message.
      const lastUserIdx = [...msgs]
        .map((m, i) => ({ m, i }))
        .reverse()
        .find(({ m }) => m?.info?.role === "user")?.i;

      if (lastUserIdx !== undefined && Array.isArray(msgs[lastUserIdx]?.parts)) {
        const before = msgs[lastUserIdx].parts.length;
        msgs[lastUserIdx].parts.push({
          type: "text",
          text: `${MARKER} mutation from plugin ${fireId}`,
        });
        const after = msgs[lastUserIdx].parts.length;
        log(
          `${fireId} MUTATION appended text part to msg[${lastUserIdx}] parts.length before=${before} after=${after}`,
        );
      } else {
        log(`${fireId} MUTATION skipped — no user message found`);
      }

      log(`${fireId} DONE`);
    },

    // Canary: if BOOT logs but this never fires, the plugin loaded but the
    // hook system isn't wiring us. If this fires but messages.transform
    // doesn't, the experimental hook isn't active in this runtime.
    "chat.params": async () => {
      log(`CANARY chat.params fired — plugin IS loaded, hooks DO fire`);
    },
  };
};

export default SpikeEq1MessagesTransform;
