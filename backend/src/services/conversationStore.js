// Fila de conversación de WhatsApp (whatsapp_conversations): historial, pausa, contexto de grupo y deduplicación.
// Un solo lugar para leerla y escribirla, compartido por el bot y el scheduler (recordatorios).
//
// Cada mensaje del historial: { role: 'user'|'assistant', content: string, timestamp: ISO, kind?, appointment_id? }
//  - kind 'reminder' + appointment_id: recordatorio de cita enviado por el scheduler. Solo así el atajo de
//    "sí"/"no" sabe a qué cita responde el cliente.
// Nunca se guardan bloques de tools ni el delimitador <mensaje_usuario>: solo el texto.

const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

const MAX_STORED_MESSAGES = 12;
const CONVERSATION_COLUMNS = 'id, messages, bot_paused_until, context, processed_message_ids';

function cleanMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    let content = m.content;
    if (Array.isArray(content)) {
      content = content.filter((c) => c?.type === 'text' && c.text?.trim()).map((c) => c.text).join(' ');
    }
    if (typeof content !== 'string' || !content.trim()) continue;
    content = content.replace(/<\/?mensaje_usuario>/gi, '').trim();
    const entry = { role: m.role, content, timestamp: m.timestamp || new Date().toISOString() };
    if (m.kind) entry.kind = m.kind;
    if (m.appointment_id) entry.appointment_id = m.appointment_id;
    out.push(entry);
  }
  return out;
}

async function loadConversation(businessId, clientPhone) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('business_id', businessId)
    .eq('client_phone', clientPhone)
    .maybeSingle();
  if (error) {
    logger.error('[CONVERSATION_LOAD_FAILED]', { businessId, error: error.message });
    return null;
  }
  return data || null;
}

async function saveMessages(businessId, clientPhone, messages) {
  const { error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .upsert({
      business_id: businessId,
      client_phone: clientPhone,
      messages: cleanMessages(messages).slice(-MAX_STORED_MESSAGES),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'business_id,client_phone' });
  if (error) logger.error('[CONVERSATION_SAVE_FAILED]', { businessId, error: error.message });
  return !error;
}

// Agrega un mensaje (del bot o del sistema) al final del historial. Lo usa el scheduler para dejar el recordatorio.
async function appendMessage(businessId, clientPhone, entry) {
  const conv = await loadConversation(businessId, clientPhone);
  const messages = [...(conv?.messages || []), { timestamp: new Date().toISOString(), ...entry }];
  return saveMessages(businessId, clientPhone, messages);
}

// Último mensaje entrante del cliente (para la ventana de 24 h de WhatsApp)
function lastInboundAt(messages) {
  const last = [...(messages || [])].reverse().find((m) => m.role === 'user' && m.timestamp);
  return last ? new Date(last.timestamp) : null;
}

// Si lo último que pasó en la conversación fue un recordatorio de cita (sin mensajes del cliente después),
// devuelve { appointmentId, sentAt }. Si no, null: el "sí"/"no" del cliente responde a otra cosa.
const REMINDER_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
function pendingReminder(messages, now = Date.now()) {
  const last = (messages || []).at(-1);
  if (!last || last.role !== 'assistant' || last.kind !== 'reminder' || !last.appointment_id) return null;
  const sentAt = last.timestamp ? new Date(last.timestamp).getTime() : 0;
  if (!sentAt || now - sentAt > REMINDER_REPLY_WINDOW_MS) return null;
  return { appointmentId: last.appointment_id, sentAt: new Date(sentAt) };
}

module.exports = { MAX_STORED_MESSAGES, cleanMessages, loadConversation, saveMessages, appendMessage, lastInboundAt, pendingReminder };
