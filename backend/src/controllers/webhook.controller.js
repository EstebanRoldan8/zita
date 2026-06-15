const logger = require('../utils/logger');
const { processWhatsAppMessage } = require('../services/chatbot.service');

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

    if (business) {
      const { data: conv } = await require('../config/supabase').supabaseAdmin
        .from('whatsapp_conversations')
        .select('bot_paused_until')
        .eq('business_id', business.id)
        .eq('client_phone', from)
        .maybeSingle();

      const ahora = new Date();
      const pausadoHasta = conv?.bot_paused_until ? new Date(conv.bot_paused_until) : null;
      const estaPausado = pausadoHasta && pausadoHasta > ahora;

      logger.info('DEBUG - Verificación de pausa:', {
        from,
        bot_paused_until: conv?.bot_paused_until,
        ahora: ahora.toISOString(),
        estaPausado,
        minutosFaltantes: estaPausado ? Math.round((pausadoHasta - ahora) / 60000) : null
      });

      if (estaPausado) {
        logger.info('Bot pausado - bloqueando mensaje:', { from, pausadoHasta: pausadoHasta.toISOString() });
        return;
      }
    }

    const messageText = message.text?.body;
    const messageType = message.type;

    if (messageType !== 'text' || !messageText) {
      if (messageType === 'audio') {
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
  }
}

module.exports = { verifyWebhook, handleWebhook };
