# Handoff: diseño de la AI Software Factory

Contexto de la sesión anterior (8 nov 2026) para empezar el diseño desde cero sin repetir preguntas. El usuario habla en español.

## Qué quiere construir

Una "AI Factory" de software como la de estos vídeos de RSC:

- https://www.youtube.com/watch?v=p6nnqerea7w (qué es una AI Factory y su software factory)
- https://www.youtube.com/watch?v=4hzSdtikHNs (por qué "solo pasar tests" no basta: ASDD)

Transcripciones guardadas en la sesión anterior; lo esencial está resumido abajo.

### Idea del vídeo 1 (software factory)

Proceso repetible y auditable: entra trabajo, sale resultado, y el humano solo interviene donde hay riesgo. Tres tipos de paso: código (determinista), agente (razona) y aprobación humana. Todo consulta un "brain": memoria persistente de decisiones del proyecto (arquitectura, decisiones previas), para no contradecirse.

Pipeline:

1. Entrada única: errores de Sentry, issues de GitHub o tareas que manda el usuario (voz, Slack).
2. Spec writer (Opus): consulta el brain y escribe la spec.
3. Builder (Opus): worktree y rama nuevos, TDD por cada tarea de la spec.
4. Cuatro revisores con contexto limpio y modelos distintos para evitar autosesgo: seguridad (modelo de OpenAI vía Codex), UX, UI (modelo especializado en computer use) y código (Sonnet).
5. Approver (Opus): junta el feedback; si hay negativos, vuelve al builder en bucle.
6. Clasificador de riesgo (modelo grande): cambios triviales (color de un botón) se mergean solos; backend, base de datos o core van a PR con aprobación humana. Reforzado con hooks/código, no solo con el criterio del agente.
7. Las tareas corren en paralelo, cada una con su ID y rama.

### Lección del vídeo 2 (ASDD)

Ocho horas de autonomía con 12 specs y "pasa los tests" como único objetivo produjeron más de 4.500 tests y un "Frankenstein": el agente asumió decisiones no pedidas (quitó login por token, añadió un QR). Solución:

- La spec define qué podrá hacer el usuario (acción, condiciones, permisos), qué resultado se espera, qué debe respetar (decisiones y features previas del brain) y cómo se demuestra (cómo comprobarlo y qué evidencia queda).
- La revisión ocurre dentro de la implementación: autocomprobación con evidencia, revisores con contexto limpio, verificación de hallazgos contra el código real, controles obligatorios (un control fallido impide cerrar la tarea; uno no ejecutado queda visible).
- Las decisiones se escalan según el riesgo y siempre se registran en el brain.

## Decisiones ya tomadas por el usuario

- Primero la software factory (no la de contenido).
- Este repo (`sergiofdezcano/AI-Software-Factory`, ahora solo con README) es la fábrica: agentes, reglas, brain y lanzador. Las apps sobre las que trabaja son repos aparte.
- App piloto: `sergiofdezcano/Serg4Cano-Landing-Page` (clonada en `C:\Users\sergi\Serg4Cano-Landing-Page`). Ya existe y está publicada en https://sergiofdezcano.github.io/Serg4Cano-Landing-Page/. Es Astro con datos en `src/data/*.json` validados por esquemas, tests con `npm run check` (vitest más Playwright con axe) y capturas con `node scripts/screenshot.mjs`. Eso le da a la fábrica cómo demostrar su trabajo.
- Ejecución: empezar en local (o con GitHub) y migrar después a su servidor. Su servidor es un equipo en casa con Proxmox, muchos LXC y VMs, algunos con Docker. Quiere que esté siempre disponible.
- Quiere usar Hermes Agent (Nous Research) como orquestador o punto de entrada si es viable. Dice que le "da problemas". Si no funciona, se puede montar otra instancia dedicada en el servidor. Hermes Agent v0.23.0 está instalado en este Windows (`hermes` en el PATH).
- Quiere usar a la vez sus suscripciones de Anthropic (Claude Code) y OpenAI (Codex), para que los revisores sean de otra familia de modelos. Codex CLI NO está instalado en este Windows. Claude Code tiene el MCP `zen`, que puede llamar a otros modelos.
- Diseño portable: toda la lógica (agentes, prompts, reglas de riesgo, brain) vive en el repo, y quien la lance (CLI local, GitHub Actions, Hermes o el servidor) ejecuta el mismo comando.

## Primeras tareas reales para la fábrica (backlog de la landing)

- Tweets automáticos: la API de X es de pago. La sección existe (`src/components/Tweets.astro`) pero está oculta con `tweets.json` vacío. El endpoint `cdn.syndication.twimg.com` sirve tweets por ID, pero no permite listar los últimos.
- Añadir el equipamiento (`setup.json`) cuando el usuario pase la lista. kit.co cerró, así que los enlaces viejos están muertos.
- Descuentos y patrocinadores (`deals.json`) cuando los haya.
- Dominio propio cuando lo compre.

## Preferencias del usuario

- Español, respuestas directas, recomendación clara en vez de listas de opciones.
- Le gusta avanzar rápido: en la landing pidió "implementa ya" antes del documento de diseño. Aun así, la fábrica es justo lo que el vídeo 2 advierte que se hace mal sin una spec clara.
- Textos sin pinta de IA (skill `humanizer` instalada) y diseño sin "AI slop" (plugins `impeccable` y `opendesigner` instalados).

## Siguiente paso

Seguir el flujo de brainstorming (superpowers:brainstorming) sobre la fábrica, pregunta a pregunta. Puntos abiertos a resolver:

1. Alcance del MVP: qué pasos del pipeline entran en la v1 (por ejemplo, entrada por issue de GitHub, spec, builder, 2 revisores, clasificador de riesgo y PR) y qué queda para después (Sentry, voz, Slack, paralelismo).
2. Cómo encaja Hermes: probar si Hermes puede lanzar `claude -p` / `codex exec` en el servidor, o usarlo solo como entrada por mensajería.
3. Formato del brain: archivos Markdown en el repo de cada app, una carpeta en la fábrica o un MCP de memoria.
4. Dónde corre la v1: Claude Code local con skills, subagentes y hooks, o GitHub Actions.
