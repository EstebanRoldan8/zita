// Escalaciones del bot ("quiero hablar con una persona") para el panel del DUEÑO.
// Fuente: system_alerts con tipo 'escalamiento_humano' (las guarda chatbot/tools/escalar_a_humano.js).
//   - business_id SIEMPRE de req.businessId (JWT → businessContext); nunca del body ni del query.
//   - cliente: metadata.client_id → clients (filtrado por el negocio); pausa: whatsapp_conversations.bot_paused_until
//   - "atendida": metadata.attended_at (no se usa read_at, que es la marca de leída del superadmin; sin migración)
// Escalaciones anteriores a este cambio no tienen client_id: se muestran con el teléfono enmascarado y sin acciones
// que necesiten identificar al cliente (abrir WhatsApp, reactivar bot).
const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');
const { normalizeColombianPhone } = require('../utils/phone');

const TIPO = 'escalamiento_humano';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 50;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const serverError = (res) => res.status(500).json({ success: false, error: 'Error interno del servidor.' });

// Texto plano y corto (el motivo viene del texto del cliente): sin controles, sin saltos raros, máx. 300
function plainText(value, max = 300) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Teléfono para wa.me: dígitos con indicativo (Colombia por defecto); null si no se puede armar
function waLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const intl = normalizeColombianPhone(digits) || (digits.length >= 11 && digits.length <= 15 ? digits : null);
  return intl ? `https://wa.me/${intl}` : null;
}

// Escalación del negocio (o null). Siempre con business_id + tipo explícitos.
async function loadEscalation(businessId, id) {
  const { data, error } = await supabaseAdmin
    .from('system_alerts')
    .select('id, created_at, metadata, business_id, tipo')
    .eq('id', id)
    .eq('business_id', businessId)
    .eq('tipo', TIPO)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Cliente de la escalación, del mismo negocio (o null)
async function loadClient(businessId, clientId) {
  if (!isUuid(clientId)) return null;
  const { data } = await supabaseAdmin
    .from('clients')
    .select('id, name, phone')
    .eq('id', clientId)
    .eq('business_id', businessId)
    .maybeSingle();
  return data || null;
}

// GET /api/escalations — las últimas 50 del negocio, más recientes primero, y cuántas siguen sin atender
async function list(req, res) {
  try {
    const businessId = req.businessId;
    const { data: alerts, error } = await supabaseAdmin
      .from('system_alerts')
      .select('id, created_at, metadata')
      .eq('business_id', businessId)
      .eq('tipo', TIPO)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (error) throw error;

    const rows = alerts || [];
    const clientIds = [...new Set(rows.map((a) => a.metadata?.client_id).filter(isUuid))];
    let clientsById = new Map();
    if (clientIds.length) {
      const { data: clients, error: cErr } = await supabaseAdmin
        .from('clients')
        .select('id, name, phone')
        .eq('business_id', businessId)
        .in('id', clientIds);
      if (cErr) throw cErr;
      clientsById = new Map((clients || []).map((c) => [c.id, c]));
    }

    const phones = [...new Set([...clientsById.values()].map((c) => c.phone).filter(Boolean))];
    let pausedByPhone = new Map();
    if (phones.length) {
      const { data: convs, error: vErr } = await supabaseAdmin
        .from('whatsapp_conversations')
        .select('client_phone, bot_paused_until')
        .eq('business_id', businessId)
        .in('client_phone', phones);
      if (vErr) throw vErr;
      pausedByPhone = new Map((convs || []).map((v) => [v.client_phone, v.bot_paused_until]));
    }

    const now = Date.now();
    const items = rows.map((a) => {
      const m = a.metadata || {};
      const client = clientsById.get(m.client_id) || null;
      const pausedUntil = client ? pausedByPhone.get(client.phone) || null : null;
      return {
        id: a.id,
        created_at: a.created_at,
        motivo: plainText(m.motivo) || 'Quiere hablar con una persona',
        client_name: client?.name ? plainText(client.name, 80) : null,
        // Teléfono completo solo cuando se resolvió el cliente de ESTE negocio; si no, el enmascarado guardado
        client_phone: client?.phone || null,
        client_phone_masked: client ? null : plainText(m.cliente, 20) || null,
        whatsapp_url: client ? waLink(client.phone) : null,
        attended_at: m.attended_at || null,
        bot_paused: !!(pausedUntil && new Date(pausedUntil).getTime() > now),
        bot_paused_until: pausedUntil,
        can_resume_bot: !!client,
      };
    });

    return res.json({ success: true, data: { items, open_count: items.filter((i) => !i.attended_at).length } });
  } catch (err) {
    logger.error(`escalations.list: ${err.message}`);
    return serverError(res);
  }
}

// POST /api/escalations/:id/attend — marca atendida (idempotente)
async function attend(req, res) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ success: false, error: 'Identificador inválido.' });
    const esc = await loadEscalation(req.businessId, id);
    if (!esc) return res.status(404).json({ success: false, error: 'Escalación no encontrada.' });

    const metadata = esc.metadata || {};
    if (metadata.attended_at) return res.json({ success: true, data: { id, attended_at: metadata.attended_at } });

    const attendedAt = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('system_alerts')
      .update({ metadata: { ...metadata, attended_at: attendedAt } })
      .eq('id', id)
      .eq('business_id', req.businessId)
      .eq('tipo', TIPO);
    if (error) throw error;

    logger.info('[ESCALACION_ATENDIDA]', { businessId: req.businessId, escalationId: id });
    return res.json({ success: true, data: { id, attended_at: attendedAt } });
  } catch (err) {
    logger.error(`escalations.attend: ${err.message}`);
    return serverError(res);
  }
}

// POST /api/escalations/:id/resume-bot — reactiva el bot para el cliente de esa escalación
async function resumeBot(req, res) {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(400).json({ success: false, error: 'Identificador inválido.' });
    const esc = await loadEscalation(req.businessId, id);
    if (!esc) return res.status(404).json({ success: false, error: 'Escalación no encontrada.' });

    const client = await loadClient(req.businessId, esc.metadata?.client_id);
    if (!client?.phone) {
      return res.status(409).json({ success: false, error: 'No se pudo identificar al cliente de esta escalación (es anterior a esta versión). El bot se reactiva solo a las 3 horas de la escalación.' });
    }

    const { error } = await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ bot_paused_until: null })
      .eq('business_id', req.businessId)
      .eq('client_phone', client.phone);
    if (error) throw error;

    logger.info('[ESCALACION_BOT_REACTIVADO]', { businessId: req.businessId, escalationId: id });
    return res.json({ success: true, data: { id, bot_paused: false } });
  } catch (err) {
    logger.error(`escalations.resumeBot: ${err.message}`);
    return serverError(res);
  }
}

module.exports = { list, attend, resumeBot, waLink, plainText };
