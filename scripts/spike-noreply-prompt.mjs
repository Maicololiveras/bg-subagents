// @ts-check
/**
 * Spike DQ-1 — client.session.prompt({ noReply: true })
 *
 * Goal: verify at runtime what `noReply: true` actually does when plugin
 * calls client.session.prompt on the current session.
 *
 * --- How to run ---
 * 1. cp C:/SDK/bg-subagents/scripts/spike-noreply-prompt.mjs \
 *       /c/Users/maicolj/.config/opencode/plugins/
 * 2. Start opencode, send ANY prompt first (creates sessionID).
 * 3. After the reply, ask the agent: "invoke the spike_dq1 tool".
 *    Repeat 2-3 times.
 * 4. Observe UI: does a new user turn appear with "[SPIKE-DQ1] synthetic
 *    delivery inv#N"? Does the assistant start a new reply? (should NOT)
 * 5. cat C:/SDK/bg-subagents/docs/spikes/dq-1-output.log
 * 6. rm /c/Users/maicolj/.config/opencode/plugins/spike-noreply-prompt.mjs
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LOG_PATH = "C:/SDK/bg-subagents/docs/spikes/dq-1-output.log";
const MARKER = "[SPIKE-DQ1]";

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

// Try to resolve Zod from the plugin SDK for tool args. Falls back to empty
// object if unresolvable — some runtimes may reject that at registration.
let zodResolved = false;
try {
  const { tool } = await import("@opencode-ai/plugin/tool");
  zodResolved = typeof tool?.schema === "function" || typeof tool?.schema === "object";
  log(`MODULE-LOAD @opencode-ai/plugin/tool imported zodResolved=${zodResolved}`);
} catch (err) {
  log(`MODULE-LOAD could NOT import @opencode-ai/plugin/tool — ${err?.message ?? err}`);
}

log(`MODULE-LOAD pid=${process.pid} import.meta.url=${import.meta.url}`);

/** @type {import("@opencode-ai/plugin").Plugin} */
export const SpikeDq1NoReplyPrompt = async (input) => {
  const { client } = input;
  log(
    `BOOT plugin called pid=${process.pid} client.session=${typeof client?.session}`,
  );

  let invocationCount = 0;

  return {
    tool: {
      spike_dq1: {
        description:
          "Spike DQ-1 probe. Calls client.session.prompt({noReply:true}) with a synthetic text part on the current session. No arguments.",
        args: {},
        async execute(_args, ctx) {
          invocationCount += 1;
          const invId = `inv#${invocationCount}`;
          log(`${invId} tool invoked ctx.sessionID=${ctx?.sessionID}`);

          const payload = {
            sessionID: ctx.sessionID,
            noReply: true,
            parts: [
              {
                type: "text",
                text: `${MARKER} synthetic delivery ${invId}`,
              },
            ],
          };
          log(`${invId} payload=${JSON.stringify(payload)}`);

          const t0 = Date.now();
          try {
            const result = await client.session.prompt(payload);
            const dt = Date.now() - t0;
            log(
              `${invId} prompt resolved dt=${dt}ms result.type=${typeof result} keys=[${result ? Object.keys(result).join(",") : "<no-keys>"}]`,
            );
            log(
              `${invId} result body (first 400 chars)=${JSON.stringify(result).slice(0, 400)}`,
            );
            return {
              output: `noReply probe completed in ${dt}ms — see docs/spikes/dq-1-output.log`,
            };
          } catch (err) {
            const dt = Date.now() - t0;
            log(
              `${invId} prompt THREW dt=${dt}ms name=${err?.name} message=${err?.message}`,
            );
            log(`${invId} err stack=${String(err?.stack).slice(0, 600)}`);
            return {
              output: `noReply probe FAILED after ${dt}ms: ${err?.message} — see log`,
            };
          }
        },
      },
    },
  };
};

export default SpikeDq1NoReplyPrompt;
