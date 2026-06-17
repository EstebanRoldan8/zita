const logger = require('../utils/logger');
const { processWhatsAppMessage } = require('../services/chatbot.service');

const processingClients = new Map();

// Limpiar Map periódicamente (entries más viejas de 30 segundos)
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processingClients) {
    if (now - timestamp > 30000) {
      processingClients.delete(key);
    }
  }
}, 10000);

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

    // Verificar si el bot está pausado para este cliente
    const business = await require('../services/chatbot.service')
      .getBusinessByPhoneNumberId(phoneNumberId);

    // Race condition fix: verificar si este cliente ya está siendo procesado
    if (business) {
      clientKey = business.id + ':' + from;
      const lastProcessing = processingClients.get(clientKey);
      const now = Date.now();

      if (lastProcessing && (now - lastProcessing) < 15000) {
        logger.info('Cliente ya en procesamiento - ignorando mensaje duplicado:', { clientKey, tiempoDesdeUltimo: now - lastProcessing });
        res.sendStatus(200);
        return;
      }

      processingClients.set(clientKey, now);
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

    const messageText = message.text?.body;
    const messageType = message.type;

    if (messageType !== 'text' || !messageText) {
      if (messageType === 'audio') {
        res.sendStatus(200);

        try {
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
        } catch (err) {
          logger.error('Error procesando audio:', err.message);
        } finally {
          if (clientKey) {
            processingClients.delete(clientKey);
          }
        }
      } else {
        res.sendStatus(200);
      }
      return;
    }

    res.sendStatus(200);

    processWhatsAppMessage({
      from,
      phoneNumberId,
      messageText,
      messageId: message.id
    }).catch(err => logger.error('Error procesando mensaje WA:', err))
      .finally(() => {
        if (clientKey) {
          processingClients.delete(clientKey);
        }
      });

  } catch (error) {
    logger.error('webhook error:', error.message);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
}

module.exports = { verifyWebhook, handleWebhook };
