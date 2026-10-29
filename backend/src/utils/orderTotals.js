// Datos de cliente opcionales y descuento en pesos de un pedido manual.
// Lo recibe el cliente, pero el servidor decide: el total nunca se toma del body.

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const NAME_MAX = 120;
const PHONE_MAX = 30;

function cleanText(value) {
  return String(value).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

// Nombre y teléfono son opcionales: vacío o ausente = sin dato. Si vienen, se sanitizan y se limitan.
function parseCustomer(body = {}) {
  const out = {};
  for (const [key, max, label] of [['client_name', NAME_MAX, 'El nombre'], ['client_phone', PHONE_MAX, 'El teléfono']]) {
    const raw = body[key];
    if (raw === undefined || raw === null || raw === '') { out[key] = null; continue; }
    if (typeof raw !== 'string') return { error: `${label} del cliente debe ser texto.` };
    const text = cleanText(raw);
    if (text.length > max) return { error: `${label} del cliente no puede superar ${max} caracteres.` };
    out[key] = text || null;
  }
  return { customer: out };
}

// Descuento en pesos: entero >= 0 y <= tope (por defecto el subtotal). Ausente o vacío = 0.
function parseDiscount(value, subtotal, maxLabel = 'el subtotal del pedido') {
  if (value === undefined || value === null || value === '') return { discount: 0 };
  const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { error: 'El descuento debe ser un número entero de pesos.' };
  if (n < 0) return { error: 'El descuento no puede ser negativo.' };
  if (n > subtotal) return { error: `El descuento no puede ser mayor que ${maxLabel}.` };
  return { discount: n };
}

// total = subtotal + envío − descuento; todo calculado aquí con los precios ya resueltos por el servidor
function computeTotals(items, { shipping = 0, discount = 0 } = {}) {
  const subtotal = items.reduce((sum, i) => sum + (Number(i.quantity) * Number(i.unit_price)), 0);
  return { subtotal, shipping, discount, total: subtotal + shipping - discount };
}

module.exports = { parseCustomer, parseDiscount, computeTotals };
