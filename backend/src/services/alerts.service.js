const { supabaseAdmin } = require('../config/supabase');

function sum(arr, field) {
  return (arr || []).reduce((s, r) => s + (Number(r[field]) || 0), 0);
}

async function getAlerts(businessId) {
  const now = new Date();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd   = new Date(year, month, 0).toISOString().slice(0, 10);

  const prevMonth  = month === 1 ? 12 : month - 1;
  const prevYear   = month === 1 ? year - 1 : year;
  const prevStart  = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
  const prevEnd    = new Date(prevYear, prevMonth, 0).toISOString().slice(0, 10);

  const sevenDaysAgo  = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7);
  const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);

  const [
    { data: pendingTomorrow },
    { data: currAppts        },
    { data: prevAppts        },
    { data: currManual       },
    { data: prevManual       },
    { data: employees        },
    { data: recentEmpAppts   },
    { data: recentClientAppts},
    { data: allClients       },
    { data: currExpenses     },
    { data: monthGoal        },
    { data: allProducts      },
  ] = await Promise.all([
    supabaseAdmin
      .from('appointments').select('id')
      .eq('business_id', businessId).eq('status', 'pending')
      .gte('scheduled_at', tomorrowStr + 'T00:00:00')
      .lte('scheduled_at', tomorrowStr + 'T23:59:59'),

    supabaseAdmin
      .from('appointments').select('price')
      .eq('business_id', businessId).eq('status', 'completed')
      .gte('scheduled_at', monthStart).lte('scheduled_at', monthEnd + 'T23:59:59'),

    supabaseAdmin
      .from('appointments').select('price')
      .eq('business_id', businessId).eq('status', 'completed')
      .gte('scheduled_at', prevStart).lte('scheduled_at', prevEnd + 'T23:59:59'),

    supabaseAdmin
      .from('income').select('amount')
      .eq('business_id', businessId)
      .gte('date', monthStart).lte('date', monthEnd),

    supabaseAdmin
      .from('income').select('amount')
      .eq('business_id', businessId)
      .gte('date', prevStart).lte('date', prevEnd),

    supabaseAdmin
      .from('employees').select('id, name')
      .eq('business_id', businessId).eq('is_active', true),

    supabaseAdmin
      .from('appointments').select('employee_id')
      .eq('business_id', businessId)
      .gte('scheduled_at', sevenDaysAgo.toISOString())
      .not('employee_id', 'is', null),

    supabaseAdmin
      .from('appointments').select('client_id')
      .eq('business_id', businessId)
      .gte('scheduled_at', thirtyDaysAgo.toISOString())
      .not('client_id', 'is', null),

    supabaseAdmin
      .from('clients').select('id, name, phone, total_spent, visits_count')
      .eq('business_id', businessId).gt('visits_count', 0)
      .order('total_spent', { ascending: false }).limit(100),

    supabaseAdmin
      .from('expenses').select('amount')
      .eq('business_id', businessId)
      .gte('date', monthStart).lte('date', monthEnd),

    supabaseAdmin
      .from('monthly_goals').select('income_goal')
      .eq('business_id', businessId).eq('month', monthStart)
      .maybeSingle(),

    supabaseAdmin
      .from('products').select('id, name, stock, min_stock')
      .eq('business_id', businessId).eq('is_active', true),
  ]);

  const alerts = [];

  // 1. Citas sin confirmar mañana
  if ((pendingTomorrow || []).length > 2) {
    alerts.push({
      type: 'warning',
      code: 'UNCONFIRMED_TOMORROW',
      title: 'Citas sin confirmar mañana',
      message: `Tienes ${pendingTomorrow.length} citas pendientes de confirmar para mañana.`,
      action: 'Ir a Citas',
      actionLink: '/dashboard/citas',
    });
  }

  // 2. Caída de ingresos > 20 %
  const currIncome = sum(currAppts, 'price') + sum(currManual, 'amount');
  const prevIncome = sum(prevAppts, 'price') + sum(prevManual, 'amount');

  if (prevIncome > 0 && currIncome < prevIncome * 0.8) {
    const drop = Math.round(((prevIncome - currIncome) / prevIncome) * 100);
    alerts.push({
      type: 'critical',
      code: 'INCOME_DROP',
      title: 'Caída en ingresos',
      message: `Los ingresos de este mes son ${drop}% menores al mes anterior.`,
      action: 'Ver Caja',
      actionLink: '/dashboard/caja',
    });
  }

  // 3. Empleados sin citas en 7 días
  const activeEmpIds = new Set((recentEmpAppts || []).map((a) => a.employee_id));
  const idleEmps = (employees || []).filter((e) => !activeEmpIds.has(e.id));

  if (idleEmps.length > 0) {
    const names = idleEmps.map((e) => e.name).join(', ');
    alerts.push({
      type: 'info',
      code: 'IDLE_EMPLOYEES',
      title: 'Empleados sin actividad',
      message: `${names} no ${idleEmps.length === 1 ? 'ha tenido citas' : 'han tenido citas'} en los últimos 7 días.`,
      action: 'Ver Empleados',
      actionLink: '/dashboard/empleados',
    });
  }

  // 4. Clientes inactivos hace 30+ días (top 5)
  const recentCIds = new Set((recentClientAppts || []).map((a) => a.client_id));
  const inactive = (allClients || []).filter((c) => !recentCIds.has(c.id)).slice(0, 5);

  if (inactive.length > 0) {
    alerts.push({
      type: 'info',
      code: 'INACTIVE_CLIENTS',
      title: 'Clientes por recuperar',
      message: `${inactive.length} cliente${inactive.length > 1 ? 's' : ''} no han regresado en más de 30 días.`,
      action: 'Ver Clientes',
      actionLink: '/dashboard/clientes',
      meta: inactive,
    });
  }

  // 5. Egresos > 70% de ingresos
  const totalExpenses = sum(currExpenses, 'amount');
  if (currIncome > 0 && totalExpenses > currIncome * 0.7) {
    const pct = Math.round((totalExpenses / currIncome) * 100);
    alerts.push({
      type: 'critical',
      code: 'HIGH_EXPENSES',
      title: 'Egresos elevados',
      message: `Los egresos representan el ${pct}% de tus ingresos este mes.`,
      action: 'Ver Caja',
      actionLink: '/dashboard/caja',
    });
  }

  // 6. Meta mensual en riesgo (< 50% a mitad de mes)
  if (monthGoal?.income_goal > 0) {
    const dayOfMonth  = now.getDate();
    const daysInMonth = new Date(year, month, 0).getDate();
    if (dayOfMonth >= Math.floor(daysInMonth / 2)) {
      const goalPct = currIncome / Number(monthGoal.income_goal);
      if (goalPct < 0.5) {
        alerts.push({
          type: 'warning',
          code: 'GOAL_BEHIND',
          title: 'Meta mensual en riesgo',
          message: `Llevas el ${Math.round(goalPct * 100)}% de tu meta y ya pasó la mitad del mes.`,
          action: 'Ver Caja',
          actionLink: '/dashboard/caja',
        });
      }
    }
  }

  // 7. Productos con stock bajo o agotado
  const lowStockProducts = (allProducts || []).filter((p) => p.stock <= p.min_stock);
  if (lowStockProducts.length > 0) {
    const outOfStock = lowStockProducts.filter((p) => p.stock === 0);
    const type = outOfStock.length > 0 ? 'critical' : 'warning';
    const names = lowStockProducts.slice(0, 3).map((p) => p.name).join(', ');
    const extra = lowStockProducts.length > 3 ? ` y ${lowStockProducts.length - 3} más` : '';
    alerts.push({
      type,
      code: 'LOW_STOCK',
      title: outOfStock.length > 0 ? 'Productos agotados' : 'Stock bajo en productos',
      message: `${names}${extra} ${lowStockProducts.length === 1 ? 'tiene' : 'tienen'} stock bajo o agotado.`,
      action: 'Ver Productos',
      actionLink: '/dashboard/productos',
    });
  }

  return alerts;
}

module.exports = { getAlerts };
