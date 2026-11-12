// Comisiones por empleado sobre citas completadas. Fuente única para Analíticas/Empleados (dueño),
// el asistente IA y "Mis comisiones" (empleado), para que todos vean el mismo número.

// Porcentaje de comisión del empleado: 0 es un valor válido (no se reemplaza por un default).
function commissionPercent(employee) {
  const raw = employee?.commission_percent;
  if (raw === null || raw === undefined || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// employees: [{ id, name, commission_percent }]
// periodAppts / todayAppts: citas completadas [{ employee_id, price }]
// Devuelve un mapa id → { id, name, commission_percent, count, income, commission_period, commission_today }
function computeEmployeeCommissions(employees, periodAppts, todayAppts) {
  const empMap = Object.fromEntries(
    (employees || []).map((e) => [e.id, {
      id: e.id, name: e.name, commission_percent: commissionPercent(e),
      count: 0, income: 0, commission_period: 0, commission_today: 0,
    }]),
  );

  for (const a of periodAppts || []) {
    const emp = a.employee_id && empMap[a.employee_id];
    if (!emp) continue;
    const price = Number(a.price) || 0;
    emp.count += 1;
    emp.income += price;
    emp.commission_period += price * (emp.commission_percent / 100);
  }

  for (const a of todayAppts || []) {
    const emp = a.employee_id && empMap[a.employee_id];
    if (!emp) continue;
    const price = Number(a.price) || 0;
    emp.commission_today += price * (emp.commission_percent / 100);
  }

  return empMap;
}

module.exports = { commissionPercent, computeEmployeeCommissions };
