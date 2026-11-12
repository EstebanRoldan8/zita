// Tool 'ver_horarios' del bot de WhatsApp (descripción y parámetros en ../prompt.js → BOT_TOOLS).
// ctx: { businessId, clientPhone, business, clientInfo, citaDelCliente, CITA_NO_ENCONTRADA }
const { supabaseAdmin } = require('../shared');

module.exports = async function ver_horarios(toolInput, ctx) {
  const { businessId } = ctx;
  const { data: horarios } = await supabaseAdmin
    .from('business_hours')
    .select('day_of_week, open_time, close_time, is_open')
    .eq('business_id', businessId)
    .order('day_of_week');

  const diasNombres = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

  const horariosFormateados = (horarios || []).map(h => ({
    dia: diasNombres[h.day_of_week],
    abierto: h.is_open,
    apertura: h.open_time,
    cierre: h.close_time
  }));

  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const en30 = new Date(Date.now() + 30*86400000).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const { data: diasCerrados } = await supabaseAdmin
    .from('business_closed_days')
    .select('date, reason')
    .eq('business_id', businessId)
    .gte('date', hoy)
    .lte('date', en30)
    .order('date');

  if (toolInput.dia) {
    const diaLower = toolInput.dia.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const horarioDia = horariosFormateados.find(h =>
      h.dia.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(diaLower)
    );
    return { horario_dia: horarioDia || null, dias_cerrados: diasCerrados || [] };
  }

  return { horarios: horariosFormateados, dias_cerrados: diasCerrados || [] };
};
