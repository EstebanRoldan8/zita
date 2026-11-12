// Tool 'ver_productos' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin } = require('../shared');

module.exports = async function ver_productos(toolInput, ctx) {
  const { businessId } = ctx;
  const { data } = await supabaseAdmin
    .from('products')
    .select('name, price, stock')
    .eq('business_id', businessId)
    .eq('is_active', true)
    .gt('stock', 0)
    .order('name');

  return { productos: data || [] };
};
