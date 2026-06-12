const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');
const { getTimezone, getOffsetForTz } = require('../utils/timezone');

function monthRange(tz = 'America/Bogota') {
  const offset   = getOffsetForTz(tz);
  const todayCol = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const [y, m]   = todayCol.slice(0, 7).split('-').map(Number);
  const lastDay  = new Date(y, m, 0).getDate();
  return {
    start: `${todayCol.slice(0, 7)}-01T00:00:00${offset}`,
    end:   `${todayCol.slice(0, 7)}-${String(lastDay).padStart(2, '0')}T23:59:59${offset}`,
  };
}

function daysAgoISO(days, tz = 'America/Bogota') {
  const offset = getOffsetForTz(tz);
  const d = new Date();
  d.setDate(d.getDate() - days);
  const dateCol = d.toLocaleDateString('en-CA', { timeZone: tz });
  return `${dateCol}T00:00:00${offset}`;
}

async function overview(req, res) {
  try {
    const userClient = createUserClient(req.headers.authorization);
    const tz = getTimezone(req.business?.country);
    const { start, end } = monthRange(tz);
    const startDate = start.slice(0, 10);
    const endDate   = end.slice(0, 10);

    const [
      { data: incomeData },
      { data: expensesData },
      { data: allAppts },
      { data: waAppts },
      { count: totalClients },
      { count: newClients },
    ] = await Promise.all([
      userClient
        .from('income')
        .select('amount')
        .eq('business_id', req.businessId)
        .gte('date', startDate)
        .lte('date', endDate),

      userClient
        .from('expenses')
        .select('amount')
        .eq('business_id', req.businessId)
        .gte('date', startDate)
        .lte('date', endDate),

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

    const ingresos_mes       = (incomeData   || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const total_egresos_mes  = (expensesData || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const utilidad_neta_mes  = ingresos_mes - total_egresos_mes;

    return res.json({
      success: true,
      data: {
        total_income: ingresos_mes,
        ingresos_mes,
        total_egresos_mes,
        utilidad_neta_mes,
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
    const tz = getTimezone(req.business?.country);
    const period = req.query.period === 'month' ? 30 : 7;
    const since = daysAgoISO(period, tz);

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
    const tz = getTimezone(req.business?.country);
    const since30days = daysAgoISO(30, tz);

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

    const tz = getTimezone(req.business?.country);
    const offset = getOffsetForTz(tz);
    let start, end;
    const dateParam = req.query.date;
    const monthParam = req.query.month;

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      start = `${dateParam}T00:00:00${offset}`;
      end   = `${dateParam}T23:59:59${offset}`;
    } else if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number);
      start = `${monthParam}-01T00:00:00${offset}`;
      end   = `${new Date(y, m, 0).toISOString().slice(0, 10)}T23:59:59${offset}`;
    } else {
      ({ start, end } = monthRange(tz));
    }

    const todayCol   = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const todayStart = `${todayCol}T00:00:00${offset}`;
    const todayEnd   = `${todayCol}T23:59:59${offset}`;

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
    const tz = getTimezone(req.business?.country);
    const since = daysAgoISO(30, tz);

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
    const tz = getTimezone(req.business?.country);
    const offset = getOffsetForTz(tz);

    const todayCol = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const [cy, cm] = todayCol.slice(0, 7).split('-').map(Number);
    const thisMonthStart = `${todayCol.slice(0, 7)}-01T00:00:00${offset}`;
    const lastMonthDate  = new Date(cy, cm - 2, 1);
    const lastMonthStr   = lastMonthDate.toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7);
    const lastMonthStart = `${lastMonthStr}-01T00:00:00${offset}`;
    const lastMonthEnd   = `${todayCol.slice(0, 7)}-01T00:00:00${offset}`;
    const sixMonthsAgoDate = new Date(cy, cm - 6, 1);
    const sixMonthsAgoStr  = sixMonthsAgoDate.toLocaleDateString('en-CA', { timeZone: tz }).slice(0, 7);
    const sixMonthsAgo   = `${sixMonthsAgoStr}-01T00:00:00${offset}`;
    const days30 = daysAgoISO(30, tz);
    const days90 = daysAgoISO(90, tz);

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
      const nowDate = new Date();
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
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
