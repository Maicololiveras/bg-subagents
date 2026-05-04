# Reconciliar control BG/FG sin bloquear la interfaz

Tracker de la cadena de PRs para `fix(sdd): reconcile bg-control routing and planning drift`.

Tracks #19.

## Resumen ejecutivo

Esta cadena alinea OpenSpec, docs, Engram, policy y runtime para que el comportamiento sea verificable: `background` no bloquea la interfaz; `foreground` puede bloquear y eso es intencional. PR0 crea la rama intermedia y el mapa de revisión; los PR hijos aterrizan cambios pequeños contra `feat/sdd-bg-control-reconciliation`.

## Regla UX

| Modo | Regla | Implicancia |
|------|-------|-------------|
| `background` | No bloquea la interfaz | La tarea debe salir del flujo interactivo y reportar resultado después. |
| `foreground` | Puede bloquear | El bloqueo es esperado cuando la tarea debe mantener control del turno. |

## Cadena de PRs

PR0 es el tracker y la base intermedia. No revisar el aggregate diff de PR0 como si fuera código funcional; revisar cada child PR por separado.

```text
main
  ^
  |
PR0 tracker: feat/sdd-bg-control-reconciliation
  ^
  |-- PR1 plan reconciliation
  |-- PR2 runtime policy alignment
  |-- PR3 runtime command/control wiring
  |-- PR4 SDD regression tests
  `-- PR5 docs/diagrams polish
```

| PR | Estado | Base | Scope | Presupuesto |
|----|--------|------|-------|-------------|
| PR0 | En curso | `main` | Tracker y mapa de cadena. | Doc chico; aggregate diff puede exceder si hiciera falta. |
| PR1 | Aprobado | PR0 | Reconciliar OpenSpec `tasks/spec/design` as-built y decidir source-of-truth. | <400 líneas. |
| PR2 | Aprobado | PR0 | Alinear `messages.transform` con policy file real o deshabilitar seguro; garantizar `sdd-apply`/`sdd-verify` en FG. | <400 líneas. |
| PR3 | Aprobado | PR0 | Cablear `/task policy/list/show/kill/move-bg` al runtime real o retirar docs si no existe runtime. | <400 líneas. |
| PR4 | Aprobado | PR0 | Tests SDD: BG no bloquea, FG bloquea, auto-flip sin loop. | <400 líneas. |
| PR5 | En revisión | PR4 | Pulir README, arquitectura, skill docs y diagramas precisos. | <400 líneas. |
| PR6 | En revisión | PR5 | Mostrar estado Codex en el panel sin bloquear la interfaz. | <400 líneas. |

## Hallazgos que guían la cadena

| Hallazgo | Impacto en revisión |
|----------|---------------------|
| OpenSpec, docs, Engram, policy y runtime están desalineados. | PR1 define el source-of-truth antes de tocar comportamiento. |
| `control-tui/session.created` auto-flip es el patrón determinístico vivo para convertir `task` bloqueante en background. | PR4 debe cubrir anti-loop y no bloqueo. |
| `messages.transform` existe en `packages/opencode`, pero puede caer en fallback background si no lee la policy real. | PR2 es crítico para no mandar `sdd-apply`/`sdd-verify` a BG por accidente. |
| `/task` commands tienen implementación unitaria, pero podrían no estar cableados al hook runtime real. | PR3 valida wiring real o corrige la documentación. |
| Docs/config difieren entre `bgSubagents.policy` y `~/.config/bg-subagents/policy.jsonc`. | PR1/PR2 deben cerrar la discrepancia de schema y path. |
| OpenSpec `tasks.md` tiene fases viejas/desfasadas. | PR1 actualiza el plan a estado as-built. |

## Scope por PR

### PR0 - Tracker/chain map

- [x] Crear este documento.
- [ ] Abrir PR contra `main` desde `feat/sdd-bg-control-reconciliation`.
- [ ] Dejar explícito que los child PRs se revisan contra PR0, no contra `main`.

### PR1 - Plan reconciliation

- [ ] Actualizar OpenSpec `tasks.md`, specs y design al estado as-built.
- [ ] Decidir y documentar el source-of-truth para policy y routing.
- [ ] Separar deuda histórica de trabajo necesario para cerrar #19.

### PR2 - Runtime policy alignment

- [ ] Confirmar si `messages.transform` lee `~/.config/bg-subagents/policy.jsonc` y `default_mode_by_agent_name`.
- [ ] Garantizar que `sdd-apply` y `sdd-verify` queden en `foreground`.
- [ ] Si no se puede garantizar la policy real, safe-disable del rewrite antes que fallback BG incorrecto.

### PR3 - Runtime command/control wiring

- [ ] Verificar wiring real de `/task policy`, `/task list`, `/task show`, `/task kill`, `/task move-bg`.
- [ ] Cablear comandos al runtime si corresponde.
- [ ] Retirar o corregir docs si un comando no existe en runtime.

### PR4 - SDD regression tests

- [ ] Cubrir que BG no bloquea la interfaz.
- [ ] Cubrir que FG bloquea por diseño.
- [ ] Cubrir auto-flip `control-tui/session.created` sin loops.

### PR5 - Docs/diagrams polish

- [x] Actualizar README y arquitectura con el flujo real verificado.
- [x] Actualizar skill docs SDD si mencionan routing viejo.
- [x] Dejar diagramas precisos y sin promesas no implementadas.
- [ ] Revisión final de la cadena antes de cerrar #19.

### PR6 - Codex status panel

- [x] Ejecutar `codex /status` en background con `spawn`, timeout y sin overlap.
- [x] Parsear modelo, cuenta, sesión y límites; persistir snapshot local `codex_status.json`.
- [x] Mostrar un bloque compacto en el panel sin ejecutar comandos desde el render.

## Criterios de aceptación globales

- [ ] `background => no bloquea interfaz` está implementado, testeado y documentado.
- [ ] `foreground => puede bloquear y es intencional` está implementado, testeado y documentado.
- [ ] `sdd-apply` y `sdd-verify` no caen a background por fallback o config drift.
- [ ] Policy runtime y docs usan el mismo source-of-truth.
- [ ] `/task` docs reflejan solo comandos cableados al runtime real.
- [ ] OpenSpec describe el sistema as-built, no fases históricas obsoletas.
- [ ] Cada child PR se mantiene bajo 400 líneas revisables.

## Plan de verificación por PR

| PR | Verificación mínima |
|----|---------------------|
| PR0 | Markdown revisable y enlace `Tracks #19`. Sin build. |
| PR1 | Diff de OpenSpec coherente: tasks/spec/design apuntan al mismo source-of-truth. |
| PR2 | Tests o verificación barata que pruebe policy real y FG para `sdd-apply`/`sdd-verify`. |
| PR3 | Prueba de wiring real por comando o eliminación explícita de docs no implementadas. |
| PR4 | Regresiones SDD para BG no bloqueante, FG bloqueante y auto-flip anti-loop. |
| PR5 | Docs y diagramas coinciden con el runtime validado en PR2-PR4. |
| PR6 | Tests focalizados de parser, formato compacto y no-overlap del monitor Codex. |

## Notas de revisión

- PR0 no cierra #19; solo lo trackea.
- Dejar `Closes #19` para el PR final si la cadena completa satisface los criterios globales.
- Si un child PR supera 400 líneas, dividirlo antes de pedir review.
