require('./instrument');
require('dotenv').config();

const fs = require('fs');
if (!fs.existsSync('logs')) fs.mkdirSync('logs', { recursive: true });

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');

process.on('uncaughtException', (error) => {
  logger.error('uncaughtException:', { message: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection:', { reason: String(reason) });
});

const authRoutes = require('./routes/auth.routes');
const businessesRoutes = require('./routes/businesses.routes');
const appointmentsRoutes = require('./routes/appointments.routes');
const clientsRoutes = require('./routes/clients.routes');
const servicesRoutes = require('./routes/services.routes');
const metricsRoutes = require('./routes/metrics.routes');
const { supportRouter } = require('./routes/support.routes');
const employeesRoutes = require('./routes/employees.routes');
const cashRoutes = require('./routes/cash.routes');
const settingsRoutes = require('./routes/settings.routes');
const alertsRoutes    = require('./routes/alerts.routes');
const productsRoutes  = require('./routes/products.routes');
const productVariantsRoutes = require('./routes/productVariants.routes');
const ordersRoutes = require('./routes/orders.routes');
const assistantRoutes = require('./routes/assistant.routes');
const webhookRoutes = require('./routes/webhook.routes');
const adminRoutes = require('./routes/admin.routes');
const loyaltyRoutes = require('./routes/loyalty.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const contactRoutes = require('./routes/contact.routes');
const paymentRoutes = require('./routes/payment.routes');
const internalRoutes = require('./routes/internal.routes');
const { verifyToken } = require('./middlewares/auth');
const { businessContext } = require('./middlewares/businessContext');
const { checkPlanAccess } = require('./middlewares/planCheck');
const { checkFeatureAccess } = require('./middlewares/featureCheck');
const { initScheduler } = require('./services/scheduler.service');

const app = express();

app.set('etag', false);
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: false,
}));

const allowedOrigins = [
  'https://zita-alpha.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);

const corsOptions = {
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  message: { success: false, error: 'Demasiadas solicitudes, intenta de nuevo en 15 minutos.' },
  skip: (req) => process.env.NODE_ENV !== 'production',
});
app.use(globalLimiter);

// Parser JSON global para todas las rutas
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Parser JSON específico para webhook de WhatsApp con captura de rawBody
// La opción 'verify' se ejecuta ANTES de parsearse, permitiendo capturar el buffer exacto
const webhookJsonParser = express.json({
  limit: '100kb',
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf;
  }
});

app.get('/health', (req, res) => {
  res.json({ success: true, service: 'ZITA API', status: 'online' });
});

app.get('/eliminar-datos', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Eliminación de Datos - ZITA</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px;
               margin: 50px auto; padding: 20px; color: #333; }
        h1 { color: #7c3aed; }
        a { color: #7c3aed; }
      </style>
    </head>
    <body>
      <h1>Solicitud de Eliminación de Datos</h1>
      <p>Para solicitar la eliminación de tus datos personales
         de la plataforma ZITA, envía un correo a:</p>
      <p><strong><a href="mailto:esteban.zita.ia@gmail.com">
         esteban.zita.ia@gmail.com</a></strong></p>
      <p>Incluye tu nombre completo y número de teléfono registrado.
         Procesaremos tu solicitud en un plazo máximo de 30 días.</p>
      <p><small>ZITA - Automatización para negocios</small></p>
    </body>
    </html>
  `);
});

app.post('/api/data-deletion', (req, res) => {
  const signedRequest = req.body.signed_request;

  res.json({
    url: 'https://zita-production-1634.up.railway.app/eliminar-datos',
    confirmation_code: 'zita_deletion_' + Date.now()
  });
});

app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/internal', internalRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/businesses', businessesRoutes);
app.use('/api/appointments', verifyToken, businessContext, checkPlanAccess, appointmentsRoutes);
app.use('/api/clients', verifyToken, businessContext, checkPlanAccess, checkFeatureAccess('clientes'), clientsRoutes);
app.use('/api/services', verifyToken, businessContext, checkPlanAccess, servicesRoutes);
app.use('/api/metrics', verifyToken, businessContext, checkPlanAccess, checkFeatureAccess('analiticas'), metricsRoutes);
app.use('/api/support', supportRouter);
app.use('/api/admin', adminRoutes);
app.use('/api/employees', verifyToken, businessContext, checkPlanAccess, employeesRoutes);
// 'caja' ya NO bloquea la ruta completa: Lite tiene acceso reducido (solo
// ingresos), y la lógica de qué datos devolver vive en cash.controller.js.
// Los endpoints exclusivos de Pro (export/pdf, report/*) se gatean con
// 'reportes_pdf' dentro de cash.routes.js.
app.use('/api/cash', verifyToken, businessContext, checkPlanAccess, cashRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/alerts', verifyToken, businessContext, checkPlanAccess, alertsRoutes);
app.use('/api/products', verifyToken, businessContext, checkPlanAccess, checkFeatureAccess('productos'), productVariantsRoutes);
app.use('/api/products', verifyToken, businessContext, checkPlanAccess, checkFeatureAccess('productos'), productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/assistant', verifyToken, businessContext, checkPlanAccess, checkFeatureAccess('asistente_ia'), assistantRoutes);
app.use('/api/subscription', verifyToken, businessContext, subscriptionRoutes);
// Webhook: usar parser JSON específico con captura de rawBody ANTES de routes
app.use('/api/webhook', webhookJsonParser, webhookRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/demo', contactRoutes);
app.use('/api/payments', paymentRoutes);

const Sentry = require("@sentry/node");
Sentry.setupExpressErrorHandler(app);

// Manejador global de errores
app.use((err, req, res, next) => {
  logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method}`);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Error interno del servidor.',
  });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  logger.info(`ZITA API corriendo en puerto ${PORT} [${process.env.NODE_ENV}]`);
  logger.info('Rutas registradas: /api/auth, /api/businesses, /api/appointments, /api/clients, /api/services, /api/metrics, /api/support, /api/admin, /api/employees, /api/webhook');
  initScheduler();
  logger.info('✓ Scheduler verificado y activo');
});

server.setTimeout(30000);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Puerto ${PORT} ocupado. Cerrando...`);
    process.exit(1);
  }
});

module.exports = app;
