---
"@maicolextic/bg-subagents-core": patch
---

Add `TaskRegistry.markDelivered(id)` for delivery dedupe. Returns `true` on
first call for a given id and `false` on subsequent calls — enables primary
and fallback delivery channels to race safely without double-posting task
completion messages to the main chat. Internal use by the opencode adapter's
v14 delivery coordinator.
