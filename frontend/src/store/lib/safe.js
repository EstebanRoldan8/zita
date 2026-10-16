// Acceso defensivo a datos que vienen de la API o de localStorage: nunca lanzan.
export const asArray = (v) => (Array.isArray(v) ? v : []);
export const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
export const asString = (v, fallback = '') => (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : fallback));
export const asNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
// Lista de URLs válidas (descarta vacíos y tipos raros)
export const asUrls = (v) => asArray(v).filter((u) => typeof u === 'string' && u.length > 0);
