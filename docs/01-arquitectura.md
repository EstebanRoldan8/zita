# ZITA - Arquitectura del Proyecto

## Stack Completo

**Backend:**
- Node.js v24.15.0
- Express 4.21.0
- Supabase (PostgreSQL + Auth + RLS)
- Claude API 3.5 Sonnet (claude-sonnet-4-6)
- Winston 3.15.0 (logging)
- Multer 2.1.1 (file uploads)

**Frontend:**
- React + Vite
- TanStack React Query
- Lucide Icons
- react-datepicker

**Infraestructura:**
- Railway (backend): https://zita-production-1634.up.railway.app
- Vercel (frontend): https://zita-alpha.vercel.app
- GitHub: https://github.com/EstebanRoldan8/zita

## Reglas Críticas de Seguridad

### 1. business_id SIEMPRE desde JWT
```javascript
// ✅ CORRECTO - extraer de request autenticado
req.businessId // viene del middleware businessContext

// ❌ NUNCA del body
const { business_id } = req.body; // RIESGO: inyección
```

### 2. Supabase Clients
```javascript
// userClient: autenticado con token del usuario (consultas RLS)
const userClient = createUserClient(req.headers.authorization);

// service_role: admin sin RLS (solo en seeders/admin)
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
```

### 3. Middleware Order
```javascript
router.use(verifyToken);        // JWT válido
router.use(businessContext);    // req.businessId = negocio del user
router.use(sanitizeInput);      // XSS prevention
router.post('/', controller);
```

## Flujo del Webhook WhatsApp

```
Cliente WA → Meta Cloud API 
    ↓
POST /api/webhook/whatsapp (verificación + manejo)
    ↓
chatbot.service.js::processWhatsAppMessage()
    ↓
1. getBusinessByPhoneNumberId() → business_id
2. getOrCreateClient() → cliente en DB
3. getConversationHistory() → últimos 10 msgs
4. processChatbotMessage():
   - Claude Sonnet con 7 tools
   - Loop mientras stop_reason === 'tool_use'
   - Ejecutar tools (agendar_cita, ver_servicios, etc.)
5. saveConversationHistory() + sendMessage()
    ↓
Meta Cloud API → Cliente WA ✓
```

## Flujo del Chatbot

**7 Herramientas Disponibles:**
1. `ver_servicios` → SELECT servicios activos
2. `verificar_disponibilidad` → Slots libres fecha/hora
3. `agendar_cita` → INSERT appointment + income automático
4. `ver_mis_citas` → Citas futuras del cliente
5. `cancelar_cita` → UPDATE status cancelled
6. `ver_productos` → Productos con stock
7. `ver_mi_fidelizacion` → Visitas acumuladas vs recompensa

**System Prompt:**
- Dinámico por negocio (horarios, servicios, recompensas)
- Personalidad según business_type
- Instrucciones de extracción de datos (fecha, nombre, teléfono)
- Reglas de disponibilidad y cancelación

**Loop de Claude:**
```
while (true) {
  response = await claude.messages.create({
    messages: [...history],
    tools: [...7 herramientas]
  });
  
  if (response.stop_reason === 'tool_use') {
    results = ejecutarTools(response);
    history.push({ role: 'assistant', content: response.content });
    history.push({ role: 'user', content: results });
  } else {
    break; // final_text, max_tokens, etc.
  }
}
```

## Variables Críticas .env

```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=xxxxx
SUPABASE_SERVICE_ROLE_KEY=xxxxx

# IA
ANTHROPIC_API_KEY=sk-ant-xxxxx

# WhatsApp Meta
WHATSAPP_VERIFY_TOKEN=token_seguro
WHATSAPP_PHONE_NUMBER_ID=xxxxx
WHATSAPP_ACCESS_TOKEN=xxxxx

# Seguridad
ENCRYPT_SECRET=32-char-secret-para-AES256

# Frontend
FRONTEND_URL=https://zita-alpha.vercel.app
```
