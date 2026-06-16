const { supabaseAdmin } = require('../config/supabase');
const logger = require('../utils/logger');

async function getMetrics(req, res) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      { count: totalBusinesses },
      { count: todayAppointments },
      { count: statusCount },
    ] = await Promise.all([
      supabaseAdmin.from('businesses').select('*', { count: 'exact', head: true }),
      supabaseAdmin
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .gte('scheduled_at', todayStart.toISOString())
        .lte('scheduled_at', todayEnd.toISOString()),
      supabaseAdmin.from('businesses').select('status', { count: 'exact', head: true }),
    ]);

    const { data: byStatus } = await supabaseAdmin.from('businesses').select('status');
    const statusCountMap = (byStatus || []).reduce((acc, b) => {
      acc[b.status] = (acc[b.status] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      success: true,
      data: {
        total_businesses: totalBusinesses || 0,
        today_appointments: todayAppointments || 0,
        active: statusCountMap['active'] || 0,
        trial: statusCountMap['trial'] || 0,
        suspended: statusCountMap['suspended'] || 0,
      },
    });
  } catch (err) {
    logger.error(`admin.getMetrics: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getBusinesses(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('businesses')
      .select('id, name, owner_email, business_type, status, phone, created_at, plan')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, data: data || [] });
  } catch (err) {
    logger.error(`admin.getBusinesses: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getBusinessDetail(req, res) {
  try {
    const { id } = req.params;

    const [
      { data: business, error: bizError },
      { count: clientsCount },
      { count: servicesCount },
      { count: appointmentsCount },
      { data: recentAppointments },
    ] = await Promise.all([
      supabaseAdmin
        .from('businesses')
        .select('id, name, owner_email, business_type, status, phone, address, created_at, plan, trial_ends_at, plan_expires_at')
        .eq('id', id)
        .single(),
      supabaseAdmin
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', id),
      supabaseAdmin
        .from('services')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', id)
        .eq('active', true),
      supabaseAdmin
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', id),
      supabaseAdmin
        .from('appointments')
        .select('id, scheduled_at, status, price, clients(name), services(name)')
        .eq('business_id', id)
        .order('scheduled_at', { ascending: false })
        .limit(10),
    ]);

    if (bizError) throw bizError;

    return res.json({
      success: true,
      data: {
        ...business,
        stats: {
          clients: clientsCount || 0,
          services: servicesCount || 0,
          appointments: appointmentsCount || 0,
        },
        recent_appointments: recentAppointments || [],
      },
    });
  } catch (err) {
    logger.error(`admin.getBusinessDetail: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function updateBusiness(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['trial', 'active', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Estado no válido. Usa: trial, active o suspended.' });
    }

    const { data, error } = await supabaseAdmin
      .from('businesses')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`admin.updateBusiness: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getConversationDetail(req, res) {
  try {
    const { id } = req.params;

    const { data: messages, error } = await supabaseAdmin
      .from('support_messages')
      .select('id, sender, content, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return res.json({ success: true, data: messages || [] });
  } catch (err) {
    logger.error(`admin.getConversationDetail: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getNotifications(req, res) {
  try {
    const { type } = req.query;
    let query = supabaseAdmin
      .from('notifications')
      .select('id, business_id, type, message, metadata, read, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;

    if (error) throw error;

    const enrichedData = await Promise.all((data || []).map(async (notif) => {
      if (notif.business_id) {
        const { data: business } = await supabaseAdmin
          .from('businesses')
          .select('name')
          .eq('id', notif.business_id)
          .single();
        return { ...notif, business_name: business?.name || 'Desconocido' };
      }
      return { ...notif, business_name: 'Desconocido' };
    }));

    return res.json({ success: true, data: enrichedData || [] });
  } catch (err) {
    logger.error(`admin.getNotifications: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function markNotificationRead(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ read: true })
      .eq('id', id);

    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    logger.error(`admin.markNotificationRead: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function changePlan(req, res) {
  try {
    const { id } = req.params;
    const { plan } = req.body;

    const { PLANS } = require('../config/plans');

    if (!['lite', 'estandar', 'pro'].includes(plan)) {
      return res.status(400).json({
        success: false,
        error: 'Plan inválido'
      });
    }

    const { error } = await supabaseAdmin
      .from('businesses')
      .update({
        plan,
        plan_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
      .eq('id', id);

    if (error) throw error;

    return res.json({ success: true, data: { plan } });
  } catch (err) {
    logger.error(`admin.changePlan: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getCaja(req, res) {
  try {
    const bogota = { timeZone: 'America/Bogota' };
    const hoy = new Date().toLocaleDateString('en-CA', bogota);
    const inicioMes = hoy.slice(0,7) + '-01';
    const inicioAño = hoy.slice(0,4) + '-01-01';

    const mesConsulta = req.query.month || hoy.slice(0,7);
    const inicioMesConsulta = mesConsulta + '-01';
    const [yC, mC] = mesConsulta.split('-').map(Number);
    const finMesConsulta = mC === 12
      ? `${yC+1}-01-01`
      : `${yC}-${String(mC+1).padStart(2,'0')}-01`;

    const [
      { data: pagosAprobados },
      { data: pagosMes },
      { data: pagosAño },
      { data: businesses },
      { data: egresos },
      { data: egresosMes },
      { data: goalData },
      { data: pagosMesConsulta },
      { data: egresosMesConsulta },
    ] = await Promise.all([
      supabaseAdmin.from('payments').select('amount, plan, created_at, business_id, businesses(name)').eq('status', 'approved').order('created_at', { ascending: false }),
      supabaseAdmin.from('payments').select('amount').eq('status', 'approved').gte('created_at', inicioMes),
      supabaseAdmin.from('payments').select('amount, created_at').eq('status', 'approved').gte('created_at', inicioAño),
      supabaseAdmin.from('businesses').select('id, name, plan, status').eq('status', 'active'),
      supabaseAdmin.from('zita_expenses').select('*').order('date', { ascending: false }),
      supabaseAdmin.from('zita_expenses').select('amount, currency').gte('date', inicioMes),
      supabaseAdmin.from('zita_settings').select('value').eq('key', 'monthly_goal').maybeSingle(),
      supabaseAdmin.from('payments').select('amount, plan, created_at, business_id, businesses(name)').eq('status', 'approved').gte('created_at', inicioMesConsulta).lt('created_at', finMesConsulta).order('created_at', { ascending: false }),
      supabaseAdmin.from('zita_expenses').select('*').gte('date', inicioMesConsulta).lt('date', finMesConsulta).order('date', { ascending: false }),
    ]);

    const { PLANS } = require('../config/plans');

    // MRR: suma de precios de planes de negocios activos
    const mrr = (businesses || []).reduce((sum, b) => {
      const precio = PLANS[b.plan]?.price || 0;
      return sum + precio;
    }, 0);

    const ingresosTotal = (pagosAprobados || []).reduce((s, p) => s + Number(p.amount), 0) / 100;
    const ingresosMes = (pagosMes || []).reduce((s, p) => s + Number(p.amount), 0) / 100;

    // Egresos del mes (convertir todo a COP, asumir 1 USD = 4000 COP para simplicidad)
    const TASA_USD = 4000;
    const egresosMesTotal = (egresosMes || []).reduce((s, e) => {
      const amount = Number(e.amount);
      return s + (e.currency === 'USD' ? amount * TASA_USD : amount);
    }, 0);

    const utilidadMes = ingresosMes - egresosMesTotal;

    // Histórico mensual (últimos 6 meses)
    const trendMap = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      trendMap[key] = { month: key, ingresos: 0 };
    }
    (pagosAño || []).forEach(p => {
      const key = p.created_at.slice(0,7);
      if (trendMap[key]) trendMap[key].ingresos += Number(p.amount) / 100;
    });

    // Egresos totales recurrentes mensuales (para proyección)
    const egresosRecurrentes = (egresos || [])
      .filter(e => e.recurring)
      .reduce((s, e) => {
        const amount = Number(e.amount);
        return s + (e.currency === 'USD' ? amount * TASA_USD : amount);
      }, 0);

    return res.json({
      success: true,
      data: {
        mrr,
        ingresos_total: Math.round(ingresosTotal),
        ingresos_mes: Math.round(ingresosMes),
        egresos_mes: Math.round(egresosMesTotal),
        egresos_recurrentes_mes: Math.round(egresosRecurrentes),
        utilidad_mes: Math.round(utilidadMes),
        negocios_activos: businesses?.length || 0,
        meta_mensual: goalData?.value?.amount || 10000000,
        trend: Object.values(trendMap),
        pagos_recientes: (pagosAprobados || []).slice(0, 15).map(p => ({
          business_name: p.businesses?.name || 'Desconocido',
          plan: p.plan,
          amount: Math.round(Number(p.amount) / 100),
          created_at: p.created_at
        })),
        egresos: (egresos || []).map(e => ({
          ...e,
          amount_cop: e.currency === 'USD' ? Math.round(Number(e.amount) * TASA_USD) : Number(e.amount)
        })),
        mes_consultado: mesConsulta,
        ingresos_mes_consultado: Math.round((pagosMesConsulta || []).reduce((s,p) => s + Number(p.amount), 0) / 100),
        pagos_mes_consultado: (pagosMesConsulta || []).map(p => ({
          business_name: p.businesses?.name || 'Desconocido',
          plan: p.plan,
          amount: Math.round(Number(p.amount) / 100),
          created_at: p.created_at
        })),
        egresos_mes_consultado: (egresosMesConsulta || []).map(e => ({
          ...e,
          amount_cop: e.currency === 'USD' ? Math.round(Number(e.amount) * 4000) : Number(e.amount)
        })),
        egresos_total_mes_consultado: Math.round((egresosMesConsulta || []).reduce((s,e) => {
          const amount = Number(e.amount);
          return s + (e.currency === 'USD' ? amount * 4000 : amount);
        }, 0)),
      }
    });
  } catch (err) {
    logger.error(`admin.getCaja: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function createExpense(req, res) {
  try {
    const { category, description, amount, currency, recurring, date } = req.body;

    if (!category || !amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Categoría y monto son requeridos.' });
    }

    const { data, error } = await supabaseAdmin
      .from('zita_expenses')
      .insert({
        category,
        description: description || null,
        amount,
        currency: currency || 'USD',
        recurring: !!recurring,
        date: date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, data });
  } catch (err) {
    logger.error(`admin.createExpense: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function deleteExpense(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin.from('zita_expenses').delete().eq('id', id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    logger.error(`admin.deleteExpense: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function updateZitaGoal(req, res) {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Meta inválida.' });
    }
    const { error } = await supabaseAdmin
      .from('zita_settings')
      .upsert({ key: 'monthly_goal', value: { amount }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return res.json({ success: true, data: { amount } });
  } catch (err) {
    logger.error(`admin.updateZitaGoal: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getLeads(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('contact_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const leads = data || [];
    const stats = {
      total: leads.length,
      pending: leads.filter(l => l.status === 'pending').length,
      contacted: leads.filter(l => l.status === 'contacted').length,
      closed: leads.filter(l => l.status === 'closed').length,
      lost: leads.filter(l => l.status === 'lost').length,
    };

    return res.json({ success: true, data: { leads, stats } });
  } catch (err) {
    logger.error(`admin.getLeads: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function updateLeadStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'contacted', 'closed', 'lost'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Estado no válido.' });
    }

    const { data, error } = await supabaseAdmin
      .from('contact_requests')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`admin.updateLeadStatus: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = {
  getMetrics,
  getBusinesses,
  getBusinessDetail,
  updateBusiness,
  getConversationDetail,
  getNotifications,
  markNotificationRead,
  changePlan,
  getCaja,
  createExpense,
  deleteExpense,
  updateZitaGoal,
  getLeads,
  updateLeadStatus,
};
