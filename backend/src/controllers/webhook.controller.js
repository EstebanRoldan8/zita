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

    logger.info('Business encontrado: ' + JSON.stringify({
      business_id: business?.id,
      business_completo: JSON.stringify(business),
      phoneNumberId: phoneNumberId,
      from: from
    }));

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
      const { data: convData, error: convError } = await require('../config/supabase').supabaseAdmin
        .from('whatsapp_conversations')
        .select('bot_paused_until, last_bot_response_at')
        .eq('business_id', business.id)
        .eq('client_phone', from)
        .order('last_message_at', { ascending: false })
        .limit(1);

      logger.info('Conv query result: ' + JSON.stringify({
        convData: convData,
        convError: convError?.message,
        query_business_id: business.id,
        query_from: from
      }));

      const conv = convData?.[0] || null;

      logger.info('Pause check: ' + JSON.stringify({
        conv_existe: !!conv,
        bot_paused_until: conv?.bot_paused_until,
        registros_encontrados: convData?.length,
        business_id: business?.id,
        from
      }));

      const ahora = new Date();
      const pausadoHasta = conv?.bot_paused_until ? new Date(conv.bot_paused_until) : null;
      const estaPausado = pausadoHasta && pausadoHasta > ahora;

      if (estaPausado) {
        logger.info('Bot pausado para cliente:', { from, hasta: conv.bot_paused_until });
        return;
      }

      // Evitar múltiples respuestas cuando cliente envió mensajes durante pausa
      if (conv?.last_bot_response_at) {
        const ultimaRespuesta = new Date(conv.last_bot_response_at);
        const segundosDesdeRespuesta = (ahora - ultimaRespuesta) / 1000;
        if (segundosDesdeRespuesta < 10) {
          logger.info('Ignorando mensaje - bot respondió hace poco:', { from, segundos: Math.round(segundosDesdeRespuesta) });
          return;
        }
      }
    }

    const messageText = message.text?.body;
    const messageType = message.type;

    if (messageType !== 'text' || !messageText) {
      if (messageType === 'audio') {
        // Verificar si bot está pausado antes de responder a audio
        let estaPausado = false;
        if (business) {
          const { data: audioConvData } = await require('../config/supabase').supabaseAdmin
            .from('whatsapp_conversations')
            .select('bot_paused_until')
            .eq('business_id', business.id)
            .eq('client_phone', from)
            .limit(1);
          const audioConv = audioConvData?.[0] || null;
          const ahora = new Date();
          const pausadoHasta = audioConv?.bot_paused_until ? new Date(audioConv.bot_paused_until) : null;
          estaPausado = pausadoHasta && pausadoHasta > ahora;
        }

        if (estaPausado) {
          logger.info('Bot pausado - no respondiendo a audio:', { from });
          res.sendStatus(200);
          return;
        }

        res.sendStatus(200);
        const { sendMessage } = require('../config/whatsapp');
        try {
          const business = await require('../services/chatbot.service').getBusinessByPhoneNumberId(phoneNumberId);
          const businessToken = business?.whatsapp_access_token
            ? require('../utils/encrypt').decrypt(business.whatsapp_access_token)
            : null;
          await sendMessage(
            from,
            'Hola 😊 No puedo escuchar notas de voz, pero con gusto te ayudo por texto. ¿En qué te puedo colaborar?',
            businessToken,
            phoneNumberId
          );
        } catch(e) {
          logger.error('Error respondiendo nota de voz:', e.message);
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
    }).catch(err => logger.error('Error procesando mensaje WA:', err));

  } catch (error) {
    logger.error('webhook error:', error.message);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  } finally {
    if (clientKey) {
      processingClients.delete(clientKey);
    }
  }
}

module.exports = { verifyWebhook, handleWebhook };
