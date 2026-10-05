const { createUserClient } = require('../config/supabase');
const logger = require('../utils/logger');
const { getTimezone } = require('../utils/timezone');
const { findLowStock } = require('../utils/lowStock');
const { getTopSellers } = require('../utils/topSellers');

// Ventas = ingresos generados por una venta del panel/asistente o por un pedido pagado.
// Cada venta produce un solo ingreso, así que contar filas de income no duplica.
const SALE_SOURCES = ['product_sale', 'order'];
const NOT_CANCELLED = 'status.is.null,status.neq.cancelado';

// GET /api/dashboard/tienda — todo el dashboard de tienda en una sola respuesta (solo lectura)
async function tiendaSummary(req, res) {
  try {
    const sb = createUserClient(req.headers.authorization);
    const tz = getTimezone(req.business?.country);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const [y, m] = today.split('-').map(Number);
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthEnd = `${today.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: todaySales, error: e1 },
      { data: monthIncome, error: e2 },
      { data: monthExpenses, error: e3 },
      { data: unpaid, error: e4 },
      { data: toShip, error: e5 },
      { data: recent, error: e6 },
      { data: products, error: e7 },
    ] = await Promise.all([
      sb.from('income').select('amount')
        .eq('business_id', req.businessId).eq('date', today).in('source', SALE_SOURCES),
      sb.from('income').select('amount')
        .eq('business_id', req.businessId).gte('date', monthStart).lte('date', monthEnd),
      sb.from('expenses').select('amount')
        .eq('business_id', req.businessId).gte('date', monthStart).lte('date', monthEnd),
      sb.from('orders').select('total_amount')
        .eq('business_id', req.businessId).eq('payment_status', 'pendiente').or(NOT_CANCELLED),
      sb.from('orders').select('id')
        .eq('business_id', req.businessId).eq('payment_status', 'pagado')
        .or('status.is.null,status.not.in.(enviado,entregado,cancelado)'),
      sb.from('orders').select('id, client_name, total_amount, status, payment_status, created_at')
        .eq('business_id', req.businessId).order('created_at', { ascending: false }).limit(5),
      sb.from('products').select('id, name, stock, min_stock, has_variants')
        .eq('business_id', req.businessId).eq('is_active', true),
    ]);
    const firstError = e1 || e2 || e3 || e4 || e5 || e6 || e7;
    if (firstError) throw firstError;

    const sum = (rows, field) => (rows || []).reduce((s, r) => s + Number(r[field] || 0), 0);
    const incomeMonth = sum(monthIncome, 'amount');
    const expensesMonth = sum(monthExpenses, 'amount');

    const productList = products || [];
    const lowList = await findLowStock(sb, req.businessId, productList);
    const outOfStock = productList.filter((p) => (Number(p.stock) || 0) === 0).length;
    const lowCount = lowList.filter((p) => (Number(p.stock) || 0) > 0).length;
    // Primero los agotados, luego los de menor stock
    const stockAlerts = [...lowList]
      .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0))
      .slice(0, 5)
      .map((p) => ({ id: p.id, name: p.name, stock: p.stock, min_stock: p.min_stock, low_variants: p.low_variants }));

    const topSellers = await getTopSellers(sb, req.businessId, since30, Object.fromEntries(productList.map((p) => [p.id, p.name])));

    return res.json({
      success: true,
      data: {
        date: today,
        sales_today: { amount: sum(todaySales, 'amount'), count: (todaySales || []).length },
        income_month: incomeMonth,
        expenses_month: expensesMonth,
        net_month: incomeMonth - expensesMonth,
        unpaid_orders: { count: (unpaid || []).length, amount: sum(unpaid, 'total_amount') },
        to_ship_count: (toShip || []).length,
        stock_alerts: { out_of_stock: outOfStock, low: lowCount, items: stockAlerts },
        recent_orders: recent || [],
        top_sellers: topSellers,
      },
    });
  } catch (err) {
    logger.error('dashboard.tiendaSummary: ' + err.message);
    return res.status(500).json({ success: false, error: 'Error al obtener el resumen del dashboard.' });
  }
}

module.exports = { tiendaSummary };
