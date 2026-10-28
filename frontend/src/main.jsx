// ZITA Frontend Entry Point
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { isStoreContext, isStoreHost } from './lib/isStoreContext'
import { applyFlowIdentity, dropZitaServiceWorker } from './store/lib/identity'

// Privacidad: la tienda pública (/tienda... o dominio propio) no inicializa Sentry. La política
// aprobada dice que solo usa almacenamiento técnico y no carga terceros hasta que la persona decide;
// Sentry mandaría errores, métricas y replays a sentry.io. Se decide una sola vez al arrancar y el
// import dinámico evita que el SDK se descargue en la tienda. El panel y el resto quedan igual.
if (!isStoreContext) {
  import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn: "https://b7b219d4c434642f5bf801ec95dfb571@o4511504203776000.ingest.us.sentry.io/4511504297033728",
      environment: import.meta.env.MODE || 'development',
      tracesSampleRate: 1.0,
      sendDefaultPii: false,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
  });
}

// Identidad de FLOW (favicon, apple-touch-icon, manifest, theme-color) en la tienda; en su host propio además
// no queda el service worker de ZITA (index.html tampoco lo registra ahí). ZITA no pasa por aquí.
if (isStoreContext) applyFlowIdentity();
if (isStoreHost) dropZitaServiceWorker();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
