# Kairos MVP

MVP solo de software de [Kairos](https://github.com/AgesFranciscoTeran/kairos-tech): una app web
instalable (PWA) que corre en el teléfono el ciclo completo del producto —detectar, intervenir,
medir la recuperación y, si la activación no cede, ofrecer avisar a un contacto de confianza— sin
hardware propio.

**Kairos no detecta emociones.** Trabaja con correlatos fisiológicos de activación (pulso,
variabilidad cardiaca, conductancia de la piel, temperatura y movimiento) y los compara con el
reposo de cada persona.

## Qué es y qué no es

Es:

- El motor de decisión de Kairos portado a TypeScript, con **paridad exacta** verificada contra el
  motor de referencia en Python.
- Un demostrador del ciclo completo, para incubadora, jurados y universidades.
- La base del piloto: registra episodios con su TTB y con **etiquetas de contexto** ("¿qué estabas
  haciendo?", "¿lo sentiste?"), la semilla del dataset con contexto verificado.

No es:

- **No es un dispositivo médico** ni diagnostica nada.
- **No está calibrado.** Los pesos y umbrales son valores de diseño, derivados de la dirección
  conocida de cada señal bajo activación simpática. Nada aquí es una medida de desempeño.
- **No tiene dataset propio.** La fisiología viene de registros sintéticos o de archivos locales
  (por ejemplo, WESAD). No hay señales fisiológicas en vivo: eso llegará con el sensor.
- **No envía mensajes por su cuenta.** Arma un mensaje neutro; la persona decide si lo envía.

Estado del proyecto: etapa de diseño. No hay producto desplegado para usuarios ni aprobación ética
todavía (el protocolo CEISH está en curso). Por eso, hoy **todo episodio se guarda marcado como
demo** y el panel de "uso real" está vacío a propósito.

## Probarlo

1. Abre el sitio publicado (ver [Despliegue](#despliegue)) o corre `npm run dev`.
2. Completa la bienvenida. El contacto de confianza es opcional.
3. En **Sesión** elige una fuente:
   - **Sintética**: registros con un desenlace conocido.
     - *Episodio que cede*: WATCH → respiración → recuperación → resuelto.
     - *Episodio que no cede*: termina en el escalamiento con cuenta regresiva cancelable.
     - *Ejercicio*: el movimiento bloquea la interpretación y no hay intervención.
     - *Demo completo*: el registro canónico de 90 minutos del motor de referencia.
   - **Replay**: un archivo JSON de ventanas, leído en el teléfono (ver [WESAD](#wesad)).
   - **Movimiento del teléfono**: solo el acelerómetro. Sin fisiología, la línea base nunca se
     completa. Sirve para ver el pipeline de movimiento.
   - **Híbrida**: fisiología de un registro y movimiento real del teléfono. **Sacudir el teléfono o
     caminar bloquea la interpretación**, y se ve en pantalla. En escritorio hay movimiento
     simulado (Quieto / Caminando / Sacudir).
4. Velocidad 1×, 10× o 30×. En escritorio, la **vista reloj** aparece junto a la vista de
   teléfono; también está sola en *Vista reloj*.

Para probar el modo híbrido desde el teléfono en la misma red: `npm run dev:https` y abre la
dirección de la red local que muestra Vite. DeviceMotion exige HTTPS, y en iOS pide permiso tras
un toque.

## Cómo funciona

```
SensorSource ──FeatureWindow──▶ Web Worker: EngineRunner ─▶ KairosEngine (port fiel)
 (sintética, replay,              │ quita la etiqueta de evaluación
  teléfono, híbrida)              ▼
                         SessionController ─▶ episodios ─▶ IndexedDB (Dexie)
                                │            └▶ UI (teléfono + reloj)
                                └▶ escalamiento: cuenta regresiva ─▶ wa.me / sms: (lo envía la persona)
```

- **`engine/`**: TypeScript puro, sin DOM. Es un port línea a línea de `kairos_engine.py` y de
  `operational_metrics`. Reproduce hasta la aritmética de CPython: suma compensada de `sum()` y
  redondeo al par de `round()` y `format()`.
- **Fuentes intercambiables.** Toda fuente emite un `FeatureWindow` cada `step_sec`, con todas las
  claves de `TRACKED`. Extraer features es trabajo de la fuente. El motor no sabe de dónde viene la
  ventana ni ve la etiqueta. Un puente a un sensor real se conecta sin tocar el motor.
- **Acciones del usuario.** Terminar la respiración y cancelar o abrir el escalamiento entran al
  motor por `applyAction`, una extensión documentada en
  [`docs/ENGINE_DIVERGENCES.md`](docs/ENGINE_DIVERGENCES.md) y probada aparte.

### Reloj acelerado y fases de duración humana

El motor solo conoce el **tiempo de registro** (el `t` de cada ventana). La velocidad solo cambia
cuán rápido avanza ese tiempo. Las fases humanas corren en tiempo real:

- **Al entrar en la respiración, la reproducción baja sola a 1×** hasta que termina. Así los 90 s
  del motor son 90 s reales de respiración. El reloj además retrocede al `t` de la ventana que
  disparó la intervención, para no restar los segundos que corrieron a 30× mientras el motor
  respondía.
- **Durante el escalamiento, el reloj de registro se pausa** y las ventanas que ya venían esperan.
  La cuenta regresiva corre en tiempo real. Cancelar o abrir el mensaje libera el motor.
- El etiquetado no pausa nada: queda en cola y se puede hacer después desde el historial.

## Privacidad

- **Todo ocurre en el teléfono.** No hay backend, cuentas, analítica ni telemetría.
- El build lleva una Content-Security-Policy con `connect-src 'self'`: el navegador rechaza
  cualquier request a otro origen aunque el código lo intentara.
- Un test de Playwright intercepta la red durante un ciclo completo (escalamiento, etiquetado,
  marcas y exportación). Verifica que no sale ninguna request del origen y que dentro del origen
  solo hay GET de archivos estáticos, sin parámetros.
- La única salida es la que la persona decide: abrir el mensaje en WhatsApp o SMS. El mensaje no
  incluye datos fisiológicos.
- Exportación manual a JSON y borrado total desde *Ajustes*.

## Limitaciones conocidas

- **Una PWA no monitorea en segundo plano**, sobre todo en iOS. Kairos usa Wake Lock para
  mantener la pantalla encendida durante la sesión y lo avisa en la UI. Con la app cerrada o en
  segundo plano, no hay monitoreo.
- **Abrir el mensaje sin un toque.** Al terminar la cuenta regresiva, algunos navegadores bloquean
  abrir WhatsApp o SMS sin un gesto. En ese caso aparece un botón "Abrir mensaje".
- **Movimiento durante el warmup.** La línea base de movimiento se aprende en las primeras
  ventanas. Si la persona se mueve mucho ahí, ese movimiento pasa a ser "su reposo" y el bloqueo
  pierde sensibilidad. Si en cambio el teléfono está inmóvil sobre una mesa, la dispersión es
  mínima y cualquier toque bloquea. Es comportamiento del motor de referencia (no calibrado); la
  UI pide sostener el teléfono como se usaría.
- **Unidades del movimiento.** El teléfono mide en m/s² y el E4 de WESAD no. En modo híbrido,
  `acc_move_std` viene siempre del teléfono desde la primera ventana, así la línea base queda en
  una sola unidad. La velocidad se fija al iniciar porque la ventana de movimiento depende de ella.
- **Hallazgos en el motor de referencia** (posibles bugs portados tal cual, pendientes de
  decisión): ver [`docs/ENGINE_DIVERGENCES.md`](docs/ENGINE_DIVERGENCES.md).

## Desarrollo

Requisitos: Node 20 o superior, Python 3.12 o superior con `numpy` (y `scipy` para WESAD) y
`pytest`.

```bash
npm install
npm run check        # tipos + Vitest + pytest + Playwright
npm test             # motor (paridad, invariantes), fuentes, sesión, UI
npm run pytest       # fixtures al día y referencia cruzada con el demo publicado
npm run e2e          # Playwright contra el build de producción
npm run dev          # http://localhost:5173
npm run fixtures     # regenera fixtures/ desde el motor Python
```

Los E2E usan Microsoft Edge por defecto (`PW_CHANNEL=chromium` para el Chromium de Playwright).

**Windows con Smart App Control.** Esta máquina bloquea binarios nativos sin firmar (`.node`, el
`esbuild` nativo). Por eso el proyecto usa Vite 7 y Vitest 3 con `rollup` → `@rollup/wasm-node` y
`esbuild` → `esbuild-wasm` (ver `overrides` en `package.json`), y Playwright usa Edge. Todo funciona
igual en Linux y macOS. `npm audit` reporta una alerta moderada en `@vitest/mocker`: es solo de
desarrollo y no llega al build.

### Paridad con el motor de referencia

`reference/python/` tiene copias literales de kairos-tech (`SOURCE_COMMIT`).
`export_fixtures.py` corre el motor Python sobre 8 registros sintéticos (el canónico, otras
semillas, huecos de señal y una configuración alternativa) y guarda ventanas y traza esperada en
`fixtures/`. `engine/test/parity.test.ts` exige estado, `gated`, `ready`, `reason`, eventos y
métricas idénticos, con score y z dentro de 1e-6. En la práctica coinciden bit a bit.

### WESAD

```bash
python reference/python/export_fixtures.py --wesad-dir ./WESAD --max-subjects 3
```

Escribe `fixtures/local/wesad-S*.json` (ignorado por git). Los tests de paridad los usan si existen,
y cada archivo se puede cargar en la app como **Replay**.

WESAD (Schmidt et al., 2018) se publica bajo CC BY 4.0, pero su documentación limita el uso a
fines científicos y no comerciales, con atribución. **El build público no incluye ningún dato
derivado de WESAD**: solo el registro sintético. Los replays de WESAD se cargan desde un archivo
local y no salen del dispositivo.

## Despliegue

**GitHub Pages en un paso.** Haz push a `main`. El workflow
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) corre pytest, tipos, Vitest y
Playwright y, si todo pasa, publica `app/dist`. Una sola vez, en el repo de GitHub:
*Settings → Pages → Source: GitHub Actions*.

**Netlify.** Conecta el repo; `netlify.toml` ya define el build y la carpeta.

El build usa rutas relativas, así que sirve igual en la raíz de un dominio o en `/kairos-mvp/`.

## Estructura

```
reference/python/   motor + replay + extractor (copias literales) + export_fixtures.py + pytest
fixtures/           ventanas y trazas esperadas (JSON); local/ para WESAD
engine/             motor TS puro + tests de paridad, invariantes y acciones
app/                PWA (fuentes, sesión, UI, persistencia)
e2e/                Playwright: flujo, escalamiento, híbrido, red, accesibilidad, offline
docs/               ENGINE_DIVERGENCES.md
```

## Referencia

Schmidt, P., Reiss, A., Duerichen, R., Marberger, C., & Van Laerhoven, K. (2018). *Introducing
WESAD, a Multimodal Dataset for Wearable Stress and Affect Detection.* ICMI.
