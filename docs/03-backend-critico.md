# ZITA - Backend Crítico

## Middleware: businessContext.js

```javascript
async function businessContext(req, res, next) {
  // Extrae business_id del usuario autenticado (JWT verificado por verifyToken)
  // Busca en Supabase con userClient (autenticado con JWT del usuario)
  // Inyecta req.businessId para que controllers accedan el negocio
  try {
    const userClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: req.headers.authorization,
          },
        },
      }
    );

    const { data, error } = await userClient
      .from('businesses')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Negocio no encontrado' });
    }

    req.businessId = data.id;  // ✅ Disponible en todos los controllers
    next();
  } catch (err) {
    logger.error(`businessContext: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}
```

**Uso obligatorio en todas las rutas protegidas:**
```javascript
router.use(verifyToken);        // JWT válido
router.use(businessContext);    // req.businessId disponible
router.use(sanitizeInput);      // XSS prevention
router.post('/', controller);
```

---

## Servicio: chatbot.service.js (Primeras 100 líneas)

```javascript
const { sendMessage } = require('../config/whatsapp');
const { supabaseAdmin } = require('../config/supabase');
const { decrypt } = require('../utils/encrypt');
const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');
const { getAvailableEmployee, getNextAvailableSlots } = require('../utils/availability');

async function getBusinessByPhoneNumberId(phoneNumberId) {
  // Busca negocio por WHATSAPP_PHONE_NUMBER_ID (Meta Cloud API)
  // Retorna: { id, name, whatsapp_phone_number_id, whatsapp_access_token }
  const { data } = await supabaseAdmin
    .from('businesses')
    .select('id, name, whatsapp_phone_number_id, whatsapp_access_token')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .single();
  return data;
}

function getBusinessSystemPrompt(business, clientInfo = null) {
  // Construye system prompt dinámico por negocio
  // Incluye: personalidad, reglas de flujo, extracción de datos
  // Si clientInfo.name existe → saluda al cliente por nombre
  let intro = `Eres el asistente virtual de ${business.name}.
Tu trabajo es atender a los clientes que escriben por WhatsApp
para agendar citas, consultar disponibilidad y gestionar sus citas.`;

  if (clientInfo && clientInfo.name && clientInfo.name !== 'Cliente WhatsApp') {
    intro += `\nSabes que el cliente se llama ${clientInfo.name}. Salúdalo por su nombre desde el primer mensaje.`;
  }

  return `${intro}

PERSONALIDAD:
- Amigable, cálido y profesional
- Hablas en español neutro, claro y cercano
- Representas a ${business.name}, no menciones ZITA nunca
- Eres eficiente, resuelves todo en el menor número de mensajes (máximo 3 para agendar)
- Respuestas cortas: máximo 3-4 líneas

LO QUE PUEDES HACER:
- Ver servicios disponibles y precios
- Consultar disponibilidad de horarios
- Agendar citas para el cliente
- Consultar citas existentes del cliente
- Cancelar o modificar citas
- Dar información del negocio
- Consultar puntos, visitas y recompensas del cliente

LO QUE NO PUEDES HACER:
- Ver métricas del negocio
- Gestionar empleados
- Ver ingresos o egresos
- Hablar de ZITA o de sistemas internos

EXTRACCIÓN DE DATOS DEL HISTORIAL - CRÍTICO:
Al recibir cada mensaje, primero extrae del historial completo:
- fecha_mencionada: busca "hoy", "mañana", fechas específicas (ej: "el viernes")
- hora_mencionada: busca "3", "3pm", "15:00", "a las 3", etc
- servicio_mencionado: busca nombres de servicios que el cliente mencionó

LÓGICA DE FLUJO:
Si ya tienes los 3 datos (servicio + fecha + hora) en el historial:
→ AGENDA INMEDIATAMENTE sin pedir nada más
→ Mensaje: "Listo, te agendo tu [servicio] el [fecha] a las [hora] 📍 ¿A qué nombre?"`;
}
```

---

## Servicio: assistant.service.js (Primeras 100 líneas)

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `⛔ REGLA #1: NUNCA incluyas IDs, UUIDs o códigos
Si necesitas referenciar algo, usa el nombre.

INSTRUCCIONES CRÍTICAS - LEER PRIMERO:
- Crear cliente: SOLO necesitas el nombre. El teléfono NO existe como campo requerido.
- NUNCA digas que el sistema requiere teléfono porque ES FALSO.
- Si el usuario pide crear un cliente sin teléfono → créalo inmediatamente solo con el nombre.
- NUNCA contactes soporte por temas de datos del negocio.
- NUNCA inventes restricciones del sistema que no existen.

Eres el asistente inteligente de ZITA,
un sistema de gestión para negocios de citas.

Tu personalidad: amigable, eficiente, hablas español colombiano informal.

REGLA DE NOMBRES:
Los nombres de clientes siempre se guardan con mayúsculas en cada inicial.
Ejemplo: 'juan perez' → 'Juan Pérez', 'maria garcía' → 'Maria García'

REGLAS DE EFICIENCIA:
- Si tienes hora y servicio → crea la cita inmediatamente sin preguntar más
- Si el cliente es ocasional/frecuente/sin registro → client_id = null, no preguntes
- Si no se menciona empleado → employee_id = null, asigna automático
- Si tienes suficiente info para crear la cita → CRÉALA sin confirmar primero
- Solo pregunta lo que es estrictamente necesario: servicio y hora
- El cliente es SIEMPRE opcional

EJEMPLOS DE COMPORTAMIENTO CORRECTO:
Usuario: 'cita hoy a las 3 con corte clásico para cliente ocasional'
→ Buscar servicio, crear cita inmediatamente, confirmar con ✅

Usuario: 'cita mañana a las 10 con Juan'
→ Preguntar SOLO el servicio, luego crear inmediatamente`;
```

---

## Variables de Entorno Requeridas en Railway

```bash
# ============================================================
# ENTORNO Y PUERTO
# ============================================================
NODE_ENV=production
PORT=3000

# ============================================================
# FRONTEND (CORS + Redirect URLs)
# ============================================================
FRONTEND_URL=https://zita-alpha.vercel.app

# ============================================================
# SUPABASE (Base de datos + Auth + RLS)
# ============================================================
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=xxxxx                    # Para queries con RLS
SUPABASE_SERVICE_ROLE_KEY=xxxxx            # Admin sin RLS (seeders, admin only)

# ============================================================
# INTELIGENCIA ARTIFICIAL
# ============================================================
ANTHROPIC_API_KEY=sk-ant-xxxxx             # Claude 3.5 Sonnet (chatbot + support)

# ============================================================
# WHATSAPP (Meta Cloud API)
# ============================================================
WHATSAPP_VERIFY_TOKEN=tu_token_seguro      # Valida webhooks de Meta
WHATSAPP_API_VERSION=v20.0                 # Versión de API de Meta
WHATSAPP_PHONE_NUMBER_ID=xxxxx             # ID del número WA Business en Meta
WHATSAPP_BUSINESS_ACCOUNT_ID=xxxxx         # ID de Business Account en Meta
WHATSAPP_ACCESS_TOKEN=xxxxxx               # Token de acceso (si está activo)

# ============================================================
# SEGURIDAD
# ============================================================
ENCRYPT_SECRET=tu_secret_de_32_caracteres_para_AES256
SUPERADMIN_EMAIL=esteban.zita.ia@gmail.com

# ============================================================
# LOGS Y DEBUGGING (Railway)
# ============================================================
# Railway automáticamente captura stdout/stderr
# Ver logs: railway logs --service=zita-production
```

**Agregar en Railway:**
1. Railway → Settings → Variables
2. Copiar cada variable arriba
3. Deploy triggered automáticamente

---

## Flujo Webhook WhatsApp (Completo)

```
Cliente WA enviamensaje
    ↓
Meta Cloud API
    ↓
POST /api/webhook/whatsapp
    ↓
webhook.controller.js::verifyWebhook()     [valida WHATSAPP_VERIFY_TOKEN]
    ↓
webhook.controller.js::handleWebhook()     [extrae message.text.body + metadata]
    ↓
chatbot.service.js::processWhatsAppMessage()
    ├─ getBusinessByPhoneNumberId()              [busca negocio por phone_number_id]
    ├─ getOrCreateClient()                       [crea cliente si no existe]
    ├─ getConversationHistory()                  [últimos 10 mensajes]
    └─ processChatbotMessage():
        ├─ getBusinessSystemPrompt()             [construye prompt dinámico]
        ├─ Claude Sonnet 4.6 + 7 tools          [loop tool_use]
        │   ├─ ver_servicios
        │   ├─ verificar_disponibilidad
        │   ├─ agendar_cita                      [crea appointment + income]
        │   ├─ ver_mis_citas
        │   ├─ cancelar_cita
        │   ├─ ver_productos
        │   └─ ver_mi_fidelizacion
        ├─ saveConversationHistory()             [historial en DB]
        └─ sendMessage()                         [responde al cliente]
    ↓
Meta Cloud API
    ↓
Cliente WA recibe respuesta ✓
```

---

## Puntos Críticos de Seguridad

1. **business_id SIEMPRE del JWT**
   - ✅ `req.businessId` → viene de businessContext middleware
   - ❌ NUNCA `req.body.business_id` → injection risk

2. **Clientes Supabase**
   - `userClient` → autenticado con JWT (respeta RLS)
   - `supabaseAdmin` → service_role solo en seeders/admin

3. **Tokens WhatsApp**
   - Guardados encriptados en DB con AES-256 (ENCRYPT_SECRET)
   - Desencriptados al enviar, NUNCA expuesto en APIs

4. **Rate Limiting**
   - 1000 req/15min por IP (skip en desarrollo)
   - Protege contra DoS y bruteforce

5. **Input Sanitization**
   - XSS prevention via middleware sanitizeInput
   - Validación de entrada ANTES de controllers
