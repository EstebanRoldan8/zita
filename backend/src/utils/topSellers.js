// Más vendidos: suma de quantity en product_sales desde `since` (ISO), top `limit` productos.
// knownNames: { [productId]: name } para evitar consultar nombres ya conocidos.
async function getTopSellers(client, businessId, since, knownNames = {}, limit = 5) {
  const { data: sales, error } = await client
    .from('product_sales')
    .select('product_id, quantity')
    .eq('business_id', businessId)
    .gte('created_at', since)
    .limit(10000);
  if (error) throw error;

  const unitsByProduct = {};
  for (const s of sales || []) {
    unitsByProduct[s.product_id] = (unitsByProduct[s.product_id] || 0) + (Number(s.quantity) || 0);
  }
  const nameById = { ...knownNames };
  const topIds = Object.entries(unitsByProduct).sort((a, b) => b[1] - a[1]).slice(0, limit);
  const missingNames = topIds.map(([pid]) => pid).filter((pid) => !nameById[pid]);
  if (missingNames.length > 0) {
    // Productos inactivos que igual vendieron en el período
    const { data: extra } = await client.from('products').select('id, name').in('id', missingNames);
    for (const p of extra || []) nameById[p.id] = p.name;
  }
  return topIds.map(([pid, units]) => ({ product_id: pid, name: nameById[pid] || 'Producto eliminado', units }));
}

module.exports = { getTopSellers };
