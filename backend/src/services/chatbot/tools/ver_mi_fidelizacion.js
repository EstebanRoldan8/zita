// Tool 'ver_mi_fidelizacion' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin } = require('../shared');

module.exports = async function ver_mi_fidelizacion(toolInput, ctx) {
  const { businessId, clientPhone } = ctx;
  const { data: clienteData } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('business_id', businessId)
    .eq('phone', clientPhone)
    .maybeSingle();

  if (!clienteData) {
    return { visitas_acumuladas: 0, visitas_faltantes: null, message: 'Aún no tienes visitas registradas con nosotros' };
  }

  const clienteId = clienteData.id;

  const { data: loyalty } = await supabaseAdmin
    .from('client_loyalty')
    .select('loyalty_visits, total_visits')
    .eq('business_id', businessId)
    .eq('client_id', clienteId)
    .maybeSingle();

  const { data: config } = await supabaseAdmin
    .from('loyalty_config')
    .select('visits_for_reward, reward_service_id, services(name)')
    .eq('business_id', businessId)
    .maybeSingle();

  const visitas = loyalty?.loyalty_visits || 0;
  const meta = config?.visits_for_reward || 10;
  const faltan = Math.max(0, meta - visitas);
  const servicio_gratis = config?.services?.name || 'servicio gratis';

  return {
    visitas_acumuladas: visitas,
    visitas_para_recompensa: meta,
    visitas_faltantes: faltan,
    recompensa: servicio_gratis,
    listo_para_canjear: faltan === 0
  };
};
