const { supabaseAdmin } = require('../config/supabase');
const { PLANS } = require('../config/plans');
const logger = require('../utils/logger');
const { getMonthRangeByCountry } = require('../utils/timezone');

async function getSubscription(req, res) {
  try {
    const { data: business } = await supabaseAdmin
      .from('businesses')
      .select('plan, trial_ends_at, plan_expires_at, ai_messages_today, ai_messages_date')
      .eq('id', req.businessId)
      .single();

    if (!business) {
      return res.status(404).json({ success: false, error: 'Negocio no encontrado' });
    }

    const ahora = new Date();
    const plan = business.plan || 'estandar';
    const planConfig = PLANS[plan];

    let estado = 'active';
    let dias_restantes = null;

    if (business.trial_ends_at && new Date(business.trial_ends_at) > ahora) {
      estado = 'trial';
      dias_restantes = Math.ceil((new Date(business.trial_ends_at) - ahora) / (1000 * 60 * 60 * 24));
    } else if (!business.plan_expires_at || new Date(business.plan_expires_at) < ahora) {
      estado = 'expired';
    }

    const { start: inicioMes, end: finMes } = getMonthRangeByCountry('colombia');

    const { count: citas_mes } = await supabaseAdmin
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', req.businessId)
      .gte('scheduled_at', inicioMes)
      .lte('scheduled_at', finMes)
      .neq('status', 'cancelled');

    const { count: empleados_activos } = await supabaseAdmin
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', req.businessId)
      .eq('is_active', true);

    const hoy = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const ai_messages_today = business.ai_messages_date === hoy
      ? (business.ai_messages_today || 0)
      : 0;

    return res.json({
      success: true,
      data: {
        plan,
        plan_name: planConfig.name,
        price: planConfig.price,
        estado,
        dias_restantes,
        trial_ends_at: business.trial_ends_at,
        plan_expires_at: business.plan_expires_at,
        features: planConfig.features,
        limites: {
          max_employees: planConfig.max_employees,
          max_appointments_month: planConfig.max_appointments_month,
          max_orders_month: planConfig.max_orders_month,
          ai_messages_day: planConfig.ai_messages_day
        },
        uso: {
          citas_mes: citas_mes || 0,
          empleados_activos: empleados_activos || 0,
          ai_messages_today
        },
        todos_los_planes: PLANS
      }
    });
  } catch (err) {
    logger.error(`subscription.getSubscription: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { getSubscription };
