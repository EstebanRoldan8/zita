// Reglas de revalidación de la bolsa (puras, sin React). Nunca lanzan por datos faltantes.
import { asArray, asNumber } from './safe';

export const BLOCKING_TYPES = ['gone', 'soldout', 'qty', 'error'];
const GONE = { type: 'gone', text: 'Este producto ya no está disponible.' };

// result: { isError, error, data } de react-query (o undefined si no hay consulta).
// Devuelve el aviso de la línea o null si está bien o aún no hay datos.
export function evaluateLine(line, result) {
  if (!line || !result) return null;

  if (result.isError) {
    const gone = result.error?.notAvailable || [400, 404].includes(result.error?.response?.status);
    return gone ? GONE : { type: 'error', text: 'No pudimos revisar este producto.' };
  }

  // Sin datos todavía (cargando o consulta deshabilitada): no hay nada que revisar
  const p = result.data;
  if (!p || typeof p !== 'object') return null;

  const variants = asArray(p.variants);
  let maxQty;
  if (line.variant_id) {
    const v = variants.find((x) => x && x.id === line.variant_id);
    if (!v) return { type: 'gone', text: 'Esta talla o color ya no está disponible.' };
    if (!v.available) return { type: 'soldout', text: 'Esta talla o color se agotó.' };
    maxQty = asNumber(v.max_qty, 0);
  } else {
    // El producto pasó a tener variantes: hay que volver a elegir talla/color
    if (variants.length > 0) return { type: 'gone', text: 'Este producto cambió: vuelve a elegir talla y color.' };
    if (!p.in_stock) return { type: 'soldout', text: 'Este producto se agotó.' };
    maxQty = p.max_qty == null ? null : asNumber(p.max_qty, 0);
  }

  const price = Number(p.price);
  const validPrice = Number.isFinite(price);
  if (maxQty != null && maxQty <= 0) return { type: 'soldout', text: 'Este producto se agotó.' };
  const extra = maxQty != null ? { maxQty, price: validPrice ? price : line.price } : {};
  if (maxQty != null && line.quantity > maxQty) return { type: 'qty', text: `Solo quedan ${maxQty} disponibles.`, ...extra };
  if (validPrice && price !== Number(line.price)) return { type: 'price', text: 'El precio cambió.', ...extra, price };
  return maxQty != null ? extra : null;
}

// lines: líneas de la bolsa; resultsById: { [product_id]: result }
export function evaluateBag(lines, resultsById) {
  const issues = {};
  for (const line of asArray(lines)) {
    if (!line || typeof line.product_id !== 'string') continue;
    const issue = evaluateLine(line, resultsById?.[line.product_id]);
    if (issue) issues[line.key] = issue;
  }
  const blocking = Object.values(issues).some((i) => BLOCKING_TYPES.includes(i.type));
  return { issues, blocking };
}

// Producto sin forma válida (respuesta vacía o inesperada): se trata como "ya no disponible"
export function assertProduct(data) {
  if (data && typeof data === 'object' && data.id) return data;
  const err = new Error('producto_no_disponible');
  err.notAvailable = true;
  throw err;
}
