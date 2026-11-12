// Tool 'ver_servicios' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin } = require('../shared');

module.exports = async function ver_servicios(toolInput, ctx) {
  const { businessId } = ctx;
  const { data } = await supabaseAdmin
    .from('services')
    .select('name, price, duration_minutes')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('name');

  const unicos = [];
  const nombres = new Set();
  data?.forEach(s => {
    if (!nombres.has(s.name)) {
      nombres.add(s.name);
      unicos.push(s);
    }
  });

  return { servicios: unicos };
};
