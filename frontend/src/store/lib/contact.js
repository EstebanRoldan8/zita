// Datos de contacto de la tienda: primero flowContent (fuente única), luego store_settings.
// Imports con extensión .js: también se carga en Node (funciones serverless).
import { flowContent } from '../content/flowContent.js';

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// Número de WhatsApp (dígitos con indicativo) o null
export function whatsappNumber(store) {
  return text(flowContent.brand.whatsapp) || text(store?.whatsapp_number);
}

// Número como se muestra en pantalla ("317 438 2899")
export function whatsappDisplay(store) {
  const shown = text(flowContent.brand.whatsappDisplay);
  if (shown) return shown;
  const digits = String(whatsappNumber(store) || '').replace(/\D/g, '');
  return digits ? digits.replace(/^57(?=3\d{9}$)/, '') : null;
}

export function instagramUrl(store) {
  return text(store?.social?.instagram) || text(flowContent.brand.instagram);
}

// URL del formulario de PQR o null (sin URL la sección muestra solo WhatsApp y correo)
export function pqrFormUrl() {
  const url = text(flowContent.pqrFormUrl);
  return url && /^https:\/\//i.test(url) ? url : null;
}
