const logger = require('../utils/logger');
const { processWhatsAppMessage } = require('../services/chatbot.service');

const processingClients = new Map(); // Map<clientKey, Promise> para serializar mensajes por cliente
const pendingMessages = new Map();

// Nota: processingClients ahora contiene Promises que se resuelven cuando termina el procesamiento.
// El cleanup automático ocurre cuando la Promise se resuelve (sin necesidad de interval).

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

async function handleWebhook(req, res) {
  let clientKey = null;
  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    if (!body.entry || !Array.isArray(body.entry) || body.entry.length === 0) {
      return res.status(200).json({ success: true });
    }

    const entry = body.entry[0];
    if (!entry.changes || !Array.isArray(entry.changes) || entry.changes.length === 0) {
      return res.status(200).json({ success: true });
    }

    const value = entry.changes[0]?.value;

    if (!value?.messages?.[0]) {
      return res.sendStatus(200);
    }

    const message = value.messages[0];
    const phoneNumberId = value.metadata?.phone_number_id;
    const from = message.from;
    const messageText = message.text?.body;

    // Verificar si el bot está pausado para este cliente
    const business = await require('../services/chatbot.service')
      .getBusinessByPhoneNumberId(phoneNumberId);

    // Serialización basada en estado real: si el cliente está siendo procesado, encolar
    if (business) {
      clientKey = business.id + ':' + from;
      const processingPromise = processingClients.get(clientKey);

      // Si hay procesamiento activo, encolar y esperar
      if (processingPromise) {
        logger.info('Cliente ya en procesamiento - encolando mensaje:', { clientKey });
        if (!pendingMessages.has(clientKey)) {
          pendingMessages.set(clientKey, []);
        }
        pendingMessages.get(clientKey).push({ from, phoneNumberId, messageText, messageId: message.id });
        res.sendStatus(200);
        return;
      }
    }

    if (business) {
      const { data: convData } = await require('../config/supabase').supabaseAdmin
        .from('whatsapp_conversations')
        .select('bot_paused_until')
        .eq('business_id', business.id)
        .eq('client_phone', from)
        .limit(1);

      const conv = convData?.[0] || null;

      const ahora = new Date();
      const pausadoHasta = conv?.bot_paused_until ? new Date(conv.bot_paused_until) : null;
      const estaPausado = pausadoHasta && pausadoHasta > ahora;

      if (estaPausado) {
        logger.info('Bot pausado para cliente:', { from, hasta: conv.bot_paused_until });
        return;
      }

      // TODO: reactivar cuando columna last_bot_response_at exista en prod
      // Evitar múltiples respuestas cuando cliente envió mensajes durante pausa
      // if (conv?.last_bot_response_at) {
      //   const ultimaRespuesta = new Date(conv.last_bot_response_at);
      //   const segundosDesdeRespuesta = (ahora - ultimaRespuesta) / 1000;
      //   if (segundosDesdeRespuesta < 10) {
      //     logger.info('Ignorando mensaje - bot respondió hace poco:', { from, segundos: Math.round(segundosDesdeRespuesta) });
      //     return;
      //   }
      // }
    }

    const messageType = message.type;

    res.sendStatus(200);

    // Manejar según tipo de mensaje: siempre liberar el lock al final
    if (clientKey) {
      let resolveProcessing;
      const processingPromise = new Promise(resolve => {
        resolveProcessing = resolve;
      });
      processingClients.set(clientKey, processingPromise);

      // Procesar según tipo de mensaje
      (async () => {
        try {
          if (messageType === 'audio') {
            // Procesar audio: transcribir y convertir a texto
            const audioId = message.audio?.id;
            if (!audioId) {
              logger.error('Audio sin ID');
              return;
            }

            const business = await require('../services/chatbot.service').getBusinessByPhoneNumberId(phoneNumberId);
            if (!business) {
              logger.error('Negocio no encontrado para procesar audio');
              return;
            }

            const businessToken = business?.whatsapp_access_token
              ? require('../utils/encrypt').decrypt(business.whatsapp_access_token)
              : null;

            if (!businessToken) {
              logger.error('Token de WhatsApp no disponible');
              return;
            }

            const audioUrlRes = await fetch(`https://graph.facebook.com/v18.0/${audioId}`, {
              headers: { Authorization: `Bearer ${businessToken}` }
            });

            const audioData = await audioUrlRes.json();
            const audioUrl = audioData.url;

            if (!audioUrl) {
              logger.error('No se obtuvo URL del audio');
              const { sendMessage } = require('../config/whatsapp');
              await sendMessage(
                from,
                'No pude procesar tu nota de voz. ¿Puedes escribirme el mensaje?',
                businessToken,
                phoneNumberId
              );
              return;
            }

            const { transcribeAudio } = require('../services/chatbot.service');
            const transcribedText = await transcribeAudio(audioUrl, businessToken);

            if (!transcribedText) {
              const { sendMessage } = require('../config/whatsapp');
              await sendMessage(
                from,
                'No pude escuchar tu nota de voz, ¿puedes escribirlo?',
                businessToken,
                phoneNumberId
              );
              return;
            }

            logger.info('Procesando audio transcrito como texto:', { from, texto: transcribedText });

            await require('../services/chatbot.service').processWhatsAppMessage({
              from,
              phoneNumberId,
              messageText: transcribedText,
              messageId: message.id
            });
          } else if (messageType === 'text' && messageText) {
            // Procesar texto normalmente
            await processWhatsAppMessage({
              from,
              phoneNumberId,
              messageText,
              messageId: message.id
            });
          } else {
            // Otros tipos (stickers, imágenes, etc.): ignorar pero aún así serializar
            logger.info('Tipo de mensaje no soportado, ignorando:', { messageType, from });
          }
        } catch (err) {
          logger.error(`Error procesando mensaje ${messageType}:`, err.message);
        } finally {
          // Drenado completo de la cola: procesar todos los batches encolados hasta que quede vacía
          // Previene pérdida de mensajes que llegan durante el procesamiento de un batch previo
          let drainIterations = 0;
          const MAX_DRAIN_ITERATIONS = 10;

          while (pendingMessages.has(clientKey) && drainIterations < MAX_DRAIN_ITERATIONS) {
            drainIterations++;

            // Si hay mensajes encolados, esperar 300ms para darle margen a más que lleguen en ráfaga
            // El cliente sigue bloqueado durante este tiempo
            logger.info('Drenando cola: iteración', { clientKey, iteration: drainIterations });
            await new Promise(resolve => setTimeout(resolve, 300));

            // Procesar mensajes encolados después del delay
            const pending = pendingMessages.get(clientKey);
            if (pending && pending.length > 0) {
              logger.info('Procesando batch encolado:', { clientKey, cantidad: pending.length, iteración: drainIterations });
              const combinedText = pending.map(m => m.messageText).join('\n');
              pendingMessages.delete(clientKey);
              try {
                await processWhatsAppMessage({
                  from: pending[0].from,
                  phoneNumberId: pending[0].phoneNumberId,
                  messageText: combinedText,
                  messageId: pending[pending.length - 1].messageId
                });
              } catch (err) {
                logger.error('Error procesando batch encolado:', err);
              }
            }
          }

          // Verificar si hubo desbordamiento (posible loop infinito)
          if (drainIterations >= MAX_DRAIN_ITERATIONS && pendingMessages.has(clientKey)) {
            const { logSystemAlert } = require('../services/chatbot.service');
            const remaining = pendingMessages.get(clientKey) || [];
            logger.error('⚠️ ALERTA: Cola de mensajes alcanzó límite de drenado, mensajes perdidos:', {
              clientKey,
              remaining: remaining.length
            });
            try {
              await logSystemAlert('queue_overflow_error',
                `Cola de WhatsApp desbordó para cliente ${clientKey}. ${remaining.length} mensajes perdidos.`,
                null,
                { clientKey, remaining: remaining.length }
              );
            } catch (alertErr) {
              logger.error('Error registrando alerta de queue overflow:', alertErr.message);
            }
            // Forzar limpieza para evitar bloqueo permanente
            pendingMessages.delete(clientKey);
          }

          // Liberar el lock resolviendo la Promise
          processingClients.delete(clientKey);
          resolveProcessing();
        }
      })();
    }

  } catch (error) {
    logger.error('webhook error:', error.message);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
}

async function reactivarBot(req, res) {
  try {
    const { client_phone } = req.body;
    if (!client_phone) {
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

module.exports = { verifyWebhook, handleWebhook, reactivarBot, getConversacionesPausadas };
