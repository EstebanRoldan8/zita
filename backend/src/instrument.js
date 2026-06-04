const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.NODE_ENV === 'production'
    ? (process.env.SENTRY_DSN || "https://6fca46c12bed97ab27469f853545b3f5@o4511504203776000.ingest.us.sentry.io/4511504209084417")
    : undefined,
  enableLogs: true,
  tracesSampleRate: 1.0,
  sendDefaultPii: false,
  environment: process.env.NODE_ENV || 'development',
});
