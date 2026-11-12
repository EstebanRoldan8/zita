// Tool 'ver_mis_citas' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin } = require('../shared');

module.exports = async function ver_mis_citas(toolInput, ctx) {
  const { businessId, clientPhone } = ctx;
  const { data: clienteDB } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('business_id', businessId)
    .eq('phone', clientPhone)
    .single();

  if (!clienteDB) return { citas: [], message: 'No tienes citas registradas' };

  const hoy = new Date().toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('id, scheduled_at, status, services(name, price), employees(name)')
    .eq('business_id', businessId)
    .eq('client_id', clienteDB.id)
    .neq('status', 'cancelled')
    .gte('scheduled_at', hoy + 'T00:00:00-05:00')
    .order('scheduled_at');

  const citasFormateadas = (data || []).map(c => {
    const horaCol = new Date(c.scheduled_at).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    return {
      id: c.id,
      servicio: c.services?.name,
      precio: c.services?.price,
      empleado: c.employees?.name || null,
      fecha_hora_colombia: horaCol,
      status: c.status
    };
  });
  return { citas: citasFormateadas };
};
