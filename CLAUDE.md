# Kairos MVP — invariantes

MVP solo de software de Kairos: una PWA que corre DETECT → INTERVENE → RECOVERY → ESCALATE
en el teléfono, sin hardware. Sirve para demostrar y como base del piloto (cuando CEISH
apruebe). Kairos NO detecta emociones: trabaja con correlatos fisiológicos de activación.

## Arquitectura (no cambiar sin preguntar a Pancho)
1. Todo ocurre en el dispositivo. Sin backend, analítica, telemetría ni requests de red con
   datos del usuario. Sitio estático.
2. `reference/python/` es la verdad. `engine/` es un port TS puro (sin DOM) con paridad
   verificada por `fixtures/`: estado, gated, ready y eventos exactos; score y z con 1e-6.
3. Las fuentes implementan `SensorSource` y emiten `FeatureWindow` (todas las claves de
   TRACKED, `t`, etiqueta opcional). El motor no sabe de dónde viene la ventana ni ve la
   etiqueta. Extraer features es trabajo de la fuente.
4. Persistencia local en IndexedDB (Dexie). Exportación JSON manual y borrado total.
5. Humano en el bucle: la cuenta regresiva cancelable abre un mensaje prellenado
   (wa.me / sms:). Nunca se envía nada automáticamente.

## Reglas de trabajo
- Bug sospechado en el motor de referencia: NO se arregla en el port. Se anota en
  `docs/ENGINE_DIVERGENCES.md` y se pregunta.
- Toda extensión del motor (acciones del usuario) va por `applyAction`, se documenta en
  `ENGINE_DIVERGENCES.md` y se prueba aparte. Los tests de paridad corren sin acciones.
- `reference/python/` son copias literales de kairos-tech (`SOURCE_COMMIT`). No editarlas.
- No tocar `../kairos-tech` (es la portada pública en GitHub Pages).
- Preguntar antes de añadir dependencias pesadas.
- Datos derivados de WESAD solo en `fixtures/local/` (ignorada por git) o cargados desde un
  archivo local. El build público lleva solo el registro sintético.

## Producto
- Vocabulario: nunca "estrés", "ansiedad", "crisis" ni nombres de emociones. Se habla de
  "activación" y "tu reposo". La UI no muestra los `reason`/`detail` del motor tal cual.
- Mensaje al contacto: neutro, editable, sin datos fisiológicos.
- Intervención mínima necesaria; se escala solo si la activación no cedió.
- El usuario siempre puede terminar la respiración y cancelar el escalamiento.
- UI en español (Ecuador), strings en `app/src/ui/strings.ts`. Identificadores en inglés,
  comentarios en español.
- Valores de diseño no calibrados; sin dataset propio; sin desempeño reclamado.
- AA de contraste, `prefers-reduced-motion`, lector de pantalla.
- Una PWA no monitorea en segundo plano: Wake Lock y aviso honesto.

## Comandos
- `npm run check` — tipos + Vitest + pytest + Playwright (todo debe estar en verde)
- `npm test` / `npm run pytest` / `npm run e2e` por separado
- `npm run fixtures` (o `python reference/python/export_fixtures.py --wesad-dir DIR`)
- `npm run dev`, `npm run dev:https` (DeviceMotion en el teléfono), `npm run build`

## Entorno
- Windows con Smart App Control: sin binarios nativos sin firmar. Vite 7 + Vitest 3 con
  rollup/esbuild en WASM (`overrides`), Playwright con Edge (`PW_CHANNEL=chromium` en CI).
