// Categorías de Caja y el reparto de egresos entre costo de ventas y egresos operativos. Única regla para el
// resumen de Caja, el PDF, el Excel y el asistente de tienda (que lee el mismo resumen del controlador).

const INCOME_CATEGORIES = ['servicios', 'productos', 'otro'];
const EXPENSE_CATEGORIES = ['nomina', 'materias_primas', 'servicios', 'arriendo', 'otro'];

// Costo de ventas: el egreso automático 'costo_producto' (ventas rápidas y barbería) y el costo que registra un
// pedido de tienda pagado (categoría 'productos' con order_id; ver utils/orderAccounting.js).
function isCostOfSales(expense) {
  if (!expense) return false;
  return expense.category === 'costo_producto' || (expense.category === 'productos' && !!expense.order_id);
}

// { costoVentas, egresosOperativos } de una lista de egresos { amount, category, order_id }
function splitExpenses(rows) {
  let costoVentas = 0;
  let egresosOperativos = 0;
  for (const r of rows || []) {
    const amount = Number(r.amount) || 0;
    if (isCostOfSales(r)) costoVentas += amount; else egresosOperativos += amount;
  }
  return { costoVentas, egresosOperativos };
}

// Al editar un egreso: las categorías del panel, o la que ya tenía si es automática (costo_producto / productos).
function isValidExpenseCategory(category, current) {
  return EXPENSE_CATEGORIES.includes(category) || (!!current && category === current.category && ['costo_producto', 'productos'].includes(category));
}

module.exports = { INCOME_CATEGORIES, EXPENSE_CATEGORIES, isCostOfSales, splitExpenses, isValidExpenseCategory };
