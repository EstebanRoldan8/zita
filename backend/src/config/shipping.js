// Envío de la tienda pública: único lugar con la regla de cálculo y la normalización de ciudad.
// Los VALORES (tarifas, ciudad local, "gratis desde") viven por negocio en businesses.store_settings:
//   shipping_flat_cost   tarifa nacional (y tarifa única si el negocio no define shipping_local_cost)
//   shipping_local_cost  tarifa en la ciudad local (opcional)
//   shipping_local_city  ciudad local (opcional; por defecto DEFAULTS.localCity)
//   free_shipping_from   subtotal de productos desde el que el envío es gratis (0 = nunca)
const DEFAULTS = { localCity: 'cali' };

const ZONE_LOCAL = 'cali';
const ZONE_NATIONAL = 'nacional';

// "  Santiago de  CALÍ " → "cali" (minúsculas, sin tildes ni signos, espacios simples).
// Cali también se reconoce con complementos: "Cali Valle", "Santiago de Cali Valle del Cauca Colombia"...
// (empieza por "cali" o "santiago de cali" como palabra completa: "Calima" y "Caliente" no son Cali).
function normalizeCity(value) {
  const base = String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(santiago de )?cali( |$)/.test(base) ? 'cali' : base;
}

// ¿La ciudad del cliente es la ciudad local? Una ciudad (o una ciudad local) que se normaliza a vacío
// nunca coincide.
function isLocalCity(city, localCity) {
  const c = normalizeCity(city);
  const l = normalizeCity(localCity);
  return c !== '' && l !== '' && (c === l || c.startsWith(`${l} `));
}

const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
// shipping_local_cost ausente, vacío o inválido = el negocio no tiene tarifa local
const hasLocalCost = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;

// → { zone: 'cali' | 'nacional', cost }. El subtotal es solo de productos (sin envío).
function calculateShipping({ subtotal, city, settings = {} }) {
  const flat = money(settings.shipping_flat_cost);
  const freeFrom = money(settings.free_shipping_from);
  // Ciudad local: la del negocio o la de DEFAULTS; si la configurada se normaliza a vacío, se ignora y
  // todo cae en la tarifa plana
  const rawLocal = settings.shipping_local_city;
  const localCity = rawLocal === undefined || rawLocal === null || String(rawLocal).trim() === '' ? DEFAULTS.localCity : rawLocal;
  const localEnabled = hasLocalCost(settings.shipping_local_cost) && normalizeCity(localCity) !== '';
  const zone = localEnabled && isLocalCity(city, localCity) ? ZONE_LOCAL : ZONE_NATIONAL;
  if (freeFrom > 0 && Number(subtotal) >= freeFrom) return { zone, cost: 0 };
  return { zone, cost: zone === ZONE_LOCAL ? money(settings.shipping_local_cost) : flat };
}

module.exports = { DEFAULTS, ZONE_LOCAL, ZONE_NATIONAL, normalizeCity, isLocalCity, calculateShipping };
