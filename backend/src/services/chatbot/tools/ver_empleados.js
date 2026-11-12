// Tool 'ver_empleados' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin } = require('../shared');

module.exports = async function ver_empleados(toolInput, ctx) {
  const { businessId } = ctx;
  const { data: empleados } = await supabaseAdmin
    .from('employees')
    .select('id, name')
    .eq('business_id', businessId)
    .eq('is_active', true);

  return { empleados: empleados || [] };
};
