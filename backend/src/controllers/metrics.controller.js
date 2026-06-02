const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');

function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
  return { start, end };
}

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function overview(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const { start, end } = monthRange();

    const [
      { data: completedAppts },
      { data: allAppts },
      { data: waAppts },
      { count: totalClients },
      { count: newClients },
    ] = await Promise.all([
      userClient
        .from('appointments')
        .select('price, is_reward')
        .eq('business_id', req.businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', start)
        .lte('scheduled_at', end),

      userClient
        .from('appointments')
        .select('id')
        .eq('business_id', req.businessId)
        .gte('scheduled_at', start)
        .lte('scheduled_at', end)
        .neq('status', 'cancelled'),

      userClient
        .from('appointments')
        .select('id')
        .eq('business_id', req.businessId)
        .eq('source', 'whatsapp')
        .gte('scheduled_at', start)
        .lte('scheduled_at', end),

      userClient
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', req.businessId),

      userClient
        .from('clients')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', req.businessId)
        .gte('created_at', start)
        .lte('created_at', end),
    ]);

    const total_income = (completedAppts || []).reduce((sum, a) => sum + (a.is_reward ? 0 : (a.price || 0)), 0);

    return res.json({
      success: true,
      data: {
        total_income,
        total_appointments: (allAppts || []).length,
        total_clients: totalClients || 0,
        whatsapp_appointments: (waAppts || []).length,
        new_clients_this_month: newClients || 0,
      },
    });
  } catch (err) {
    logger.error(`metrics.overview: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function appointments(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const period = req.query.period === 'month' ? 30 : 7;
    const since = daysAgoISO(period);

    const { data, error } = await userClient
      .from('appointments')
      .select('scheduled_at, status, price, is_reward')
      .eq('business_id', req.businessId)
      .gte('scheduled_at', since)
      .order('scheduled_at');

    if (error) throw error;

    // Agrupar por día en JS
    const grouped = {};
    for (const appt of data || []) {
      const day = appt.scheduled_at.slice(0, 10);
      if (!grouped[day]) grouped[day] = { date: day, count: 0, income: 0 };
      grouped[day].count += 1;
      if (appt.status === 'completed') {
        // Citas de recompensa cuentan en el total pero con ingresos = $0
        grouped[day].income += appt.is_reward ? 0 : (appt.price || 0);
      }
    }

    return res.json({ success: true, data: Object.values(grouped) });
  } catch (err) {
    logger.error(`metrics.appointments: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function clients(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const since30days = daysAgoISO(30);

    const [
      { data: topClients },
      { data: allClients },
      { data: recentAppts },
      { data: frequentClients },
    ] = await Promise.all([
      userClient
        .from('clients')
        .select('id, name, phone, total_spent, visits_count')
        .eq('business_id', req.businessId)
        .order('total_spent', { ascending: false })
        .limit(5),

      userClient
        .from('clients')
        .select('id, name, phone, total_spent, visits_count')
        .eq('business_id', req.businessId),

      userClient
        .from('appointments')
        .select('client_id')
        .eq('business_id', req.businessId)
        .gte('scheduled_at', since30days),

      userClient
        .from('clients')
        .select('id, name, phone, total_spent, visits_count')
        .eq('business_id', req.businessId)
        .gte('visits_count', 3)
        .order('visits_count', { ascending: false }),
    ]);

    const recentClientIds = new Set((recentAppts || []).map((a) => a.client_id));
    const inactive_clients = (allClients || []).filter((c) => !recentClientIds.has(c.id));

    return res.json({
      success: true,
      data: {
        top_clients: topClients || [],
        inactive_clients,
        frequent_clients: frequentClients || [],
      },
    });
  } catch (err) {
    logger.error(`metrics.clients: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function employeeMetrics(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);

    let start, end;
    const dateParam = req.query.date; // YYYY-MM-DD
    const monthParam = req.query.month; // YYYY-MM

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const [y, m, d] = dateParam.split('-').map(Number);
      start = `${dateParam}T00:00:00-05:00`;
      end = `${dateParam}T23:59:59-05:00`;
    } else if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number);
      start = new Date(y, m - 1, 1).toISOString();
      end = new Date(y, m, 0, 23, 59, 59, 999).toISOString();
    } else {
      ({ start, end } = monthRange());
    }

    const todayCol = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const todayStart = `${todayCol}T00:00:00-05:00`;
    const todayEnd = `${todayCol}T23:59:59-05:00`;

    const [{ data: employees, error: empErr }, { data: appts, error: apptErr }, { data: todayAppts, error: todayErr }] = await Promise.all([
      userClient
        .from('employees')
        .select('id, name, commission_percent')
        .eq('business_id', req.businessId)
        .eq('is_active', true)
        .order('name'),

      userClient
        .from('appointments')
        .select('id, price, employee_id, is_reward')
        .eq('business_id', req.businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', start)
        .lte('scheduled_at', end),

      userClient
        .from('appointments')
        .select('id, price, employee_id, is_reward')
        .eq('business_id', req.businessId)
        .eq('status', 'completed')
        .gte('scheduled_at', todayStart)
        .lt('scheduled_at', todayEnd),
    ]);

    if (empErr) throw empErr;
    if (apptErr) throw apptErr;
    if (todayErr) throw todayErr;

    // totalIncome: excluye citas de recompensa (el negocio no cobró)
    const totalIncome = (appts || []).reduce((sum, a) => sum + (a.is_reward ? 0 : (Number(a.price) || 0)), 0);

    const empMap = Object.fromEntries(
      (employees || []).map((e) => [e.id, { id: e.id, name: e.name, commission_percent: e.commission_percent || 10, count: 0, income: 0, commission_period: 0, commission_today: 0 }])
    );

    // Ingresos y comisiones del período
    for (const a of appts || []) {
      if (a.employee_id && empMap[a.employee_id]) {
        const emp = empMap[a.employee_id];
        emp.count += 1;
        const appointmentPrice = Number(a.price) || 0;
        emp.income += appointmentPrice;
        const commissionForAppointment = appointmentPrice * (emp.commission_percent / 100);
        emp.commission_period += commissionForAppointment;
      }
    }

    // Comisiones del día
    for (const a of todayAppts || []) {
      if (a.employee_id && empMap[a.employee_id]) {
        const emp = empMap[a.employee_id];
        const appointmentPrice = Number(a.price) || 0;
        const commissionForAppointment = appointmentPrice * (emp.commission_percent / 100);
        emp.commission_today += commissionForAppointment;
      }
    }

    const data = Object.values(empMap).map((e) => ({
      ...e,
      avg_per_appt: e.count > 0 ? e.income / e.count : 0,
      pct_of_total: totalIncome > 0 ? (e.income / totalIncome) * 100 : 0,
    }));

    return res.json({ success: true, data });
  } catch (err) {
    logger.error(`metrics.employeeMetrics: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getHeatmap(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const since = daysAgoISO(30);

    const { data, error } = await userClient
      .from('appointments')
      .select('scheduled_at')
      .eq('business_id', req.businessId)
      .eq('status', 'completed')
      .gte('scheduled_at', since);

    if (error) throw error;

    const matrix = {};
    for (const appt of data || []) {
      const d = new Date(appt.scheduled_at);
      const key = `${d.getDay()}-${d.getHours()}`;
      matrix[key] = (matrix[key] || 0) + 1;
    }

    const result = Object.entries(matrix).map(([key, count]) => {
      const [day, hour] = key.split('-').map(Number);
      return { day, hour, count };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`metrics.getHeatmap: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

async function getRetention(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const now = new Date();

    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const lastMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).toISOString();
    const sixMonthsAgo   = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
    const days30         = daysAgoISO(30);
    const days90         = daysAgoISO(90);

    const [
      { count: newThisMonth },
      { data: lastMonthAppts },
      { data: thisMonthAppts },
      { data: riskWindowAppts },
      { data: recentAppts },
      { data: sixMonthAppts },
      { data: sixMonthClients },
    ] = await Promise.all([
      userClient.from('clients').select('*', { count: 'exact', head: true })
        .eq('business_id', req.businessId).gte('created_at', thisMonthStart),

      userClient.from('appointments').select('client_id')
        .eq('business_id', req.businessId)
        .gte('scheduled_at', lastMonthStart).lte('scheduled_at', lastMonthEnd),

      userClient.from('appointments').select('client_id')
        .eq('business_id', req.businessId).gte('scheduled_at', thisMonthStart),

      // appointments 30-90 days ago (risk window)
      userClient.from('appointments').select('client_id')
        .eq('business_id', req.businessId)
        .gte('scheduled_at', days90).lt('scheduled_at', days30),

      // appointments in last 30 days
      userClient.from('appointments').select('client_id')
        .eq('business_id', req.businessId).gte('scheduled_at', days30),

      // all appointments in last 6 months for trend
      userClient.from('appointments').select('client_id, scheduled_at')
        .eq('business_id', req.businessId).gte('scheduled_at', sixMonthsAgo),

      // clients created in last 6 months (for new vs returning categorization)
      userClient.from('clients').select('id, created_at')
        .eq('business_id', req.businessId).gte('created_at', sixMonthsAgo),
    ]);

    // Retention rate
    const lastMonthIds = new Set((lastMonthAppts || []).map((a) => a.client_id));
    const thisMonthIds = new Set((thisMonthAppts || []).map((a) => a.client_id));
    const returned = [...lastMonthIds].filter((id) => thisMonthIds.has(id)).length;
    const retention_rate = lastMonthIds.size > 0
      ? Math.round((returned / lastMonthIds.size) * 1000) / 10
      : 0;

    // At-risk clients (had appointment 30-90 days ago, not in last 30)
    const riskIds = [...new Set((riskWindowAppts || []).map((a) => a.client_id))];
    const recentIds = new Set((recentAppts || []).map((a) => a.client_id));
    const atRiskIds = riskIds.filter((id) => !recentIds.has(id));

    let at_risk_clients = [];
    if (atRiskIds.length > 0) {
      const { data: rcd } = await userClient
        .from('clients').select('id, name, phone')
        .in('id', atRiskIds.slice(0, 20));
      at_risk_clients = rcd || [];
    }

    // Monthly trend — unique clients per category per month
    const clientCreatedMap = Object.fromEntries(
      (sixMonthClients || []).map((c) => [c.id, c.created_at])
    );

    const trendMap = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      trendMap[key] = { month: key, new_clients: new Set(), returning: new Set() };
    }

    for (const appt of sixMonthAppts || []) {
      const apptMonth = appt.scheduled_at.slice(0, 7);
      if (!trendMap[apptMonth]) continue;
      const createdAt = clientCreatedMap[appt.client_id];
      const createdMonth = createdAt ? createdAt.slice(0, 7) : null;
      if (createdMonth === apptMonth) {
        trendMap[apptMonth].new_clients.add(appt.client_id);
      } else {
        trendMap[apptMonth].returning.add(appt.client_id);
      }
    }

    const monthly_trend = Object.values(trendMap).map((m) => ({
      month: m.month,
      new_clients: m.new_clients.size,
      returning: m.returning.size,
    }));

    return res.json({
      success: true,
      data: {
        retention_rate,
        new_clients: newThisMonth || 0,
        returned_clients: returned,
        last_month_total: lastMonthIds.size,
        at_risk_clients,
        monthly_trend,
      },
    });
  } catch (err) {
    logger.error(`metrics.getRetention: ${err.message}`);
    return res.status(500).json({ success: false, error: 'Error interno del servidor.' });
  }
}

module.exports = { overview, appointments, clients, employeeMetrics, getHeatmap, getRetention };
