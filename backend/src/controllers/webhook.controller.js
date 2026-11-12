const logger = require('../utils/logger');
const { maskPhone } = require('../utils/phone');
const { processWhatsAppMessage, getBusinessByPhoneNumberId, transcribeAudio } = require('../services/chatbot.service');
const { claimMessageId } = require('../services/conversationStore');
const { logSystemAlert } = require('../utils/systemAlerts');

// Serialización por cliente (en memoria). Si llegan varios mensajes mientras se procesa uno, se juntan en un lote.
// Nota: vive en memoria del proceso; con más de una réplica en Railway dos mensajes del mismo cliente podrían
// procesarse en paralelo (la deduplicación sí es global, en la BD).
const processingClients = new Map(); // clientKey -> true
const pendingMessages = new Map();   // clientKey -> [{ from, phoneNumberId, messageText, messageId }]

// Mensajes más viejos que esto no se responden (p. ej. reintentos de Meta tras una caída): responder fuera de
// contexto es peor que no responder. Se guardan en el historial para que el dueño los vea.
const MAX_MESSAGE_AGE_MS = Number(process.env.BOT_MAX_MESSAGE_AGE_MIN || 30) * 60 * 1000;

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('Webhook verificado correctamente');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

// Todos los mensajes del POST (Meta puede agrupar varios entry/changes/messages)
function extractMessages(body) {
  const out = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      const phoneNumberId = value.metadata?.phone_number_id;
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        if (phoneNumberId && message?.from && message?.id) out.push({ phoneNumberId, message });
      }
      // Estados de entrega fallidos (p. ej. 131047 = fuera de la ventana de 24 h): solo se registran, sin PII
      for (const st of Array.isArray(value.statuses) ? value.statuses : []) {
        if (st?.status === 'failed') {
          logger.warn('[WHATSAPP_STATUS_FAILED]', { to: maskPhone(st.recipient_id), codes: (st.errors || []).map((e) => e.code) });
        }
      }
    }
  }
  return out;
}

// Texto del mensaje según su tipo. Los botones de plantilla (Confirmo / Cancelar) llegan como 'button' o 'interactive'.
function messageTextOf(message) {
  switch (message.type) {
    case 'text': return message.text?.body || null;
    case 'button': return message.button?.payload || message.button?.text || null;
    case 'interactive': return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || null;
    default: return null;
  }
}

// Payloads de los botones de la plantilla de recordatorio → la palabra que entiende el atajo de sí/no
const BUTTON_PAYLOADS = { CONFIRMAR_CITA: 'sí', CANCELAR_CITA: 'no' };

async function handleWebhook(req, res) {
  const body = req.body;
  if (body?.object !== 'whatsapp_business_account') {
    return res.sendStatus(404);
  }
  // Siempre 200 de inmediato (firma ya validada por el middleware). Si no, Meta reintenta durante horas
  // y luego llegan mensajes viejos fuera de contexto. Todo lo demás corre después de responder.
  res.sendStatus(200);

  try {
    for (const item of extractMessages(body)) {
      await receiveMessage(item);
    }
  } catch (error) {
    logger.error('webhook error:', error.message);
  }
}

async function receiveMessage({ phoneNumberId, message }) {
  const business = await getBusinessByPhoneNumberId(phoneNumberId);
  if (!business) {
    logger.warn('Negocio no encontrado para el webhook');
    return;
  }
  const from = message.from;

  // Idempotencia: Meta reenvía el mismo message_id. El primero que lo registra en la BD lo procesa; el resto se ignora.
  const claimed = await claimMessageId(business.id, from, message.id);
  if (!claimed) {
    logger.info('[WEBHOOK_DUPLICADO_IGNORADO]', { businessId: business.id, to: maskPhone(from) });
    return;
  }

  const sentAtMs = Number(message.timestamp) * 1000;
  const isStale = Number.isFinite(sentAtMs) && sentAtMs > 0 && Date.now() - sentAtMs > MAX_MESSAGE_AGE_MS;

  let messageText = messageTextOf(message);
  if (message.type === 'button' && BUTTON_PAYLOADS[messageText]) messageText = BUTTON_PAYLOADS[messageText];

  const item = { from, phoneNumberId, messageText, messageId: message.id, type: message.type, audioId: message.audio?.id, stale: isStale };
  const clientKey = `${business.id}:${from}`;

  if (processingClients.get(clientKey)) {
    if (!pendingMessages.has(clientKey)) pendingMessages.set(clientKey, []);
    pendingMessages.get(clientKey).push(item);
    logger.info('Cliente ya en procesamiento - mensaje encolado', { businessId: business.id, to: maskPhone(from) });
    return;
  }

  processingClients.set(clientKey, true);
  // No se espera: el webhook ya respondió y los demás mensajes del POST pueden seguir
  processClientQueue(clientKey, business, item).catch((err) => logger.error('Error en la cola del cliente:', err.message));
}

async function toText(item, business) {
  if (item.type === 'audio') {
    if (!item.audioId) return null;
    const businessToken = business.whatsapp_access_token
      ? require('../utils/encrypt').decrypt(business.whatsapp_access_token)
      : null;
    if (!businessToken) {
      logger.error('Token de WhatsApp no disponible para descargar audio');
      return null;
    }
    const { sendMessage } = require('../config/whatsapp');
    const audioUrlRes = await fetch(`https://graph.facebook.com/v18.0/${item.audioId}`, {
      headers: { Authorization: `Bearer ${businessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    const audioData = await audioUrlRes.json();
    if (!audioData?.url) {
      await sendMessage(item.from, 'No pude procesar tu nota de voz. ¿Puedes escribirme el mensaje?', businessToken, item.phoneNumberId);
      return null;
    }
    const transcribedText = await transcribeAudio(audioData.url, businessToken);
    if (!transcribedText) {
      await sendMessage(item.from, 'No pude escuchar tu nota de voz, ¿puedes escribirlo?', businessToken, item.phoneNumberId);
      return null;
    }
    logger.info('Audio transcrito', { length: transcribedText.length }); // nunca el texto (PII)
    return transcribedText;
  }
  return item.messageText || null;
}

async function processOne(item, business) {
  if (item.stale) {
    // Llegó tarde (reintento de Meta): se guarda para contexto/dueño, sin responder
    const text = item.type === 'audio' ? '[nota de voz]' : item.messageText;
    if (text) {
      const { appendMessage } = require('../services/conversationStore');
      await appendMessage(business.id, item.from, { role: 'user', content: text });
    }
    logger.info('[WEBHOOK_MENSAJE_VIEJO_SIN_RESPUESTA]', { businessId: business.id, to: maskPhone(item.from) });
    return;
  }
  const text = await toText(item, business);
  if (!text) {
    if (!['text', 'audio', 'button', 'interactive'].includes(item.type)) {
      logger.info('Tipo de mensaje no soportado, ignorando', { messageType: item.type });
    }
    return;
  }
  await processWhatsAppMessage({ from: item.from, phoneNumberId: item.phoneNumberId, messageText: text, messageId: item.messageId });
}

async function processClientQueue(clientKey, business, firstItem) {
  try {
    await processOne(firstItem, business);
  } catch (err) {
    logger.error(`Error procesando mensaje ${firstItem.type}:`, err.message);
  } finally {
    // Drenado: los mensajes que llegaron mientras tanto se juntan en un solo lote
    let drainIterations = 0;
    const MAX_DRAIN_ITERATIONS = 10;
    while (pendingMessages.has(clientKey) && drainIterations < MAX_DRAIN_ITERATIONS) {
      drainIterations++;
      await new Promise((resolve) => setTimeout(resolve, 300)); // margen para ráfagas
      const pending = pendingMessages.get(clientKey) || [];
      pendingMessages.delete(clientKey);
      if (!pending.length) continue;
      try {
        const frescos = [];
        for (const it of pending) {
          if (it.stale) { await processOne(it, business); continue; }
          const t = await toText(it, business);
          if (t) frescos.push(t);
        }
        if (frescos.length) {
          await processWhatsAppMessage({ from: pending[0].from, phoneNumberId: pending[0].phoneNumberId, messageText: frescos.join('\n'), messageId: pending.at(-1).messageId });
        }
      } catch (err) {
        logger.error('Error procesando lote encolado:', err.message);
      }
    }

    if (drainIterations >= MAX_DRAIN_ITERATIONS && pendingMessages.has(clientKey)) {
      const remaining = pendingMessages.get(clientKey) || [];
      logger.error('Cola de mensajes alcanzó el límite de drenado', { businessId: business.id, remaining: remaining.length });
      try {
        await logSystemAlert('queue_overflow_error', `Cola de WhatsApp desbordó: ${remaining.length} mensajes sin procesar.`, business.id, { remaining: remaining.length });
      } catch (alertErr) {
        logger.error('Error registrando alerta de queue overflow:', alertErr.message);
      }
      pendingMessages.delete(clientKey);
    }
    processingClients.delete(clientKey);
  }
}

async function reactivarBot(req, res) {
  try {
    const { client_phone } = req.body;
    if (!client_phone || typeof client_phone !== 'string' || client_phone.length > 20) {
      return res.status(400).json({ success: false, error: 'client_phone requerido' });
    }

    const { error } = await require('../config/supabase').supabaseAdmin
      .from('whatsapp_conversations')
      .update({ bot_paused_until: null })
      .eq('business_id', req.businessId)
      .eq('client_phone', client_phone);

    if (error) return res.status(500).json({ success: false, error: error.message });

    return res.json({ success: true, message: 'Bot reactivado correctamente' });
  } catch (err) {
    logger.error('Error reactivando bot:', err.message);
    return res.status(500).json({ success: false, error: 'Error interno' });
  }
}

async function getConversacionesPausadas(req, res) {
  try {
    const ahora = new Date().toISOString();
    const { data, error } = await require('../config/supabase').supabaseAdmin
      .from('whatsapp_conversations')
      .select('client_phone, bot_paused_until')
      .eq('business_id', req.businessId)
      .gt('bot_paused_until', ahora)
      .order('bot_paused_until');

    if (error) return res.status(500).json({ success: false, error: error.message });

    return res.json({ success: true, data: data || [] });
  } catch (err) {
    logger.error('Error obteniendo pausas:', err.message);
    return res.status(500).json({ success: false, error: 'Error interno' });
  }
}

module.exports = { verifyWebhook, handleWebhook, reactivarBot, getConversacionesPausadas, extractMessages, messageTextOf };
