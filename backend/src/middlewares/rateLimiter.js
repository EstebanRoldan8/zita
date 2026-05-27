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
  max: 100, // 100 intentos por ventana (más durante desarrollo)
  message: {
    success: false,
    error: 'Demasiados intentos de autenticación. Intenta de nuevo en 15 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production'
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

module.exports = {
  authenticatedLimiter,
  authLimiter,
  webhookLimiter
};
