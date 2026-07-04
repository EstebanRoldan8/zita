const { createUserClient, supabaseAdmin } = require('../config/supabase');
const { getBotResponse } = require('../services/support.service');
const logger = require('../utils/logger');

async function getConversation(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);

    const { data: conversations } = await userClient
      .from('support_conversations')
      .select('id, status, created_at')
      .eq('business_id', req.businessId)
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1);

    let conversation = conversations?.[0];

    if (!conversation) {
      const { data: newConv, error } = await userClient
        .from('support_conversations')
        .insert({ business_id: req.businessId })
        .select()
        .single();

      if (error) throw error;
      conversation = newConv;
    }

    const { data: messages } = await userClient
      .from('support_messages')
      .select('id, sender, content, created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(20);

    return res.json({
      success: true,
      data: { ...conversation, messages: (messages || []).reverse() },
    });
  } catch (err) {
    logger.error(`support.getConversation: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function sendMessage(req, res) {
  try {
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'El mensaje no puede estar vacío.' });
    }

    const userClient = createUserClient(req.headers.authorization);

    // Buscar o crear conversación activa
    const { data: conversations } = await userClient
      .from('support_conversations')
      .select('id, status')
      .eq('business_id', req.businessId)
      .neq('status', 'closed')
      .order('created_at', { ascending: false })
      .limit(1);

    let conversation = conversations?.[0];

    if (!conversation) {
      const { data: newConv, error } = await userClient
        .from('support_conversations')
        .insert({ business_id: req.businessId })
        .select()
        .single();

      if (error) throw error;
      conversation = newConv;
    }

    // Guardar mensaje del negocio
    const { data: userMessage, error: userMsgError } = await userClient
      .from('support_messages')
      .insert({ conversation_id: conversation.id, sender: 'business', content: content.trim() })
      .select()
      .single();

    if (userMsgError) throw userMsgError;

    // Obtener historial reciente para contexto
    const { data: history } = await userClient
      .from('support_messages')
      .select('sender, content')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const { message, needsHuman } = await getBotResponse(
      content.trim(),
      (history || []).reverse().slice(0, -1) // excluye el mensaje recién guardado
    );

    // Guardar respuesta del bot
    const { data: botMessage, error: botMsgError } = await userClient
      .from('support_messages')
      .insert({ conversation_id: conversation.id, sender: 'bot', content: message })
      .select()
      .single();

    if (botMsgError) throw botMsgError;

    // Escalar a humano si es necesario
    if (needsHuman && conversation.status !== 'human') {
      await userClient
        .from('support_conversations')
        .update({ status: 'human' })
        .eq('id', conversation.id);

      await supabaseAdmin.from('notifications').insert({
        type: 'support_escalation',
        title: 'Soporte escalado a humano',
        body: `Un negocio necesita atención humana en el chat de soporte.`,
        metadata: { business_id: req.businessId, conversation_id: conversation.id },
      });
    }

    return res.json({ success: true, data: { userMessage, botResponse: botMessage } });
  } catch (err) {
    logger.error(`support.sendMessage: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function replyAsAdmin(req, res) {
  try {
    const { conversation_id, content } = req.body;

    if (!conversation_id || !content?.trim()) {
      return res.status(400).json({ success: false, error: 'conversation_id y content son obligatorios.' });
    }

    const { data, error } = await supabaseAdmin
      .from('support_messages')
      .insert({ conversation_id, sender: 'superadmin', content: content.trim() })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`support.replyAsAdmin: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getAll(req, res) {
  try {
    const { data: conversations, error } = await supabaseAdmin
      .from('support_conversations')
      .select(`
        id, status, created_at,
        businesses(id, name, owner_email),
        support_messages(id, sender, content, created_at)
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Adjuntar solo el último mensaje a cada conversación
    const result = (conversations || []).map((conv) => {
      const messages = conv.support_messages || [];
      const lastMessage = messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
      const { support_messages, ...rest } = conv;
      return { ...rest, last_message: lastMessage };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`support.getAll: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function contact(req, res) {
  try {
    const { message } = req.body;

    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('name, owner_email')
      .eq('id', req.businessId)
      .single();

    const title = `Soporte: ${business?.name || req.businessId}`;
    const body  = message?.trim() || '(sin mensaje)';

    const { error: notifError } = await supabaseAdmin.from('notifications').insert({
      type:     'support_contact',
      title,
      body,
      metadata: {
        business_id:  req.businessId,
        business_name: business?.name,
        owner_email:   business?.owner_email,
        message:       body,
      },
    }).select('id');

    if (notifError) {
      logger.warn(`support.contact notification insert failed: ${notifError.message}`, { businessId: req.businessId });
    }

    return res.json({ success: true, data: { sent: true } });
  } catch (err) {
    logger.error(`support.contact: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error al enviar el mensaje.' });
  }
}

module.exports = { contact, getConversation, sendMessage, replyAsAdmin, getAll };
