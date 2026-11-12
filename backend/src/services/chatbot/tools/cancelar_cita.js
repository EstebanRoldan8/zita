// Tool 'cancelar_cita' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { deleteCitaIncome } = require('../shared');

module.exports = async function cancelar_cita(toolInput, ctx) {
  const { businessId, citaDelCliente, CITA_NO_ENCONTRADA } = ctx;
  const cita = await citaDelCliente(toolInput.appointment_id);
  if (!cita) return CITA_NO_ENCONTRADA;
  return await deleteCitaIncome(cita.id, businessId);
};
