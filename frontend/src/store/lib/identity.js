// Identidad de FLOW en el navegador. Solo se llama desde main.jsx en contexto de tienda (ruta /tienda o host
// propio); ZITA (panel, login, landing) nunca pasa por aquí.
import {
  FLOW_THEME_COLOR, FLOW_APP_TITLE, FLOW_MANIFEST, FLOW_ICON_LINKS,
} from './brandHead';

// Cambia en el <head> el favicon, apple-touch-icon, manifest, theme-color y el nombre de la app por los de FLOW.
export function applyFlowIdentity(doc = document) {
  try {
    const head = doc.head;
    head.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="manifest"]').forEach((el) => el.remove());
    for (const spec of FLOW_ICON_LINKS) {
      const link = doc.createElement('link');
      for (const [k, v] of Object.entries(spec)) link.setAttribute(k, v);
      head.appendChild(link);
    }
    const manifest = doc.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = FLOW_MANIFEST;
    head.appendChild(manifest);
    const setMeta = (name, content) => {
      let el = head.querySelector(`meta[name="${name}"]`);
      if (!el) { el = doc.createElement('meta'); el.setAttribute('name', name); head.appendChild(el); }
      el.setAttribute('content', content);
    };
    setMeta('theme-color', FLOW_THEME_COLOR);
    setMeta('apple-mobile-web-app-title', FLOW_APP_TITLE);
  } catch { /* el favicon nunca debe romper la tienda */ }
}

// En el host propio de la tienda no debe quedar el service worker (PWA) de ZITA. Si una visita anterior lo
// dejó registrado, se desregistra (solo los de este origen) y se borran únicamente las cachés de ese SW.
export function dropZitaServiceWorker() {
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => regs.forEach((r) => { if (new URL(r.scope).origin === window.location.origin) r.unregister(); }))
        .catch(() => {});
    }
    if (window.caches?.keys) {
      window.caches.keys()
        .then((keys) => keys.filter((k) => /^(workbox-|zita-)/.test(k)).forEach((k) => window.caches.delete(k)))
        .catch(() => {});
    }
  } catch { /* sin permisos o sin soporte: no pasa nada */ }
}
