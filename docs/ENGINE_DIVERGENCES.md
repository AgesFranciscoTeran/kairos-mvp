# Motor TS frente al motor de referencia (Python)

El motor de `engine/` es un port fiel de `reference/python/kairos-replay/kairos_engine.py`
(kairos-tech `4942044`). La paridad se verifica con las fixtures de `fixtures/`: mismas
ventanas, misma traza.

Este documento registra dos cosas:

1. **Hallazgos (H-xx)**: comportamientos del motor de referencia que parecen bugs o
   decisiones discutibles. **No se corrigen en el port**: la paridad va primero. Cada uno
   espera una decisión de producto.
2. **Extensiones (X-xx)**: lo que el motor TS hace y el Python no. Viven fuera de la ruta
   de paridad y tienen tests propios. Los tests de paridad corren sin ellas.

---

## Hallazgos en el motor de referencia (pendientes de decisión)

### H-01 · `_exit_streak` no se reinicia al entrar en WATCH

`resolved`, `escalate`, `watch_cancelled` y la transición IDLE→WATCH no ponen
`_exit_streak` en 0. Un WATCH nuevo hereda la racha anterior y puede cerrarse con menos de
`k_exit` ventanas bajo `theta_exit`.

- Evidencia: en el registro canónico (`synthetic-seed7`), el WATCH de t=930 hereda 1 y
  emite `watch_end` en t=960, tras una sola ventana baja. Test de caracterización:
  `reference/python/tests/test_fixtures.py::test_stale_exit_streak_is_reference_behaviour`.
- Corrección probable: `self._exit_streak = 0` al entrar en WATCH.

### H-02 · La línea base vuelve a aprender justo después de un escalamiento

ESCALATE dura una ventana y vuelve a IDLE. Desde ahí, cada ventana limpia en IDLE
actualiza la línea base, aunque la activación no haya cedido (por eso se escaló). En
`synthetic-seed7`, las ventanas de t=2580 y 2610 (aún en el bloque de activación) entran a
la línea base. Contradice la intención declarada: "la línea base se congela durante la
activación para que un episodio largo no se vuelva lo normal".

Relacionado: la ventana que dispara IDLE→WATCH también actualiza la línea base, porque
`_update_baseline` se llama antes de `_advance_timers`. Con `ewma_alpha=0.02` el efecto es
pequeño, pero existe.

### H-03 · La gracia de RECOVERY corre durante ventanas bloqueadas por movimiento

En RECOVERY, una ventana bloqueada llama `_advance_timers(score=None)`. La racha de salida
no avanza, pero el reloj de gracia sí. Se puede escalar mientras el usuario se mueve: en
`synthetic-seed42` el escalamiento ocurre en una ventana bloqueada (la razón registrada es
"actividad física detectada").

### H-04 · Definición de TTB

El TTB del evento `resolved` se mide desde la entrada a WATCH (`_episode_start`) hasta la
k_exit-ésima ventana bajo `theta_exit`. El docstring de `operational_metrics` dice
"tiempo hasta volver bajo el umbral de salida tras disparar". La UI usa la definición del
motor (desde WATCH) y lo dice explícitamente.

### H-05 · `_finish_warmup` divide por cero si una feature nunca llegó finita

Si alguna clave de TRACKED no trae valores finitos durante todo el warmup, `n = 0` y
`sum(vals) / n` lanza `ZeroDivisionError`. El port reproduce el caso sin lanzar: produce
NaN en `mu`, igual que lo haría el cálculo sin guardas. Ninguna fixture lo ejercita porque
Python no tiene salida que comparar. Las fuentes del MVP siempre emiten todas las claves
durante el warmup, salvo `PhoneImuSource` sola, que nunca completa el warmup (sin HRV).

### H-06 · `build_replay.py` y la ruta del extractor

En kairos-tech, `build_replay.py` está en la raíz, pero `DEFAULT_EXTRACTOR` apunta a
`../wesad-feasibility/` y el README cita `kairos-replay/`, que no existe. En
`reference/python/` el archivo vive en `kairos-replay/` para que la ruta resuelva sin
editarlo.

---

## Detalles de paridad (no son divergencias)

- **Suma de floats.** Desde Python 3.12, `sum()` usa suma compensada (Neumaier):
  `sum([0.1]*10) == 1.0`. El port usa `pySum` con el mismo algoritmo en `_finish_warmup`
  y `_mean_last`.
- **Redondeo.** `round(x, n)` y `f"{x:.nf}"` redondean al par en empates exactos del valor
  binario (`round(0.03125, 4) == 0.0312`, `f"{0.125:.2f}" == "0.12"`). `toFixed` de JS
  redondea hacia arriba. El port usa `pyRound` y `pyFixed`.
- **NaN y null.** JSON no tiene NaN: las fixtures lo exportan como `null`, y el motor TS
  trata `null`, `undefined` y no finitos igual que Python trata `None` y no finitos.

---

## Extensiones del motor TS

### X-01 · Acciones explícitas del usuario: `applyAction`

`engine.applyAction(action)` es la única vía por la que el usuario influye en el motor.
Si la acción no corresponde al estado actual, se ignora sin efectos y devuelve `null`. Su
`t` es tiempo de registro; si llega antes que la última ventana procesada, se lleva a esa
ventana. Los eventos que produce llevan `actor: 'user'`. Ningún evento de la ruta de
paridad lo lleva.

| Acción | Solo en | Efecto | Evento |
|---|---|---|---|
| `end_intervention` | INTERVENE | El mismo que el fin natural de la intervención, adelantado: RECOVERY, `phase_start = t`, `exit_streak = 0`. La gracia de RECOVERY se cuenta desde `t`. | `intervention_end` (detail "respiración terminada por el usuario") |
| `cancel_escalation` | ESCALATE | El mismo que la salida natural de ESCALATE: IDLE, cooldown desde `t`, scores vacíos, episodio cerrado. | `escalation_cancelled` |
| `open_escalation` | ESCALATE | Igual que la cancelación; registra que el usuario abrió el mensaje. | `escalation_opened` |

Por qué hace falta: en el Python, ESCALATE dura exactamente una ventana. En la app, el
reloj de registro se pausa durante la cuenta regresiva (ver el README), así que el motor
queda en ESCALATE hasta que el usuario decide. Si llegara una ventana sin acción previa,
el motor sale de ESCALATE como el Python.

Tests: `engine/test/actions.test.ts` y la variante "con acciones del usuario" de
`engine/test/invariants.test.ts`. `engine/test/parity.test.ts` no llama `applyAction`.

### X-02 · Opción `recordTrace`

`new KairosEngine(cfg, { recordTrace: false })` no acumula `trace` en memoria (para
sesiones en vivo largas). No cambia ninguna decisión: `step` devuelve el mismo
`EngineState`. Default: `true`, como el Python.

### X-03 · `internals`

Getter de solo lectura (línea base, cooldown, rachas) para los tests de invariantes y para
mostrar el progreso del warmup en la UI. No modifica el estado.
