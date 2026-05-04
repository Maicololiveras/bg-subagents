// @ts-check
/**
 * Spike SQ-1 — client.session.abort cancels in-flight tool
 *
 * Goal: verify that calling `client.session.abort({sessionID})` while a tool
 * is executing causes `ctx.abort` (AbortSignal) to fire in the tool.
 *
 * --- How to run ---
 * 1. cp C:/SDK/bg-subagents/scripts/spike-session-abort.mjs \
 *       /c/Users/maicolj/.config/opencode/plugins/
 * 2. Start opencode, open a session.
 * 3. Ask the agent: "invoke the spike_slow tool".
 * 4. Expected GO: tool returns in ~3-4s (self-aborts at tick 3 via
 *    client.session.abort). Expected NO-GO: runs the full 60 ticks
 *    ignoring the abort, OR session locks up.
 * 5. Try a follow-up "say hi" to confirm session recovers.
 * 6. cat C:/SDK/bg-subagents/docs/spikes/sq-1-output.log
 * 7. rm /c/Users/maicolj/.config/opencode/plugins/spike-session-abort.mjs
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LOG_PATH = "C:/SDK/bg-subagents/docs/spikes/sq-1-output.log";
const MARKER = "[SPIKE-SQ1]";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

log(`MODULE-LOAD pid=${process.pid} import.meta.url=${import.meta.url}`);

/** @type {import("@opencode-ai/plugin").Plugin} */
export const SpikeSq1SessionAbort = async (input) => {
  const { client, serverUrl } = input;
  log(
    `BOOT plugin called pid=${process.pid} serverUrl=${serverUrl} client.session=${typeof client?.session}`,
  );

  let invocationCount = 0;

  return {
    tool: {
      spike_slow: {
        description:
          "Spike SQ-1. Runs a 60s cooperative loop, self-aborts its session at tick 3 to verify ctx.abort propagates. Pass {external:true} to skip self-abort.",
        args: {},
        async execute(args, ctx) {
          invocationCount += 1;
          const invId = `inv#${invocationCount}`;
          const external = Boolean(args?.external);
          const sessionID = ctx?.sessionID;
          log(
            `${invId} START sessionID=${sessionID} external=${external} abort.aborted=${ctx?.abort?.aborted}`,
          );

          const t0 = Date.now();
          let tick = 0;
          const maxTicks = 60;
          let selfAbortFired = false;

          while (tick < maxTicks && !ctx?.abort?.aborted) {
            tick += 1;
            const elapsed = Date.now() - t0;
            log(
              `${invId} TICK ${tick} elapsed=${elapsed}ms aborted=${ctx?.abort?.aborted}`,
            );

            if (!external && !selfAbortFired && tick === 3) {
              log(`${invId} SELF-ABORT firing client.session.abort...`);
              selfAbortFired = true;
              try {
                // v1 SDK shape — plugin runtime exposes v1 client
                // (verified in DQ-1 run: URL placeholder is {id} not {sessionID}).
                const res = await client.session.abort({
                  path: { id: sessionID },
                });
                log(
                  `${invId} SELF-ABORT resolved res=${JSON.stringify(res).slice(0, 300)}`,
                );
              } catch (err) {
                log(`${invId} SELF-ABORT THREW ${err?.name}: ${err?.message}`);
              }
            }

            await sleep(1000);
          }

          const totalElapsed = Date.now() - t0;
          const exitReason = ctx?.abort?.aborted
            ? "ctx.abort.aborted=true"
            : `max ticks reached (${maxTicks})`;
          log(
            `${invId} EXIT reason=${exitReason} totalElapsed=${totalElapsed}ms ticks=${tick}`,
          );

          return {
            output: `spike_slow done — ${exitReason} after ${totalElapsed}ms (${tick} ticks). See docs/spikes/sq-1-output.log.`,
          };
        },
      },

      spike_abort_now: {
        description:
          "Helper for SQ-1. Calls client.session.abort on the current session. Use for external-abort flow tests.",
        args: {},
        async execute(_args, ctx) {
          const sessionID = ctx?.sessionID;
          log(`HELPER spike_abort_now called sessionID=${sessionID}`);
          try {
            // v1 SDK shape: { path: { id } }
            const res = await client.session.abort({
              path: { id: sessionID },
            });
            log(
              `HELPER abort resolved res=${JSON.stringify(res).slice(0, 300)}`,
            );
            return { output: `abort fired on ${sessionID}` };
          } catch (err) {
            log(`HELPER abort THREW ${err?.name}: ${err?.message}`);
            return { output: `abort threw: ${err?.message}` };
          }
        },
      },
    },
  };
};

export default SpikeSq1SessionAbort;
