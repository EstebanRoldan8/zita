// Saneo de variables de plantillas de WhatsApp (Meta no acepta saltos de línea, tabs, más de 4 espacios seguidos
// ni variables vacías). Módulo aparte para usarlo sin cargar el cliente HTTP de WhatsApp.
// Cualquier blanco (saltos, tabs, \v, \f, NBSP, U+2028…) o secuencia de blancos se vuelve UN espacio; se quitan
// los caracteres de control; se corta a `max` (con "…"). Vacío → '-' (Meta rechaza variables vacías).
function templateParam(value, max = 1000) {
  let t = String(value ?? '')
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > max) t = `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
  return t || '-';
}

module.exports = { templateParam };
