const rateLimit = require('express-rate-limit');

// Rate limiter para rutas autenticadas en desarrollo
const authenticatedLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 200, // 200 peticiones por ventana
  message: {
    success: false,
    error: 'Demasiadas peticiones. Intenta de nuevo más tarde.'
  },
  standardHeaders: true, // Retorna RateLimit-* headers
  legacyHeaders: false, // Desactiva X-RateLimit-* headers
  skip: (req) => {
    // Skip rate limiting en desarrollo si env dice que sí
    return process.env.NODE_ENV !== 'production' && process.env.SKIP_RATE_LIMIT === 'true';
  }
});

// Rate limiter más estricto para auth (login/register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // 10 intentos por ventana (protección contra brute-force)
  message: {
    success: false,
    error: 'Demasiados intentos de autenticación. Intenta de nuevo en 15 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter para webhook de WhatsApp (menos estricto)
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 300, // 300 peticiones
  message: {
    success: false,
    error: 'Webhook limitado. Intenta de nuevo más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// IP del cliente para los límites de rutas públicas sensibles (invitaciones).
// Por defecto req.ip, que depende de app.set('trust proxy', 1). En Railway el edge REESCRIBE X-Real-IP en
// cada petición (no se puede falsificar desde fuera) pero no publica cuántos saltos hay delante, así que
// req.ip podría ser la IP del proxy. Con RATE_LIMIT_IP_HEADER=x-real-ip se usa ese header.
// Activarlo SOLO si el backend está detrás de ese edge: sin él, el header lo controla el cliente.
function clientIp(req) {
  const header = String(process.env.RATE_LIMIT_IP_HEADER || '').trim().toLowerCase();
  if (header) {
    const value = req.headers[header];
    if (typeof value === 'string' && value.trim()) return value.split(',')[0].trim();
  }
  return req.ip;
}

const inviteMessage = {
  success: false,
  error: 'Demasiados intentos con enlaces de invitación. Intenta de nuevo en 15 minutos.'
};

// Ver datos de una invitación (GET): los navegadores y WhatsApp precargan enlaces, margen amplio
const inviteReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: clientIp,
  message: inviteMessage,
  standardHeaders: true,
  legacyHeaders: false
});

// Aceptar una invitación (crea una cuenta): estricto
const inviteAcceptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: clientIp,
  message: inviteMessage,
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  authenticatedLimiter,
  authLimiter,
  webhookLimiter,
  inviteReadLimiter,
  inviteAcceptLimiter,
  clientIp
};
