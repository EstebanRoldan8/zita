# Estado de la auditoría del bot y del asistente (rama `fix/bot-asistente-auditoria`)

Referencia: `docs/AUDITORIA_BOT_ASISTENTE_2026-11.md`. Cada hallazgo se verificó en el código antes de tocarlo.

## Hallazgos

| # | Hallazgo | Estado | Dónde quedó |
|---|---|---|---|
| C1 | Atajo de "sí"/"no" sin contexto (CRÍTICO) | ✅ Corregido. Solo responde al recordatorio (guardado en el historial con `kind:'reminder'` + `appointment_id`) y actúa sobre esa cita | `chatbot.service.js`, `conversationStore.js`, `scheduler.service.js` |
| C2 | Webhook sin respuesta con el bot pausado | ✅ 200 inmediato siempre; con pausa el mensaje se guarda sin responder | `webhook.controller.js` |
| C3 | Deduplicación no atómica | ✅ `wa_processed_messages` (PK) al recibir; respaldo si falta la migración | `conversationStore.claimMessageId`, migración 064 |
| C4 | Solape ignora la duración de la cita nueva | ✅ Módulo único + `EXCLUDE` en BD | `utils/availability.js`, migración 062 |
| C5 | Plan siempre Lite | ✅ `plan` en el SELECT + `getPlan()` | `config/plans.js` |
| C6 | Reagendar usa hora UTC | ✅ `localParts`/`localISO` | `chatbot/tools/actualizar_cita.js` |
| C7 | `actualizar_cita` con validaciones incompletas | ✅ Horario con duración, festivos, hora pasada, solape, servicio nuevo | idem |
| C8 | Cliente buscado por nombre | ✅ Eliminado: la identidad es el teléfono | `chatbot/tools/agendar_cita.js` |
| C9 | ILIKE sin escapar | ✅ `escapeLike` + coincidencia exacta primero + `servicio_ambiguo` | `chatbot/shared.js` |
| C10 | Solo el primer mensaje del POST | ✅ Itera entry/changes/messages | `webhook.controller.js` |
| C11 | Texto vacío al agotar iteraciones | ✅ Respaldo + alerta `bot_empty_response` | `chatbot.service.js` |
| C12 | Historial: timestamps pisados, formato inconsistente | ✅ Timestamps reales, sin delimitadores, recorte en bloque | `conversationStore.js` |
| C13 | Grupos | ✅ Usan la misma validación (duración, festivo, hora pasada, solape). ⏳ El `context` del grupo sigue con leer-y-escribir (uso raro) | `chatbot/tools/gestionar_grupo.js` |
| S1 | Citas no validadas contra el cliente | ✅ `citaDelCliente` (negocio + cliente del teléfono) | `chatbot/tools/index.js` |
| S2 | Delimitador `<mensaje_usuario>` se podía cerrar | ✅ Se quitan las etiquetas del texto (bot, asistente, tienda) | |
| S3 | Respaldo desde el número global | ✅ Sale con el token/número del negocio, o no sale | `chatbot.service.js` |
| S4 | PII en logs | ✅ Bot, webhook, WhatsApp, scheduler: `maskPhone`, sin texto ni transcripciones | |
| S5 | Motivo de escalamiento sin límite | ✅ 200 caracteres | `chatbot/tools/escalar_a_humano.js` |
| S6 | Tokens de WhatsApp | ✔ Ya estaba bien (no se loguean) | |
| R1 | Reintentos a Anthropic | ✅ Solo transitorios (`error.status`), `maxRetries: 0` en el SDK | `utils/anthropicRetry.js` |
| R2 | Ventana de 24 h | ✅ `notify()` con plantillas (se activa con `WA_TEMPLATES_ENABLED`) + `reminder_sent_at` | `whatsappNotify.js`, `docs/PLANTILLAS_WHATSAPP.md`, migración 063 |
| R3 | Límites de iteración | ✅ Bot 5; asistente 10 → 6 + tope de 150.000 tokens de entrada por mensaje | |
| R4 | `sendTemplate` sin timeout, audio sin límite | ✅ | `config/whatsapp.js`, `chatbot.service.js` |
| 2.4 | Contradicciones del prompt del bot | ✅ Prompt reescrito (caso "quiero con Carlos" con datos inventados, fecha fija "4 julio", AM/PM, alternativas) | `chatbot/prompt.js` |
| 3.1 | Asistente: IDs de otro tenant en `crear_cita` / `actualizar_cita` | ✅ Validados contra el negocio | `assistant.service.js` |
| 3.1 | Asistente: sin validar disponibilidad / cita sin empleado | ✅ | idem |
| 3.1 | Asistente: `Z` → `-05:00` "cambia el instante" | ⚠️ **No se cambia, a propósito.** El prompt exige `-05:00`; cuando el modelo pone `Z` casi siempre es la hora de pared mal etiquetada ("3pm" → `15:00Z`). Tomarlo como UTC movería esas citas 5 horas. Queda explícito en `parseLocalDateTime` (otros offsets sí se convierten) | idem |
| 3.1 | Asistente: `.eq('client_id', null)` | ✅ `.is('client_id', null)` | idem |
| 3.1 | Asistente: contador `ai_messages_today` leer-y-escribir | ⏳ Pendiente (BAJO): con dos mensajes simultáneos puede contar uno de menos | |
| 3.2 | Asistente: contradicciones del prompt y 78 tools | ✅ Prompt por dominios + enrutamiento (15–18 tools por turno) + `pedir_herramientas` | `assistant/prompt.js` |
| 3.3 | Tienda: no guardaba el uso | ✅ Se registra en `ai_usage` | `storeAgent.js` |
| 3.3 | Tienda: la tool `interpretar` cambia por dominio e invalida el caché del prompt | ⏳ Pendiente: es una ineficiencia (cada combinación de dominios cachea aparte), no un bug. Arreglarlo exige reestructurar `interpretFor`/`validateIntent` | |
| 2.5 | `processChatbotMessage` gigante, tools en una clausura | ✅ Una tool por archivo (`chatbot/tools/`), fila de conversación leída/escrita una vez | |
| 2.5 | `executeTool` del asistente (~3.250 líneas) | ⏳ Pendiente: riesgo de regresión alto (78 tools, la mayoría sin tests). Recomendado: primero tests de caracterización por dominio, luego mover un dominio por PR | |
| — | Serialización por cliente en memoria (varias réplicas) | ⏳ Pendiente: la deduplicación ya es global (BD); el orden por cliente sigue en memoria. Si Railway corre más de una réplica, mover a advisory lock | `webhook.controller.js` |

## Migraciones (correr en este orden)

| Archivo | Qué hace | Seguro con datos existentes |
|---|---|---|
| `062_citas_sin_solape.sql` | `ends_at` + trigger + `EXCLUDE USING gist` (requiere `btree_gist`) | Sí: si ya hay citas activas que se cruzan, NO crea la restricción y avisa (NOTICE); trae la consulta para revisarlas |
| `063_recordatorio_enviado.sql` | `appointments.reminder_sent_at` + índice | Sí |
| `064_whatsapp_mensajes_procesados.sql` | Tabla de idempotencia del webhook | Sí |
| `065_ai_usage.sql` | Tabla `ai_usage` + vista `ai_usage_daily` | Sí |

El backend funciona aunque todavía no se hayan corrido (cada una tiene su respaldo), pero las garantías completas (sin solapes en BD, recordatorio único, deduplicación atómica y medición de costo) llegan al correrlas.

**Ojo con la 062 en el panel:** después de correrla, la BD también rechaza en el panel una cita que se cruce con otra del mismo empleado (el panel responde 409 "ese horario se cruza…").

## Variables de entorno nuevas (opcionales)

`WA_TEMPLATES_ENABLED` (por defecto apagado), `WA_TEMPLATE_LANG`, `WA_TPL_*` (nombres de plantilla) y `BOT_MAX_MESSAGE_AGE_MIN` (30). Ver `backend/.env.example` y `docs/PLANTILLAS_WHATSAPP.md`.

## Cómo medir

- Tokens y costo modelado: `cd backend && node scripts/medir-tokens.js` (usa `count_tokens`, gratis; solo manda los prompts con un negocio ficticio).
- Costo real, después de correr la 065: `SELECT flow, dia, costo_usd, pct_cache_hit FROM ai_usage_daily ORDER BY dia DESC;`
- Tests: `cd backend && npm run test:bot` (y los demás `test:*`).
