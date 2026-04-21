/**
 * Task ID generation + validation.
 *
 * Design ambiguity #3 resolved: the spec regex allows `^tsk_[A-Za-z0-9]{8,}$`
 * (≥8 chars of entropy); we pick 12 base62 chars for additional headroom
 * against collisions (~5e21 possibilities) without bloating log lines.
 *
 * Implementation detail: we sample 9 random bytes (72 bits) via
 * `node:crypto.randomBytes` then encode as URL-safe base64 and strip the
 * non-alphanumeric `-` / `_` / `=` characters. 9 bytes yield 12 base64 chars
 * naturally; collisions on the stripped alphabet are negligible at this scale
 * because we only substitute TWO symbols and re-sample on the rare occasions
 * they appear in the first 12 characters.
 */
import { randomBytes } from "node:crypto";
import { unsafeTaskId as protocolUnsafeTaskId, type TaskId } from "@maicolextic/bg-subagents-protocol";

/** Canonical regex. Matches the 12-char variant we emit. */
export const TASK_ID_PATTERN = /^tsk_[A-Za-z0-9]{12}$/;

const ID_CHARS_LENGTH = 12;
const BASE62_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Re-export of the protocol brand converter. DO NOT redefine this helper
 * locally — the protocol owns the single entry point for unsafe casts so the
 * brand remains nominal across the workspace.
 */
export const unsafeTaskId = protocolUnsafeTaskId;

/**
 * Validate that `value` is a well-formed TaskId string.
 *
 * NOTE: purely structural check. Use `TaskIdSchema.parse` from the protocol if
 * you need a branded TaskId back.
 */
export function isValidTaskId(value: unknown): value is TaskId {
  return typeof value === "string" && TASK_ID_PATTERN.test(value);
}

/**
 * Generate a fresh TaskId. Loop-safe: if base64url sampling returns non-base62
 * characters (`-` or `_`) inside the first 12 slots we resample those slots
 * from the base62 alphabet using additional random bytes.
 */
export function generateTaskId(): TaskId {
  // 9 random bytes → 12 base64 chars (no padding).
  const bytes = randomBytes(9);
  let raw = bytes.toString("base64url").slice(0, ID_CHARS_LENGTH);
  if (raw.length < ID_CHARS_LENGTH || /[^A-Za-z0-9]/.test(raw)) {
    // Replace offending slots with fresh base62 chars.
    const extra = randomBytes(ID_CHARS_LENGTH);
    const chars: string[] = [];
    for (let i = 0; i < ID_CHARS_LENGTH; i += 1) {
      const src = raw[i];
      if (src !== undefined && /[A-Za-z0-9]/.test(src)) {
        chars.push(src);
      } else {
        const byte = extra[i] ?? 0;
        const idx = byte % BASE62_ALPHABET.length;
        chars.push(BASE62_ALPHABET[idx] ?? "A");
      }
    }
    raw = chars.join("");
  }
  return unsafeTaskId(`tsk_${raw}`);
}
