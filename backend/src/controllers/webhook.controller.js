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
    const token = req.query['hub.verify_token'] || req.headers['x-verify-token'];
    if (!token || token !== process.env.WHATSAPP_VERIFY_TOKEN) {
      logger.warn('Webhook llamado sin token válido');
      return res.sendStatus(403);
    }

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
    const messageType = message.type;

    if (messageType !== 'text' || !messageText) {
      return res.sendStatus(200);
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
