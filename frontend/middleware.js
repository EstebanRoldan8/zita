// Routing Middleware de Vercel: la raíz "/" de www.flowactivewear.co la sirve el index.html estático de ZITA
// (los archivos estáticos ganan a vercel.json), así que los bots y las vistas previas (WhatsApp, Instagram,
// Google...) verían el <head> de ZITA. Aquí, SOLO para ese host, un GET de un bot o previsualizador a "/" se
// reescribe al prerender de la tienda (api/store-prerender.js), que devuelve el mismo index.html con el <head> de FLOW.
// Para cualquier otro host (ZITA, previews, dominios de Vercel), para personas y para cualquier otra ruta:
// no-op total, la petición sigue sin tocarse. Ante cualquier error también se deja pasar la petición normal.
// No hay lógica de la tienda aquí: solo la decisión. Pruebas: tests/middleware.test.js.
import { next, rewrite } from '@vercel/functions';

export const STORE_HOST = 'www.flowactivewear.co';
// Mismos user-agents que las reglas de bots de vercel.json (una prueba comprueba que no se desincronicen).
// A las personas no se les da el prerender: el contenido de #root se vería un instante antes de que cargue la SPA.
export const BOT_UA = /.*(Googlebot|Google-InspectionTool|Storebot-Google|bingbot|BingPreview|DuckDuckBot|YandexBot|Baiduspider|facebookexternalhit|Facebot|meta-externalagent|Twitterbot|WhatsApp|TelegramBot|LinkedInBot|Slackbot|Discordbot|Pinterest|Applebot|Embedly|embedly).*/;

// ¿Hay que servir el <head> de FLOW? Todo debe cumplirse; ante la duda, false.
export function shouldServeStoreHead(request) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    const url = new URL(request.url);
    if (url.pathname !== '/') return false;
    const host = String(request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host).split(',')[0].trim().toLowerCase();
    if (host !== STORE_HOST) return false;
    if (!BOT_UA.test(request.headers.get('user-agent') || '')) return false;
    // Pide HTML (o cualquier cosa): si pide explícitamente solo otro tipo (JSON, imagen...), no se toca
    const accept = request.headers.get('accept') || '';
    return accept === '' || /text\/html|\*\/\*/.test(accept);
  } catch {
    return false;
  }
}

export const config = { matcher: '/' };

export default function middleware(request) {
  try {
    if (!shouldServeStoreHead(request)) return next();
    return rewrite(new URL('/api/store-prerender?path=/', request.url));
  } catch {
    return next();
  }
}
