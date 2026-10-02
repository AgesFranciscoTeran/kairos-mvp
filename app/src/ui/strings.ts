/**
 * Todos los textos de la UI, en español (Ecuador).
 *
 * Reglas de vocabulario (las verifica strings.test.ts):
 * - nunca "estrés", "ansiedad", "crisis" ni nombres de emociones;
 * - se habla de "activación" y de "tu reposo";
 * - el mensaje al contacto no expone datos fisiológicos.
 */
import type { EngineStateName, ScoredKey } from '@kairos/engine';

export const S = {
  appName: 'Kairos',
  tagline: 'Regulación local de la activación fisiológica',

  nav: {
    session: 'Sesión',
    history: 'Historial',
    metrics: 'Métricas',
    settings: 'Ajustes',
    watch: 'Vista reloj',
    skip: 'Saltar al contenido',
  },

  // ------------------------------------------------------------------ //
  onboarding: {
    step: (i: number, n: number) => `Paso ${i} de ${n}`,
    next: 'Siguiente',
    back: 'Atrás',
    finish: 'Empezar',
    whatTitle: 'Qué es Kairos',
    whatBody: [
      'Kairos observa correlatos fisiológicos de activación —pulso, variabilidad cardiaca, conductancia de la piel, temperatura y movimiento— y los compara con tu propio reposo.',
      'Cuando la activación se sostiene, te propone una respiración guiada de 90 segundos. Si no cede, te ofrece avisar a una persona de confianza que tú elegiste.',
    ],
    whatNotTitle: 'Qué no es',
    whatNot: [
      'No detecta emociones ni dice lo que sientes.',
      'No diagnostica nada.',
      'No envía mensajes por su cuenta: tú decides siempre.',
      'Este MVP no está calibrado ni tiene desempeño validado. Sus umbrales son valores de diseño.',
    ],
    safetyTitle: 'Antes de seguir',
    safetyMedical: 'Kairos no es un dispositivo médico y no reemplaza la atención profesional.',
    safetyEmergency: 'Si estás en una emergencia, llama al 911 (ECU 911).',
    safetyPrivacy:
      'Todo se procesa en este teléfono. No hay cuentas, servidores ni analítica. Tus datos solo salen si tú los exportas.',
    safetyBackground:
      'Una app web no puede monitorear en segundo plano. Kairos solo funciona con la pantalla encendida y la app abierta.',
    safetyAccept: 'Entiendo',
    contactTitle: 'Tu contacto de confianza',
    contactIntro:
      'Si la activación no cede después de la respiración, Kairos te ofrecerá abrir un mensaje para esta persona. Nunca se envía solo.',
    yourName: 'Tu nombre (para el mensaje)',
    contactName: 'Nombre del contacto',
    contactPhone: 'Teléfono del contacto',
    contactPhoneHint: 'Ejemplo: 0991234567 o +593991234567',
    channel: 'Cómo abrir el mensaje',
    channelWhatsapp: 'WhatsApp',
    channelSms: 'SMS',
    message: 'Mensaje (puedes editarlo)',
    messageHint: '{nombre} se reemplaza por tu nombre. No incluyas datos de salud.',
    contactLater: 'Configurar después',
  },

  // ------------------------------------------------------------------ //
  session: {
    title: 'Sesión',
    chooseSource: 'Fuente de datos',
    sources: {
      synthetic: 'Sintética',
      replay: 'Replay (archivo local)',
      'phone-imu': 'Movimiento del teléfono',
      hybrid: 'Híbrida: registro + movimiento',
    },
    sourceHelp: {
      synthetic: 'Registros generados, con episodios conocidos. Sirven para ver el ciclo completo.',
      replay: 'Un archivo de ventanas exportado en tu computadora (por ejemplo, desde WESAD). Se lee aquí y no se sube a ningún lado.',
      'phone-imu': 'Solo el acelerómetro del teléfono. Sin señales fisiológicas, la línea base nunca se completa: sirve para ver el bloqueo por movimiento.',
      hybrid: 'Fisiología de un registro y movimiento real del teléfono. Mover el teléfono bloquea la interpretación.',
    },
    scenario: 'Registro',
    scenarios: {
      canonical: 'Demo completo (90 min): ejercicio, un episodio que escala y otro que cede',
      resolves: 'Episodio que cede (30 min)',
      escalates: 'Episodio que no cede (35 min)',
      exercise: 'Ejercicio: el movimiento bloquea (25 min)',
    },
    loadFile: 'Elegir archivo JSON',
    fileLoaded: (name: string, n: number) => `${name}: ${n} ventanas`,
    motionSource: 'Movimiento',
    motionReal: 'Sensores del teléfono',
    motionSimulated: 'Simulado (para escritorio)',
    speed: 'Velocidad',
    speedX: (s: number) => `${s}×`,
    speedLocked: 'En modo híbrido la velocidad se fija al iniciar.',
    speedForced: '1× durante la respiración',
    start: 'Iniciar sesión',
    play: 'Reanudar',
    pause: 'Pausar',
    stop: 'Terminar sesión',
    ended: 'El registro terminó.',
    newSession: 'Nueva sesión',
    recordTime: 'Tiempo de registro',
    demoBadge: 'Demo',
    realBadge: 'Uso real',
    syntheticBadge: 'Datos sintéticos',
    simulatedBadge: 'Movimiento simulado',
    wakeLockOn: 'Pantalla activa durante la sesión',
    wakeLockOff: 'Este navegador no puede mantener la pantalla encendida',
    backgroundNote: 'Mantén la app abierta: en segundo plano no monitorea.',
    needsPermission: 'Sin permiso para los sensores de movimiento. Puedes usar movimiento simulado.',
    noSensor: 'No llegan datos de movimiento. En escritorio, usa movimiento simulado.',
    markMoment: 'Marcar este momento',
    simulate: 'Simular',
    simActivities: { still: 'Quieto', walking: 'Caminando', shaking: 'Sacudir' },
  },

  // ------------------------------------------------------------------ //
  monitor: {
    warmup: 'Aprendiendo tu reposo',
    warmupProgress: (n: number, of: number) => `${n} de ${of} ventanas`,
    warmupHelp: 'Mientras tanto no se decide nada. Mantente en reposo y sostén el teléfono como lo usarías.',
    score: 'Activación respecto a tu reposo',
    scoreHelp: 'Score compuesto. Sobre 0,50 se vigila; sobre 0,90 sostenido se interviene.',
    signals: 'Señales',
    signalNames: { hr: 'Pulso', rmssd: 'Variabilidad cardiaca', eda: 'Conductancia de la piel', acc: 'Movimiento' },
    gated: 'Interpretación bloqueada',
    gatedMotion: 'Hay movimiento: la fisiología no se interpreta ahora.',
    gatedSignal: 'Señal insuficiente en esta ventana.',
    settling: 'Asentando tras el movimiento.',
    cooldown: 'Pausa entre intervenciones',
    liveMotion: 'Movimiento ahora',
    liveLevels: { still: 'Quieto', light: 'Leve', walking: 'Caminando', vigorous: 'Vigoroso' },
    noData: 'Sin datos todavía',
  },

  states: {
    IDLE: 'En reposo',
    WATCH: 'Observando',
    INTERVENE: 'Respiración',
    RECOVERY: 'Recuperación',
    ESCALATE: 'Contacto de confianza',
  } satisfies Record<EngineStateName, string>,
  stateGated: 'Bloqueado por movimiento',
  stateWarmup: 'Calibrando',

  // ------------------------------------------------------------------ //
  detection: {
    watchTitle: 'Notamos activación',
    watchBody: 'Seguimos observando. No hace falta hacer nada todavía.',
    interveneTitle: 'Activación sostenida',
    evidenceLead: 'Lo que vemos, comparado con tu reposo:',
    noEvidence: 'Varias señales se alejaron un poco de tu reposo.',
    proposal: 'Te proponemos respirar 90 segundos.',
  },

  evidence: {
    up: {
      hr_mean: 'Tu pulso está más alto',
      eda_scl_mean: 'Tu piel conduce más',
      eda_scl_slope: 'La conductancia de tu piel viene subiendo',
      eda_scr_count: 'Hay más respuestas breves de la piel',
    },
    down: {
      rmssd: 'Tu variabilidad cardiaca está más baja',
      sdnn: 'Tus latidos varían menos',
      pnn50: 'Hay menos cambios grandes entre latidos',
      temp_mean: 'Tu piel está más fría',
      temp_slope: 'La temperatura de tu piel viene bajando',
    },
    strong: 'bastante',
  } satisfies { up: Partial<Record<ScoredKey, string>>; down: Partial<Record<ScoredKey, string>>; strong: string },

  // ------------------------------------------------------------------ //
  breathing: {
    title: 'Respira conmigo',
    inhale: 'Inhala',
    hold: 'Sostén',
    exhale: 'Exhala',
    seconds: (n: number) => `${n} segundos`,
    then: 'Luego:',
    remaining: (s: string) => `Quedan ${s}`,
    endEarly: 'Terminar antes',
    paused: 'En pausa',
    footer: 'Respiración guiada · 90 segundos',
  },

  recovery: {
    title: 'Midiendo tu recuperación',
    body: 'Respira normal. Vemos si la activación vuelve hacia tu reposo.',
    ttb: 'Tiempo desde que empezó',
    ttbHelp: 'TTB: tiempo hasta volver a tu reposo, contado desde que empezamos a observar.',
    grace: (s: string, name: string) => `Si no cede en ${s}, te propondremos escribir a ${name}.`,
    graceNoContact: (s: string) => `Si no cede en ${s}, te propondremos escribir a tu contacto de confianza.`,
  },

  resolved: {
    title: 'La activación cedió',
    ttb: (s: string) => `Volviste a tu reposo en ${s}`,
    watchEnd: 'La activación cedió sola',
  },

  escalation: {
    title: 'La activación no cedió',
    body: (name: string) => `Abriremos un mensaje para ${name}. Tú decides si lo envías.`,
    bodyNoContact: 'No configuraste un contacto de confianza.',
    countdown: (n: number) => `Se abre en ${n} s`,
    cancel: 'Cancelar',
    openNow: 'Abrir mensaje ahora',
    openBlocked: 'El navegador no abrió el mensaje automáticamente.',
    openManual: 'Abrir mensaje',
    preview: 'Mensaje',
    secure: 'Nada se envía sin tu confirmación.',
    emergency: 'Si es una emergencia, llama al 911.',
    emergencyCall: 'Llamar al 911',
    configure: 'Configurar contacto',
    cancelled: 'Escalamiento cancelado',
    opened: 'Mensaje abierto',
  },

  // ------------------------------------------------------------------ //
  label: {
    title: 'Ayúdanos a entender este momento',
    titleManual: 'Marcar este momento',
    intro: 'Tus respuestas se guardan solo en este teléfono.',
    whatDoing: '¿Qué estabas haciendo?',
    activities: {
      studying: 'Estudiando',
      exam: 'Examen',
      exercise: 'Ejercicio',
      caffeine: 'Cafeína',
      hard_conversation: 'Conversación difícil',
      temperature: 'Frío o calor',
      other: 'Otro',
    },
    otherPlaceholder: 'Cuéntanos qué',
    felt: '¿Lo sentiste?',
    feltOptions: { yes: 'Sí', no: 'No', unsure: 'No sé' },
    save: 'Guardar',
    later: 'Ahora no',
    pending: (n: number) => (n === 1 ? '1 momento sin etiquetar' : `${n} momentos sin etiquetar`),
    labelNow: 'Etiquetar',
  },

  // ------------------------------------------------------------------ //
  history: {
    title: 'Historial',
    empty: 'Aún no hay episodios.',
    outcome: {
      watch_end: 'Cedió sola',
      watch_cancelled: 'Explicado por movimiento',
      resolved: 'Cedió tras respirar',
      escalated: 'Escalado',
      interrupted: 'Sesión terminada',
    },
    escalation: { cancelled: 'cancelado', opened: 'mensaje abierto', auto: 'sin decisión' },
    ttb: 'TTB',
    intervened: 'Respiración',
    endedEarly: 'terminada antes',
    noLabel: 'Sin etiqueta',
    edit: 'Etiquetar',
    marks: 'Momentos marcados',
    demo: 'Demo',
    real: 'Real',
    filterAll: 'Todos',
    filterReal: 'Solo uso real',
    filterDemo: 'Solo demo',
  },

  // ------------------------------------------------------------------ //
  metrics: {
    title: 'Métricas',
    honesty:
      'Estas cifras describen el comportamiento del sistema con valores de diseño no calibrados. No son una medida de desempeño.',
    replayTitle: 'Replay etiquetado (última sesión)',
    replayNone: 'Corre un registro etiquetado (sintético o replay) para ver estas métricas.',
    replayLabelNote:
      'Las etiquetas del registro marcan los bloques de activación inducida del protocolo. El motor nunca las ve.',
    m: {
      windows: 'Ventanas',
      hours_total: 'Horas',
      episodes_real: 'Bloques etiquetados',
      coverage: 'Cobertura',
      interventions: 'Intervenciones',
      false_alarms: 'Falsas alarmas',
      false_alarms_per_rest_hour: 'Falsas alarmas por hora de reposo',
      detection_latency_median_s: 'Latencia mediana',
      gated_fraction: 'Fracción bloqueada',
      escalations: 'Escalamientos',
      ttb_median_s: 'TTB mediano',
    },
    realTitle: 'Uso real',
    realNone: 'Aún no hay episodios de uso real.',
    r: {
      episodes: 'Episodios',
      interventions: 'Intervenciones',
      escalations: 'Escalamientos',
      reportedFalse: 'Falsas alarmas reportadas',
      reportedFalseHelp: 'Intervenciones en las que respondiste "No" a "¿Lo sentiste?".',
      ttbMedian: 'TTB mediano',
    },
    ttbPerEpisode: 'TTB por episodio',
    demoTitle: 'Demo (todas las sesiones)',
  },

  // ------------------------------------------------------------------ //
  settings: {
    title: 'Ajustes',
    contact: 'Contacto de confianza',
    breathing: 'Respiración',
    pattern: 'Patrón',
    patterns: { '4-6': 'Inhala 4 · exhala 6', '4-4-6': 'Inhala 4 · sostén 4 · exhala 6', '5-5': 'Inhala 5 · exhala 5' },
    countdown: 'Cuenta regresiva del escalamiento (s)',
    engine: 'Motor',
    engineWarning: 'Valores de diseño, no calibrados.',
    engineHelp: 'Se aplican a la próxima sesión. Los valores por defecto son los del motor de referencia.',
    resetEngine: 'Restaurar valores por defecto',
    save: 'Guardar',
    saved: 'Guardado',
    data: 'Tus datos',
    dataHelp: 'Todo vive en este teléfono. Puedes exportarlo a un archivo o borrarlo por completo.',
    export: 'Exportar a JSON',
    deleteAll: 'Borrar todos mis datos',
    deleteConfirm: '¿Borrar todos los episodios, etiquetas y ajustes de este teléfono? No se puede deshacer.',
    deleted: 'Datos borrados',
    about: 'Acerca de este MVP',
    aboutBody:
      'MVP solo de software. Sin hardware propio, sin dataset propio y sin desempeño reclamado. El motor es un port verificado del motor de referencia de Kairos.',
    invalid: 'Revisa los valores marcados.',
    fields: {
      step_sec: 'Paso entre ventanas (s)',
      warmup_windows: 'Ventanas de warmup',
      ewma_alpha: 'Deriva de la línea base (α)',
      z_clip: 'Recorte de z',
      gate_z: 'Umbral de movimiento (z)',
      gate_release_windows: 'Ventanas para liberar el bloqueo',
      theta_watch: 'Umbral para observar',
      theta_act: 'Umbral para intervenir',
      theta_exit: 'Umbral de salida',
      k_watch: 'Ventanas para observar',
      k_act: 'Ventanas para intervenir',
      k_exit: 'Ventanas para salir',
      intervention_sec: 'Duración de la intervención (s)',
      recovery_grace_sec: 'Gracia de recuperación (s)',
      cooldown_sec: 'Pausa entre intervenciones (s)',
    },
  },

  watch: {
    title: 'Vista reloj',
    open: 'Abrir vista reloj',
  },

  defaultMessage: 'Hola, soy {nombre}. Activé Kairos, ¿me puedes escribir o llamar cuando puedas?',
  defaultUserName: 'yo',
  minutes: (m: number, s: number) => `${m} min ${s.toString().padStart(2, '0')} s`,
  seconds: (s: number) => `${s} s`,
} as const;
