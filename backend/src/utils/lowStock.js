const DEFAULT_VARIANT_MIN_STOCK = 2;

function variantLabel(attributes) {
  return Object.entries(attributes || {})
    .map(([k, v]) => `${k.charAt(0).toUpperCase()}${k.slice(1)} ${v}`)
    .join(' / ') || 'Variante';
}

// Devuelve los productos en stock bajo. Sin variantes: stock <= min_stock (igual que antes).
// Con variantes: además del total, cada variante activa se compara contra su propio min_stock,
// y basta con que una esté baja para incluir el producto. low_variants trae el detalle.
async function findLowStock(client, businessId, products) {
  const withVariants = (products || []).filter((p) => p.has_variants).map((p) => p.id);

  const variantsByProduct = {};
  if (withVariants.length > 0) {
    const { data: variants, error } = await client
      .from('product_variants')
      .select('id, product_id, attributes, stock, min_stock')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .in('product_id', withVariants);
    if (error) throw error;
    for (const v of variants || []) {
      (variantsByProduct[v.product_id] ||= []).push(v);
    }
  }

  const result = [];
  for (const p of products || []) {
    const totalLow = p.stock <= p.min_stock;
    if (!p.has_variants) {
      if (totalLow) result.push({ ...p, low_variants: [] });
      continue;
    }
    const lowVariants = (variantsByProduct[p.id] || [])
      .filter((v) => v.stock <= (v.min_stock ?? DEFAULT_VARIANT_MIN_STOCK))
      .map((v) => ({
        id: v.id,
        attributes: v.attributes,
        label: variantLabel(v.attributes),
        stock: v.stock,
        min_stock: v.min_stock ?? DEFAULT_VARIANT_MIN_STOCK,
      }));
    if (totalLow || lowVariants.length > 0) result.push({ ...p, low_variants: lowVariants });
  }
  return result;
}

module.exports = { findLowStock };
