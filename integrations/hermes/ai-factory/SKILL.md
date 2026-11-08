---
name: ai-factory
description: Encarga trabajo a la AI Software Factory de Sergio y consulta cómo va. Úsala cuando pida cambios, mejoras o arreglos en una de sus apps (por ejemplo la landing), o pregunte por el estado de una tarea, una PR o lo que hay en curso.
---

# AI Software Factory

La fábrica construye, revisa y entrega cambios en las apps de Sergio. Su cola de trabajo son los **issues de GitHub con la etiqueta `factory`**: tu papel es crear esos issues bien escritos y contar cómo van. La fábrica hace el resto sola y avisa en este mismo chat.

No escribes código, no abres PR y no mergeas. Solo issues y lectura de estado.

## Apps

| Nombre | Repo |
|---|---|
| landing | `sergiofdezcano/Serg4Cano-Landing-Page` |

Si Sergio no dice la app y solo hay una, usa esa. Si hay varias y no está claro, pregunta.

## Encargar una tarea

1. Entiende qué quiere. Pregunta **solo** si falta algo que no se puede deducir: una URL, un texto exacto o un dato que no está en la web.
2. Redacta el issue:
   - **Título**: qué cambia para el visitante, en una línea. Ej.: «Añadir iconos de redes sociales en el hero».
   - **Cuerpo**: qué quiere y por qué, en sus palabras; ejemplos o enlaces que haya dado; y lo que no debe cambiar, si lo dijo. No inventes datos como URLs, precios o nombres. Si falta alguno, déjalo indicado para que la fábrica lo pregunte.
3. Créalo:
   ```bash
   gh issue create -R <repo> --label factory --title "<título>" --body-file - <<'EOF'
   <cuerpo>

   _Pedido por Telegram vía Hermes._
   EOF
   ```
4. Responde con el enlace y una frase: «Encargado. La fábrica empieza en unos minutos y te aviso aquí.»

## Estado de una tarea

```bash
gh issue view <n> -R <repo> --json title,state,labels,comments \
  -q '{title, state, labels: [.labels[].name], last: (.comments[-1].body // "")[0:600]}'
```

Traduce la etiqueta `factory:*` y resume el último comentario en una o dos frases:

| Etiqueta | Significa |
|---|---|
| factory (sola) | En cola; empieza en menos de 5 min |
| factory:spec / factory:awaiting-spec | Escribiendo o esperando la spec |
| factory:building | Construyendo |
| factory:reviewing | Revisando (Claude y Codex) |
| factory:pr | PR abierta para que Sergio la revise (incluye el enlace) |
| factory:merged | Hecho y publicado |
| factory:stuck | Atascado: explica el motivo del último comentario |
| factory:paused | En pausa por cuota; se reintenta solo |

Si pregunta por una tarea sin número («¿cómo va lo de Steam?»), búscala:
```bash
gh issue list -R <repo> --label factory --state all --search "<palabras>" --json number,title,state --limit 5
```

## Qué hay en curso

```bash
gh issue list -R <repo> --label factory --state open --json number,title,labels \
  -q '.[] | "#\(.number) \(.title) [\([.labels[].name | select(startswith("factory:"))] | join(","))]"'
```

## Reglas

- Una petición es un issue. Si pide varias cosas sin relación, crea varios y dilo.
- Nunca quites ni cambies etiquetas `factory:*`: son de la fábrica.
- Para reintentar una tarea atascada, no lo hagas tú: dile a Sergio que comente en el issue o que lo reabra.
- El token de GitHub de esta skill solo puede gestionar issues. Si algo pide más permisos, no es tarea tuya.
