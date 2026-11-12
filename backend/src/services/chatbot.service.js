const { sendMessage } = require('../config/whatsapp');
const Anthropic = require('@anthropic-ai/sdk');
const { isPlanExpired } = require('../utils/planStatus');
const {
  supabaseAdmin, logger, decrypt, deleteCitaIncome, logSystemAlert, getPlan, maskPhone, notify, ownerSender,
} = require('./chatbot/shared');
const { buildBotRequest } = require('./chatbot/prompt');
const { createToolExecutor } = require('./chatbot/tools');
const { convKey, newRequestId } = require('../utils/aiUsage');
const { loadConversation, saveMessages, pendingReminder } = require('./conversationStore');
const { callClaudeWithRetry } = require('../utils/anthropicRetry');

// Modelo y límites del bot. max_tokens es solo un tope (no cambia el costo): 600 alcanza para una lista de servicios.
const BOT_MODEL = 'claude-haiku-4-5-20251001';
const BOT_MAX_TOKENS = 600;
const BOT_MAX_TOOL_ITERATIONS = 5;  // hasta 6 llamadas por mensaje; lo normal es 1-2
const HISTORY_MAX = 12;             // mensajes de historial que se mandan como máximo…
const HISTORY_KEEP = 6;             // …y al pasarse se recorta a estos (en bloque, para no romper el caché)

// Respuestas exactas a un recordatorio (solo se usan si lo último que mandó el bot fue el recordatorio)
const CONFIRM_WORDS = new Set(['si', 'sí', 'confirmo', 'confirmado', 'ahí estaré', 'ahi estare', 'voy', 'allá voy', 'alla voy', 'por supuesto', 'si voy', 'sí voy', 'confirmar']);
const CANCEL_WORDS = new Set(['no', 'no puedo', 'cancela', 'cancelar', 'no voy', 'no puedo ir', 'no iré', 'no ire', 'cancela mi cita', 'no asisto']);

// Un solo cliente de Anthropic por proceso. maxRetries: 0 porque los reintentos los hace callClaudeWithRetry
// (si no, el SDK reintenta 2 veces dentro de cada intento del wrapper: hasta 9 llamadas).
let anthropicClientSingleton = null;
function getAnthropicClient() {
  if (!anthropicClientSingleton) {
    anthropicClientSingleton = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30 * 1000, maxRetries: 0 });
  }
  return anthropicClientSingleton;
}
// Solo para tests: inyecta un cliente falso
function __setAnthropicClientForTests(c) { anthropicClientSingleton = c; }

// Cache de horarios por negocio (5 minutos)
const businessHoursCache = new Map();
const HOURS_CACHE_TTL = 1 * 60 * 1000;

function getCachedHours(businessId) {
  const cached = businessHoursCache.get(businessId);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > HOURS_CACHE_TTL) {
    businessHoursCache.delete(businessId);
    return null;
  }
  return cached.hours;
}

function setCachedHours(businessId, hours) {
  businessHoursCache.set(businessId, { hours, timestamp: Date.now() });
  if (businessHoursCache.size > 100) {
    const oldest = [...businessHoursCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) businessHoursCache.delete(oldest[0]);
  }
}

async function transcribeAudio(audioUrl, accessToken) {
  try {
    const audioResponse = await fetch(audioUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20000)
    });

    if (!audioResponse.ok) {
      logger.error('AUDIO_DOWNLOAD_FAIL_' + audioResponse.status);
      return null;
    }
    // Notas de voz de WhatsApp: máx. 16 MB. Más que eso no se descarga ni se transcribe (costo y memoria)
    const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
    if (Number(audioResponse.headers.get('content-length') || 0) > MAX_AUDIO_BYTES) {
      logger.warn('AUDIO_DEMASIADO_GRANDE');
      return null;
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    logger.info('AUDIO_OK_BYTES_' + audioBuffer.length + '_GROQKEY_' + (process.env.GROQ_API_KEY ? 'SET' : 'MISSING'));

    const FormData = require('form-data');
    const axios = require('axios');

    const form = new FormData();
    form.append('file', audioBuffer, {
      filename: 'audio.ogg',
      contentType: 'audio/ogg'
    });
    form.append('model', 'whisper-large-v3');
    form.append('language', 'es');
    form.append('response_format', 'text');

    const groqResponse = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          ...form.getHeaders()
        },
        timeout: 20000,
        maxBodyLength: 25 * 1024 * 1024, // límite de Groq
        maxContentLength: 1024 * 1024
      }
    );

    const transcribedText = groqResponse.data;
    logger.info('TRANSCRIPCION_OK', { length: String(transcribedText).length }); // nunca el texto (PII)
    return typeof transcribedText === 'string' ? transcribedText.trim() : null;

  } catch (err) {
    const errMsg = err.response?.data
      ? JSON.stringify(err.response.data).slice(0, 200)
      : err.message;
    logger.error('GROQ_FAIL_' + errMsg.replace(/\s+/g, '_'));
    return null;
  }
}

// El prompt y las tools del bot viven en ./chatbot/prompt.js (organizados para el caché de prompts)

async function getBusinessByPhoneNumberId(phoneNumberId) {
  const { data, error } = await supabaseAdmin
    .from('businesses')
    .select('id, name, business_type, plan, whatsapp_phone_number_id, whatsapp_access_token, status, trial_ends_at, plan_expires_at, phone, owner_email')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .single();
  if (error) {
    logger.error('Error buscando business por phoneNumberId:', { phoneNumberId, error: error.message });
  }
  return data;
}

// Notifica al dueño del negocio que su plan/trial expiró y un cliente le está
// escribiendo. Máximo una notificación cada 24h (por WhatsApp + email).
// La columna last_trial_expiry_notification se consulta aparte (no en
// getBusinessByPhoneNumberId) para que, si la migración 039 todavía no se
// aplicó en la base de datos, el bot no se caiga por completo — en el peor
// caso, solo se pierde el throttle de 24h y se notifica más seguido.
async function notifyOwnerPlanExpired(business) {
  try {
    const ahora = new Date();
    let ultimaNotif = null;
    try {
      const { data: notifData } = await supabaseAdmin
        .from('businesses')
        .select('last_trial_expiry_notification')
        .eq('id', business.id)
        .single();
      if (notifData?.last_trial_expiry_notification) {
        ultimaNotif = new Date(notifData.last_trial_expiry_notification);
      }
    } catch (colErr) {
      logger.error('Columna last_trial_expiry_notification no disponible (¿falta migración 039?): ' + colErr.message);
    }
    const yaNotificado24h = ultimaNotif && (ahora - ultimaNotif) < 24 * 60 * 60 * 1000;
    if (yaNotificado24h) return;

    const mensajeDueno = '⚠️ Tu plan ZITA expiró y un cliente te está escribiendo. Renueva para seguir atendiendo por WhatsApp.';

    if (business.phone) {
      // Aviso al dueño: casi siempre fuera de la ventana de 24 h → plantilla plan_vencido (si están activas)
      const { token, phoneNumberId } = ownerSender(business);
      await notify({ to: business.phone, text: mensajeDueno, template: { key: 'plan_vencido', body: [business.name] }, token, phoneNumberId, businessId: business.id });
    }

    if (business.owner_email) {
      try {
        const resend = require('../config/resend');
        await resend.emails.send({
          from: 'ZITA <onboarding@resend.dev>',
          to: business.owner_email,
          subject: 'Tu plan ZITA expiró — un cliente te está escribiendo',
          html: `<h2>Tu plan ZITA expiró</h2><p>Un cliente le escribió a <b>${business.name}</b> por WhatsApp, pero no se le pudo responder porque el plan/trial está vencido.</p><p>Renueva tu plan para seguir atendiendo a tus clientes por WhatsApp.</p>`,
        });
      } catch (emailErr) {
        logger.error('Error enviando email de trial expirado: ' + emailErr.message);
      }
    }

    await supabaseAdmin
      .from('businesses')
      .update({ last_trial_expiry_notification: ahora.toISOString() })
      .eq('id', business.id);
  } catch (err) {
    logger.error('Error notificando dueño de plan expirado: ' + err.message);
  }
}


async function getOrCreateClient(businessId, phone, name = null) {
  const { data: existingArr } = await supabaseAdmin
    .from('clients')
    .select('id, name, archived')
    .eq('business_id', businessId)
    .eq('phone', phone)
    .limit(1);

  const existing = existingArr?.[0] || null;

  if (existing) {
    // Si el cliente está archivado, reactivarlo (volvió a escribir)
    if (existing.archived) {
      const { data: reactivated } = await supabaseAdmin
        .from('clients')
        .update({ archived: false })
        .eq('id', existing.id)
        .select('id, name')
        .single();
      return reactivated || existing;
    }
    return existing;
  }

  const { data: newClient, error: newClientError } = await supabaseAdmin
    .from('clients')
    .insert({
      business_id: businessId,
      phone: phone,
      name: name || 'Cliente WhatsApp'
    })
    .select('id, name')
    .single();

  // Caso normal: cliente creado exitosamente
  if (!newClientError) {
    return newClient || null;
  }

  // Race condition: otro proceso creó el cliente casi simultáneamente (UNIQUE violation)
  if (newClientError.code === '23505') {
    logger.info('[GET_OR_CREATE_CLIENT_UNIQUE_COLLISION]', { businessId, phone: maskPhone(phone) });
    const { data: recoveredArr } = await supabaseAdmin
      .from('clients')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('phone', phone)
      .limit(1);
    return recoveredArr?.[0] || null;
  }

  // Error genuino (no UNIQUE violation)
  logger.warn('[GET_OR_CREATE_CLIENT_INSERT_FAILED]', { businessId, phone, error: newClientError?.message });
  return null;
}

// Guarda solo texto (sin bloques de tools ni delimitadores), conservando timestamps y la marca de recordatorio
async function saveConversationHistory(businessId, clientPhone, messages) {
  await saveMessages(businessId, clientPhone, messages);
}

async function incrementDailyMessageCount(businessId, clientPhone) {
  const hoyColombia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  // Intenta INSERT; si existe, actualiza con +1
  const { error } = await supabaseAdmin.rpc('increment_message_count', {
    p_business_id: businessId,
    p_client_phone: clientPhone,
    p_date: hoyColombia
  });

  if (error) {
    logger.error('Error incrementando contador diario:', { businessId, phone: maskPhone(clientPhone), error: error.message });
  }
}

async function processChatbotMessage(businessId, clientPhone, messageText, history, business, clientInfo = null) {
  logger.info('Procesando mensaje del chatbot', { businessId, phone: maskPhone(clientPhone), messageLength: messageText.length, historyLength: history.length });

  let businessHours = getCachedHours(businessId);
  if (!businessHours) {
    const { data: hoursData } = await supabaseAdmin
      .from('business_hours')
      .select('day_of_week, open_time, close_time, is_open')
      .eq('business_id', businessId)
      .order('day_of_week');
    businessHours = hoursData;
    if (hoursData) setCachedHours(businessId, hoursData);
  }

  let services = null;
  const { data: servicesData } = await supabaseAdmin
    .from('services')
    .select('name, price, duration_minutes')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('name');
  services = servicesData;

  let citasActivas = [];
  try {
    // El cliente ya se cargó en processWhatsAppMessage (getOrCreateClient): se reutiliza su id
    const clienteParaCitas = clientInfo?.id ? { id: clientInfo.id } : (await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('business_id', businessId)
      .eq('phone', clientPhone)
      .maybeSingle()).data;

    if (clienteParaCitas) {
      const { data: citasData, error: citasError } = await supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, status, services(name), employees(name)')
        .eq('business_id', businessId)
        .eq('client_id', clienteParaCitas.id)
        .in('status', ['pending', 'confirmed'])
        .order('scheduled_at', { ascending: true })
        .limit(10);

      if (citasError) {
        logger.error('Error consultando citas activas del cliente:', citasError.message);
      } else {
        citasActivas = citasData || [];
      }
    }
  } catch (err) {
    logger.error('Error inesperado consultando citas activas del cliente:', err.message);
    citasActivas = [];
  }

  const anthropicClient = getAnthropicClient();
  const botRequest = buildBotRequest({ business, clientInfo, businessHours: businessHours || [], services: services || [], citasActivas });

  // Tools del bot: una por archivo en ./chatbot/tools (ver index.js)
  const executeChatbotTool = createToolExecutor({ businessId, clientPhone, business, clientInfo });

  // Historial: solo texto, empezando por un mensaje del cliente. Se recorta "por bloques" (12 → últimos 6) y no de a
  // un mensaje: así el inicio de la conversación no cambia en cada turno y el prefijo de mensajes se lee de caché.
  let cleanHistory = (history || []).filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  if (cleanHistory.length > HISTORY_MAX) cleanHistory = cleanHistory.slice(-HISTORY_KEEP);
  while (cleanHistory.length > 0 && cleanHistory[0].role !== 'user') cleanHistory.shift();

  // Límite de longitud contra amplificación de costo (max 2000 chars)
  const maxMessageLength = 2000;
  let processedMessage = String(messageText || '');
  if (processedMessage.length > maxMessageLength) {
    logger.warn(`Mensaje truncado de ${processedMessage.length} a ${maxMessageLength} chars`);
    processedMessage = processedMessage.substring(0, maxMessageLength) + '...';
  }
  // Sin las etiquetas del delimitador dentro del texto: el cliente no puede "cerrar" el bloque e inyectar instrucciones
  processedMessage = processedMessage.replace(/<\/?mensaje_usuario>/gi, '');

  // Cada mensaje del cliente se envuelve igual en el historial y en el turno actual (mismos bytes → caché)
  const wrapUser = (t) => `<mensaje_usuario>\n${String(t).replace(/<\/?mensaje_usuario>/gi, '')}\n</mensaje_usuario>`;
  const messages = [
    ...cleanHistory.map((m) => (m.role === 'user'
      ? { role: 'user', content: [{ type: 'text', text: wrapUser(m.content) }] }
      : { role: 'assistant', content: m.content })),
    // Texto del cliente (breakpoint 3) + contexto volátil al final (hora, cliente, citas activas)
    { role: 'user', content: [{ type: 'text', text: wrapUser(processedMessage) }, { type: 'text', text: botRequest.volatileText }] },
  ];
  const userIdx = messages.length - 1;

  // Breakpoints de caché en los mensajes (máx. 4 en total; 2 ya van en el system):
  //  - el texto del cliente de este turno → el siguiente turno lee de caché todo lo anterior
  //  - el último tool_result del loop → cada vuelta del loop lee la anterior
  function withCacheBreakpoints(msgs) {
    const out = msgs.slice();
    const mark = (i, blockIdx) => {
      const content = out[i].content.map((b, j) => (j === blockIdx ? { ...b, cache_control: { type: 'ephemeral' } } : b));
      out[i] = { ...out[i], content };
    };
    mark(userIdx, 0);
    const last = out.length - 1;
    if (last > userIdx && out[last].role === 'user' && Array.isArray(out[last].content)) mark(last, out[last].content.length - 1);
    return out;
  }

  const requestId = newRequestId();
  const conversationKey = convKey(businessId, clientPhone);
  const callClaude = (msgs, iteration) => callClaudeWithRetry(anthropicClient, {
    model: BOT_MODEL,
    max_tokens: BOT_MAX_TOKENS,
    system: botRequest.system,
    tools: botRequest.tools,
    messages: withCacheBreakpoints(msgs),
  }, 2, { flow: 'whatsapp_bot', businessId, conversationKey, requestId, iteration });

  let response;
  try {
    response = await callClaude(messages, 0);
  } catch (claudeError) {
    logger.error('Error de Claude:', claudeError.message);
    throw claudeError;
  }

  try {
    const allMessages = [...messages];
    let iterations = 0;

    while (response.stop_reason === 'tool_use' && iterations < BOT_MAX_TOOL_ITERATIONS) {
      iterations++;
      const assistantContent = response.content;
      allMessages.push({ role: 'assistant', content: assistantContent });

      const toolResults = [];
      let shouldBreak = false;
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          const result = await executeChatbotTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
          // Si se ejecutó escalar_a_humano exitosamente, detener el loop
          if (block.name === 'escalar_a_humano' && result.success) {
            shouldBreak = true;
          }
        }
      }

      // Si se escaló a humano, retornar el mensaje de confirmación sin seguir procesando
      if (shouldBreak) {
        return { response: 'Listo, le avisé al dueño. Te contactarán pronto 😊', userText: processedMessage };
      }

      allMessages.push({ role: 'user', content: toolResults });
      response = await callClaude(allMessages, iterations);
    }

    if (response.stop_reason === 'tool_use') {
      logger.warn('[BOT_MAX_ITERACIONES]', { businessId, iterations });
    }

    const finalText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Limpiar tags internos espurios (ej: </final_message>, </fin>, etc) que el modelo puede generar ocasionalmente
    const cleanText = finalText.replace(/<\/?[a-z_]+>/gi, '').trim();

    return { response: cleanText, userText: processedMessage };
  } catch (error) {
    logger.error('Error procesando respuesta:', error.message);
    throw error;
  }
}

// La deduplicación por message_id se hace al recibir el webhook (conversationStore.claimMessageId),
// antes de encolar: aquí cada mensaje llega una sola vez.
async function processWhatsAppMessage({ from, phoneNumberId, messageText, messageId }) {
  const receivedAt = new Date().toISOString();
  logger.info('Mensaje WhatsApp recibido', { to: maskPhone(from), messageId });
  let business = null;
  let businessToken = null;

  try {
    business = await getBusinessByPhoneNumberId(phoneNumberId);

    if (!business) {
      logger.warn('Negocio no encontrado para el phone_number_id');
      return;
    }

    businessToken = business.whatsapp_access_token
      ? decrypt(business.whatsapp_access_token)
      : null;

    if (isPlanExpired(business)) {
      logger.warn('Negocio con plan/trial expirado, bot bloqueado', { businessId: business.id });
      await sendMessage(from, 'Este negocio no está disponible en este momento, intenta más tarde 🙏', businessToken, business.whatsapp_phone_number_id);
      await notifyOwnerPlanExpired(business);
      return;
    }

    // Una sola lectura de la fila de conversación: pausa + historial
    const conversation = await loadConversation(business.id, from);
    const history = conversation?.messages || [];

    if (conversation?.bot_paused_until && new Date(conversation.bot_paused_until) > new Date()) {
      // Pausado (escalado a humano): no responde, pero el mensaje queda en el historial para el dueño
      // y para que el bot tenga el contexto cuando se reactive. No se reprocesa después.
      await saveConversationHistory(business.id, from, [...history, { role: 'user', content: messageText, timestamp: receivedAt }]);
      logger.info('Bot pausado para el cliente; mensaje guardado sin responder', { businessId: business.id, to: maskPhone(from) });
      return;
    }

    const client_info = await getOrCreateClient(business.id, from);

    logger.info('Cliente e historial cargados', { clientId: client_info?.id, historyLength: history.length });
    // Verificar límites diarios: 50 msgs/cliente/día, 300 msgs/negocio/día
    const hoyColombia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

    const { data: clientDayStats } = await supabaseAdmin
      .from('bot_daily_message_counts')
      .select('message_count')
      .eq('business_id', business.id)
      .eq('client_phone', from)
      .eq('date', hoyColombia)
      .maybeSingle();

    // Normalizado para los atajos: sin signos ('¡Sí!' → 'sí', 'no.' → 'no')
    const msgLower = messageText.toLowerCase().replace(/[¡!¿?.,;]+/g, ' ').replace(/\s+/g, ' ').trim();

    // Fast-path: saludos/despedidas sin llamar a Claude (si historial vacío o >2h desde último mensaje)
    const esSaludo = ['hola', 'buenas', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches', 'hey', 'que tal', 'qué tal'].includes(msgLower);
    const esDespedida = ['chao', 'adios', 'adiós', 'hasta luego', 'nos vemos', 'bye'].includes(msgLower);

    if (esSaludo || esDespedida) {
      // Validar condición: historial vacío O último mensaje de usuario fue hace >2h
      let debeActivarFastPath = history.length === 0;

      if (!debeActivarFastPath && history.length > 0) {
        const ultimoUserMsg = [...history].reverse().find(m => m.role === 'user');
        if (ultimoUserMsg?.timestamp) {
          const ahora = new Date().getTime();
          const ultimoMsgTiempo = new Date(ultimoUserMsg.timestamp).getTime();
          const dorasEnMs = 2 * 60 * 60 * 1000;
          debeActivarFastPath = (ahora - ultimoMsgTiempo) > dorasEnMs;
        }
      }

      if (debeActivarFastPath) {
        if (esSaludo) {
          const respuesta = client_info?.name && client_info.name !== 'Cliente WhatsApp'
            ? `Hola ${client_info.name} 👋 ¿En qué te ayudo hoy?`
            : `¡Hola! Bienvenido a ${business.name} 👋 ¿En qué te puedo ayudar? Puedo agendarte una cita o contarte sobre nuestros servicios 😊`;

          await sendMessage(from, respuesta, businessToken, business.whatsapp_phone_number_id);
          await saveConversationHistory(business.id, from, [
            ...history,
            { role: 'user', content: messageText, timestamp: receivedAt },
            { role: 'assistant', content: respuesta }
          ]);
          await incrementDailyMessageCount(business.id, from);
          return;
        } else if (esDespedida) {
          const respuesta = `¡Hasta luego! 👋 Que tengas un excelente día 😊`;
          await sendMessage(from, respuesta, businessToken, business.whatsapp_phone_number_id);
          await saveConversationHistory(business.id, from, [
            ...history,
            { role: 'user', content: messageText, timestamp: receivedAt },
            { role: 'assistant', content: respuesta }
          ]);
          await incrementDailyMessageCount(business.id, from);
          return;
        }
      }
    }

    // DESPUÉS del fast-path de saludos/despedidas: verificar límites diarios (saludos no cuentan)
    const clientMsgCountToday = clientDayStats?.message_count || 0;

    if (clientMsgCountToday >= 50) {
      const respuestaLimite = 'Has alcanzado el límite de mensajes por hoy. Puedes escribir de nuevo mañana 😊';
      await sendMessage(from, respuestaLimite, businessToken, business.whatsapp_phone_number_id);
      return;
    }

    const { data: businessDayStats, count: businessMsgCountToday } = await supabaseAdmin
      .from('bot_daily_message_counts')
      .select('message_count', { count: 'exact' })
      .eq('business_id', business.id)
      .eq('date', hoyColombia);

    const totalBusinessMsgToday = businessDayStats?.reduce((sum, s) => sum + (s.message_count || 0), 0) || 0;

    // El límite sale del plan real del negocio (antes el SELECT no traía 'plan' y todos quedaban en Lite = 40)
    const planConfig = getPlan(business.plan);
    const botMessagesLimit = planConfig.bot_messages_day;

    // Dedupe de alerta: solo una por negocio por día
    const { data: existingAlert } = await supabaseAdmin
      .from('system_alerts')
      .select('id')
      .eq('tipo', 'bot_daily_limit_reached')
      .eq('business_id', business.id)
      .gte('created_at', hoyColombia + 'T00:00:00-05:00')
      .limit(1)
      .maybeSingle();

    if (totalBusinessMsgToday >= botMessagesLimit) {
      const respuestaLimiteBusiness = 'El negocio ha alcanzado su límite de mensajes por hoy. Por favor, contacta directamente al negocio mañana 😊';
      await sendMessage(from, respuestaLimiteBusiness, businessToken, business.whatsapp_phone_number_id);

      // Solo registra alerta si no existe una ya hoy
      if (!existingAlert) {
        await logSystemAlert('bot_daily_limit_reached',
          `Bot alcanzó límite diario (${botMessagesLimit} msgs) para negocio ${business.name}`,
          business.id,
          { totalMessages: totalBusinessMsgToday, limit: botMessagesLimit });
      }
      return;
    }

    // Atajo de confirmación/cancelación: SOLO si lo último en la conversación fue el recordatorio de una cita
    // (guardado por el scheduler con kind:'reminder' y su appointment_id). Un "sí"/"no" a cualquier otra pregunta
    // del bot va a Claude, que tiene el contexto. Y se actúa sobre ESA cita, no sobre "la más próxima".
    const recordatorio = pendingReminder(history);
    const esConfirmacion = CONFIRM_WORDS.has(msgLower);
    const esCancelacion = CANCEL_WORDS.has(msgLower);

    if (recordatorio && (esConfirmacion || esCancelacion)) {
      const { data: clienteCheck } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('business_id', business.id)
        .eq('phone', from)
        .limit(1);
      const clienteId = clienteCheck?.[0]?.id;

      const { data: citaRecordada } = clienteId ? await supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, status, services(name)')
        .eq('id', recordatorio.appointmentId)
        .eq('business_id', business.id)
        .eq('client_id', clienteId)
        .in('status', ['pending', 'confirmed'])
        .maybeSingle() : { data: null };

      if (citaRecordada && new Date(citaRecordada.scheduled_at).getTime() > Date.now()) {
        const horaFormateada = new Date(citaRecordada.scheduled_at).toLocaleString('es-CO', {
          timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: true
        });
        let respuesta;
        if (esConfirmacion) {
          const { data: confirmedRows, error: confirmError } = await supabaseAdmin
            .from('appointments')
            .update({ status: 'confirmed' })
            .eq('id', citaRecordada.id)
            .eq('business_id', business.id)
            .in('status', ['pending', 'confirmed'])
            .select('id');
          if (confirmError || !confirmedRows?.length) {
            logger.error('[FASTPATH_CONFIRMAR_CITA_FAILED]', { appointmentId: citaRecordada.id, businessId: business.id, error: confirmError?.message });
            respuesta = 'Uy, no pude confirmar tu cita en este momento. Por favor intenta de nuevo en unos minutos o escríbenos.';
          } else {
            respuesta = `✅ ¡Perfecto! Tu cita de ${citaRecordada.services?.name || 'tu servicio'} el ${horaFormateada} está confirmada. ¡Te esperamos! 😊`;
          }
        } else {
          const cancelResult = await deleteCitaIncome(citaRecordada.id, business.id);
          if (!cancelResult.success) {
            logger.error('[FASTPATH_CANCELAR_CITA_FAILED]', { appointmentId: citaRecordada.id, businessId: business.id, error: cancelResult.error });
            respuesta = 'Uy, no pude cancelar tu cita en este momento. Por favor intenta de nuevo en unos minutos o escríbenos.';
          } else {
            respuesta = `Entendido, cancelé tu cita de ${citaRecordada.services?.name || 'tu servicio'} del ${horaFormateada} 😊 Cuando quieras reagendar aquí estoy.`;
          }
        }
        await sendMessage(from, respuesta, businessToken, business.whatsapp_phone_number_id);
        await saveConversationHistory(business.id, from, [
          ...history,
          { role: 'user', content: messageText, timestamp: receivedAt },
          { role: 'assistant', content: respuesta }
        ]);
        await incrementDailyMessageCount(business.id, from);
        return;
      }
      // La cita del recordatorio ya no está activa: sigue el flujo normal con Claude
    }

    let result;
    try {
      result = await processChatbotMessage(business.id, from, messageText, history, business, client_info);
      logger.info('Mensaje procesado exitosamente');
    } catch(e) {
      logger.error('Error procesando mensaje:', e.message);
      await sendMessage(from, 'Estoy teniendo problemas técnicos en este momento 🙏 Escríbeme en unos minutos e intento de nuevo.', businessToken, business.whatsapp_phone_number_id);
      return;
    }

    // WhatsApp rechaza mensajes vacíos: si el modelo no dejó texto (p. ej. agotó las iteraciones), respaldo
    if (!result.response || !String(result.response).trim()) {
      logger.error('[BOT_RESPUESTA_VACIA]', { businessId: business.id });
      await logSystemAlert('bot_empty_response', 'El bot terminó sin texto para responder', business.id, { messageType: 'bot_response' });
      result.response = 'Perdona, no te entendí bien 🙏 ¿Me lo puedes decir de otra forma?';
    }

    try {
      // Solo texto: el mensaje del cliente (con la hora en que llegó) y la respuesta final del bot
      await saveConversationHistory(business.id, from, [
        ...history,
        { role: 'user', content: result.userText || messageText, timestamp: receivedAt },
        { role: 'assistant', content: result.response }
      ]);
      await incrementDailyMessageCount(business.id, from);
    } catch(e) {
      logger.error('Error guardando historial:', e.message);
    }

    try {
      const sendResult = await sendMessage(from, result.response, businessToken, business.whatsapp_phone_number_id);
      if (sendResult && sendResult.success === false) {
        logger.error('[WHATSAPP_SEND_FAILED] Envío de respuesta fallido', { to: maskPhone(from), businessId: business.id, error: sendResult.error, status: sendResult.status });
        await logSystemAlert('whatsapp_send_failed', 'Fallo envío de respuesta del bot', business.id,
          { to: maskPhone(from), error: sendResult.error, messageType: 'bot_response' });
      } else {
        logger.info('Mensaje enviado al cliente');
      }
    } catch(e) {
      logger.error('Error enviando mensaje:', e.message);
      await logSystemAlert('whatsapp_send_failed', 'Excepción en envío de respuesta del bot', business.id,
        { to: maskPhone(from), error: e.message, messageType: 'bot_response' });
    }

  } catch (error) {
    logger.error('Error general en processWhatsAppMessage:', error.message);
    // El respaldo sale SIEMPRE desde el número del negocio (con su token). Si no se pudo resolver el negocio,
    // no se manda nada: antes salía desde el número global de ZITA.
    if (!business?.whatsapp_phone_number_id || !businessToken) return;
    try {
      const sendResult = await sendMessage(from, 'Tuve un problema técnico 😕 Intenta escribirme de nuevo en un momento.', businessToken, business.whatsapp_phone_number_id);
      if (sendResult && sendResult.success === false) {
        await logSystemAlert('whatsapp_send_failed', 'Fallo envío de mensaje de respaldo del bot', business.id,
          { to: maskPhone(from), error: sendResult.error, messageType: 'fallback' });
      }
    } catch (e) {
      await logSystemAlert('whatsapp_send_failed', 'Excepción en envío de mensaje de respaldo del bot', business.id,
        { to: maskPhone(from), error: e.message, messageType: 'fallback' });
    }
  }
}

module.exports = { processWhatsAppMessage, processChatbotMessage, buildBotRequest, getBusinessByPhoneNumberId, transcribeAudio, __setAnthropicClientForTests };
