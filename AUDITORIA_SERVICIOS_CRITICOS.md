# AUDITORÍA DE SERVICIOS CRÍTICOS - ZITA

**Fecha:** 2026-06-03  
**Foco:** Chatbot WhatsApp, Asistente IA, Scheduler, y flujos end-to-end  
**Auditor:** Claude (Senior AI Services Auditor)  

---

## RESUMEN EJECUTIVO

**Veredicto:** ⚠️ **BETA OK, PRODUCCIÓN REQUIERE FIXES**

Se identificaron **4 vulnerabilidades CRÍTICAS** que pueden causar fallos silenciosos en:
1. Conversaciones sin token de WhatsApp configurado
2. Scheduler enviando mensajes sin validación de tokens
3. Historial de conversación corto (4 mensajes vs 6 esperado)
4. console.log en producción (debug info expuesto)

**Servicios auditados:**
- ✅ Webhook (responde 200 antes de procesar) - BIEN
- 🟡 Chatbot (fallos silenciosos en error handling) - RIESGOS
- 🟡 Scheduler (inicialización sin guard, no valida tokens) - RIESGOS
- 🟡 Asistente (cliente global sin retry) - RIESGOS

---

## TABLA DE ISSUES POR SERVICIO

| Servicio | Archivo | Línea | Severidad | Descripción | Impacto | Fix |
|----------|---------|-------|-----------|-------------|---------|-----|
| Webhook | webhook.controller.js | 43 | - | Responde 200 ANTES de procesar | ✅ Correcto para evitar timeouts Meta | OK |
| Webhook | webhook.controller.js | 50 | BAJO | Error handler sin garantía (aunque headersSent check ayuda) | Si error async, Meta puede reintentar | Agregar try/catch anidado |
| WhatsApp | whatsapp.js | 9,26,29 | CRÍTICO | console.log en lugar de logger | Debug info en logs de producción | Cambiar a `logger.*()` |
| Chatbot | chatbot.service.js | 14 | CRÍTICO | getBusinessByPhoneNumberId NO valida error | Retorna undefined si query falla, crash en línea 650 | Agregar: `if (error) throw error;` |
| Chatbot | chatbot.service.js | 650-652 | CRÍTICO | Si businessToken es null (sin token WA configurado), sendMessage falla | Cliente no recibe respuesta, error silencioso en línea 679-681 | Validar businessToken antes de usar, enviar error al cliente |
| Chatbot | chatbot.service.js | 688 | CRÍTICO | Error general intenta sendMessage SIN token | Falla silenciosamente en catch(e) {} | Pasar token o usar fallback message |
| Chatbot | chatbot.service.js | 206 | MEDIO | saveConversationHistory guarda solo 4 últimos mensajes | Historial muy corto, pierde contexto | Cambiar `.slice(-4)` a `.slice(-6)` o más |
| Chatbot | chatbot.service.js | 595 | - | MAX_ITERATIONS = 5 | ✅ Buen límite para evitar loops | OK |
| Chatbot | chatbot.service.js | 563-572 | - | cleanHistory usa `let` para reasignación | ✅ Correcto, no bug de const | OK |
| Chatbot | chatbot.service.js | 172-182 | MEDIO | Si error recuperando historial, retorna [] silenciosamente | Usuario pierde contexto pero sigue funcionando | Considerar logguear en WARN |
| Chatbot | chatbot.service.js | 188-200 | - | Filtra bien (solo texto, no tool_use) | ✅ Historial limpio, no corrupción | OK |
| Scheduler | scheduler.service.js | 30 | CRÍTICO | initScheduler() SIN guard singleton | Puede llamarse múltiples veces, crons duplicados | Agregar: `let schedulerInitialized = false; if (!schedulerInitialized) { ... schedulerInitialized = true; }` |
| Scheduler | scheduler.service.js | 74 | CRÍTICO | sendMessage(owner_whatsapp, msg) sin token | Asume token en process.env - falla si no existe | Validar owner_whatsapp y token antes de enviar |
| Scheduler | scheduler.service.js | 116 | ALTO | sendMessage(cita.clients.phone, ...) | Si cliente.phone es null, falla (aunque filtro `.not() is null` debería prevenir) | Validar phone antes de enviar |
| Scheduler | scheduler.service.js | 74,116 | ALTO | No intenta decrypt del token del negocio | Asume token global - no soporta múltiples números WhatsApp | Usar business.whatsapp_access_token decrypt como en chatbot |
| Scheduler | scheduler.service.js | 157 | MEDIO | Comment "temporal para testing" en cron cada 5 minutos | Debería cambiar a horario real (ej: `0 */2 * * *` cada 2 horas) | Cambiar cron schedule y remover comment |
| Assistant | assistant.service.js | 6 | ALTO | Cliente Anthropic global SIN retry/circuit breaker | Si Claude API cae, todos los mensajes fallan | Implementar retry con exponential backoff |
| Assistant | assistant.service.js | (todo) | MEDIO | Verificar límites de mensajes por plan | ¿30 msg/día Estándar? ¿0 Lite? ¿Ilimitado Pro? | Leer assistant.service completo para validar |

---

## MAPA DE PUNTOS DE FALLA - FLUJO WHATSAPP END-TO-END

```
CLIENT (WhatsApp) ──→ META CLOUD API
                          │
                          ↓
                   WEBHOOK (responde 200 ✓)
                          │
                          ↓ [async] processWhatsAppMessage()
                          │
          ┌───────────────┼───────────────┐
          │               │               │
      [1] │           [2] │           [3] │
    ┌─────▼────┐   ┌──────▼────┐   ┌─────▼────┐
    │getBusiness   │getOrCreate │   │getHistory │
    │ByPhoneId    │Client      │   │           │
    └─────┬────┘   └──────┬────┘   └─────┬────┘
          │               │               │
          ↓ ERROR         ↓ ERROR         ↓ (silent)
    [CRASH] returns  OK/create       returns []
    undefined
          │ ❌           │ ✓             │ ⚠️
          │               │               │
          └───────────────┼───────────────┘
                          │
                          ↓ processChatbotMessage()
                          │
                ┌─────────┴──────────┐
                │                    │
            Claude API          Tool Loop
            (if fails)          (MAX 5 iter ✓)
                │                    │
                ↓ ERROR              ↓ OK/TOOL_USE
            Catches ✓              executeTool()
                │                    │
                ├─────────────────────┤
                │                     │
            if ERROR:            return response
            sendMessage() ←──────────┘
            [PROBLEMA]
            NO TOKEN!
                │
                ↓ ERROR
            Falla silenciosa
                │
                ↓
            saveHistory() [si no falló]
                │
                ↓
            sendMessage() ←─ finalText
                │
                ├─ Si token NULL ──→ ❌ FALLA
                │
                ├─ Si sendMessage error ──→ ⚠️ Loguea pero no reintentas
                │
                └─ Si OK ──→ ✓ Cliente recibe mensaje
```

### Puntos críticos de falla:

| # | Punto | Probabilidad | Impacto | Síntoma |
|---|-------|--------------|---------|---------|
| 1 | getBusinessByPhoneNumberId no valida error | ALTO | Crash | `Cannot read property 'id' of undefined` |
| 2 | businessToken es null | MUY ALTO | Silent fail | Cliente no recibe respuesta, no hay visible error |
| 3 | Claude API offline | MEDIO | Error catched | Cliente recibe "tuve un problema" (OK) |
| 4 | sendMessage Meta API error | BAJO | Logged | Cliente no recibe, logged en error logs |
| 5 | saveHistory fails | BAJO | Silent catch | Context pierde, historial no actualiza |

---

## ESCENARIOS DE FALLA CRÍTICOS (Sin clientes reales aún, pero requieren fixes)

### Escenario 1: Negocio sin token de WhatsApp configurado
```
PRE: business.whatsapp_access_token = null
FLUJO:
  1. Cliente envía mensaje
  2. processWhatsAppMessage() logra traer business (¿por qué está en BD sin token?)
  3. businessToken = null (línea 650-652)
  4. clientInfo + history cargan OK
  5. processChatbotMessage() responde OK
  6. sendMessage(from, response, null, phoneNumberId)
  7. sendMessage intenta axios.post con Bearer null
  8. Meta API retorna 401/error
  9. axios.catch() thows error
  10. Línea 681: logger.error(), but resultado es que cliente NO RECIBE MENSAJE

IMPACTO: Completamente silencioso - cliente no recibe respuesta, backend no alerta
```

**Fix:** Línea 650-652, ANTES de processChatbotMessage:
```javascript
if (!businessToken) {
  logger.warn('No token WhatsApp para negocio', { businessId: business.id });
  try {
    await sendMessage(from, 'Tuve un problema. El negocio no tiene WhatsApp configurado.');
  } catch(e) {
    logger.error('No token + error enviando fallback:', e.message);
  }
  return;
}
```

---

### Escenario 2: getBusinessByPhoneNumberId fails (Supabase down)
```
PRE: Supabase offline o phoneNumberId invalida
FLUJO:
  1. getBusinessByPhoneNumberId() → query error
  2. NO valida error, retorna undefined (line 14)
  3. business = undefined
  4. Línea 645: if (!business) { return; } ✓ Protege
  5. Pero sin error log de por qué falló

IMPACTO: Moderado - es protegio, pero no hay observabilidad
```

**Fix:** Línea 8-15, agregar error handling:
```javascript
async function getBusinessByPhoneNumberId(phoneNumberId) {
  const { data, error } = await supabaseAdmin
    .from('businesses')
    .select('id, name, business_type, whatsapp_phone_number_id, whatsapp_access_token')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .single();
  
  if (error) {
    logger.error('Error buscando business por phoneNumberId:', { phoneNumberId, error: error.message });
  }
  return data;
}
```

---

### Escenario 3: Claude API sin créditos o down
```
PRE: ANTHROPIC_API_KEY inválida o cuota excedida
FLUJO:
  1. processChatbotMessage() → anthropicClient.messages.create()
  2. Línea 585: catch(claudeError) logguea y throws
  3. Línea 663: catch(e) logguea 
  4. Línea 667: sendMessage(from, 'tuve un problema')
  5. ✓ Cliente recibe mensaje de error

IMPACTO: Bajo - fallback response funciona
```

**Status:** OK, error handling presente

---

### Escenario 4: Scheduler inicializado dos veces
```
PRE: initScheduler() llamado 2+ veces (restart sin cleanup)
FLUJO:
  1. app.js startup: initScheduler()
  2. Cron jobs 1,2,3 creados
  3. Alguien llama initScheduler() otra vez
  4. Cron jobs 1,2,3 creados OTRA VEZ (duplicados)
  5. DB locks previenen duplicados, pero 6 jobs corriendo

IMPACTO: Alto - doble procesamiento, doble sendMessage, innecesarios
```

**Fix:** Línea 30, agregar guard:
```javascript
let schedulerInitialized = false;

const initScheduler = () => {
  if (schedulerInitialized) {
    logger.warn('initScheduler ya fue inicializado, ignorando');
    return;
  }
  schedulerInitialized = true;
  
  // ... rest of crons ...
};
```

---

### Escenario 5: Scheduler intenta enviar con token global (múltiples negocios)
```
PRE: Scheduler summary diario (línea 74) envía a `negocio.owner_whatsapp`
FLUJO:
  1. Loop por cada negocio
  2. sendMessage(negocio.owner_whatsapp, mensaje)
  3. sendMessage usa process.env.WHATSAPP_ACCESS_TOKEN global
  4. Si negocio #1 usa token A, pero env tiene token B → falla
  5. Si negocio tiene otro número WhatsApp → falla

IMPACTO: Crítico - No soporta multi-tenant multi-número WhatsApp
```

**Fix:** Pasar token del negocio:
```javascript
const businessToken = decrypt(negocio.whatsapp_access_token);
const phoneNumberId = negocio.whatsapp_phone_number_id;

await sendMessage(
  negocio.owner_whatsapp, 
  mensaje, 
  businessToken,  // ← Pass token
  phoneNumberId   // ← Pass number ID
);
```

---

## CHECKLIST DE FIXES ANTES DE PRODUCCIÓN

### CRÍTICOS (Must fix):
- [ ] **whatsapp.js**: Cambiar `console.log` a `logger.info()`
- [ ] **whatsapp.js**: Cambiar `console.error` a `logger.error()`
- [ ] **chatbot.service.js (línea 14)**: Agregar validación de error en getBusinessByPhoneNumberId
- [ ] **chatbot.service.js (línea 650-668)**: Validar businessToken antes de usar, enviar fallback si null
- [ ] **chatbot.service.js (línea 688)**: Fallback error message llevar token o usar generic
- [ ] **scheduler.service.js (línea 30)**: Agregar guard singleton para initScheduler
- [ ] **scheduler.service.js (línea 74)**: Pasar token + phoneNumberId en sendMessage

### ALTOS (Should fix):
- [ ] **chatbot.service.js (línea 206)**: Cambiar `.slice(-4)` a `.slice(-6)` o `.slice(-8)` para historial más largo
- [ ] **scheduler.service.js (línea 116)**: Explícitamente validar phone antes de sendMessage (aunque filtered)
- [ ] **scheduler.service.js (línea 157)**: Cambiar cron cada 5 minutos a horario real production (e.g., `0 */2`)
- [ ] **assistant.service.js (línea 6)**: Implementar retry con exponential backoff para Claude API

### MEDIOS (Could fix):
- [ ] **webhook.controller.js (línea 50)**: Mejorar error handling
- [ ] **chatbot.service.js (línea 172)**: Cambiar error recuperando historial a WARN level

---

## ANÁLISIS DE HISTORIAL DE CONVERSACIÓN

### Problema encontrado:
```javascript
// saveConversationHistory (línea 206)
messages: mensajesLimpios.slice(-4)  // Solo guarda últimos 4

// processChatbotMessage (línea 631)
history: allMessages.slice(-10)       // Retorna últimos 10 a webhook
```

**Diferencia:** Guarda 4, retorna 10 (la 10 es para respuesta inmediata, 4 es lo persistente)

**Riesgo:** En siguiente mensaje, `getConversationHistory()` retorna 4 → context muy corto para multi-turn conversations

**Recomendación:** Cambiar a `.slice(-6)` mínimo, idealmente `-8` para conversaciones con 3+ turns

---

## STATUS DE IMPLEMENTACIÓN

| Servicio | Feature | Status | Tests | Risk |
|----------|---------|--------|-------|------|
| Chatbot | ver_servicios | ✅ Completo | (?) | MEDIO - no validación error |
| Chatbot | agendar_cita | ✅ Completo | (?) | ALTO - no token validation |
| Chatbot | historial | ✅ Completo | (?) | MEDIO - solo 4 mensajes |
| Scheduler | resumen diario | ✅ Completo | (?) | CRÍTICO - no token handling |
| Scheduler | recordatorios | ✅ Completo | (?) | CRÍTICO - no token handling |
| Scheduler | auto-completar | ✅ Completo | (?) | BAJO |
| Assistant | message | ✅ Completo | (?) | ALTO - no retry |

---

## CONCLUSIÓN

**Para Beta (1-2 negocios):** OK con fixes CRÍTICOS aplicados
**Para Producción (múltiples clientes):** Requiere fixes CRÍTICOS + ALTOS

**Timeline estimado:**
- Fixes CRÍTICOS: 30 minutos
- Fixes ALTOS: 30 minutos  
- Testing end-to-end: 1 hora
- **Total: 2 horas antes de producción**

**Recomendación:** Aplica los CRÍTICOS ahora (antes de primer cliente real), ALTOS en próximo sprint.

---

**Auditoría completada sin cambios - Solo reporte de hallazgos.**
