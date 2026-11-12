// Dependencias y helpers compartidos por las tools del bot (./tools/*.js) y chatbot.service.js.
const { supabaseAdmin } = require('../../config/supabase');
const logger = require('../../utils/logger');
const { decrypt } = require('../../utils/encrypt');
const { deleteCitaIncome } = require('../scheduler.service');
const { logSystemAlert } = require('../../utils/systemAlerts');
const { getPlan } = require('../../config/plans');
const { maskPhone } = require('../../utils/phone');
const { notify } = require('../whatsappNotify');
const availability = require('../../utils/availability');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Escapa comodines de ILIKE (% _ \) para que un texto del cliente no haga match con cualquier registro
function escapeLike(s) {
  return String(s || '').trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`);
}

const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Busca un servicio activo por nombre: primero coincidencia exacta (sin tildes ni mayúsculas), luego parcial.
// Si la parcial da varios, devuelve ambiguo con las opciones en vez de elegir uno al azar.
async function findService(businessId, name) {
  const term = normName(name);
  if (!term) return { servicio: null };
  const { data } = await supabaseAdmin
    .from('services')
    .select('id, name, price, duration_minutes')
    .eq('business_id', businessId)
    .eq('active', true)
    .ilike('name', `%${escapeLike(name)}%`)
    .limit(10);
  const list = data || [];
  const exact = list.filter((s) => normName(s.name) === term);
  if (exact.length >= 1) return { servicio: exact[0] };
  if (list.length === 1) return { servicio: list[0] };
  if (list.length > 1) return { servicio: null, ambiguo: true, opciones: list.map((s) => ({ name: s.name, price: s.price, duration_minutes: s.duration_minutes })) };
  return { servicio: null };
}

// Códigos de Postgres que indican que el horario ya se tomó (único por inicio o exclusión por solape)
const isBookingConflict = (error) => !!error && (error.code === '23505' || error.code === '23P01');

// Desde qué número se avisa al dueño: el del negocio con su token; si el negocio no tiene token, el número
// global de ZITA (token y número globales juntos: mezclar el token global con el número del negocio falla).
function ownerSender(business) {
  if (business?.whatsapp_access_token && business?.whatsapp_phone_number_id) {
    return { token: decrypt(business.whatsapp_access_token), phoneNumberId: business.whatsapp_phone_number_id };
  }
  return { token: null, phoneNumberId: null };
}

module.exports = {
  supabaseAdmin, logger, decrypt, deleteCitaIncome, logSystemAlert, getPlan, maskPhone, notify,
  ...availability,
  UUID_RE, escapeLike, normName, findService, isBookingConflict, ownerSender,
};
