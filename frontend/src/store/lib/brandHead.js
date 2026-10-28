// Identidad de FLOW en el <head> (íconos, manifest, nombre de la app). Funciones y datos puros: los usa la SPA
// (lib/identity.js) y el prerender (api/_lib/html.js), por eso importa con extensión .js.
// Los archivos viven en public/flow/ (generados a partir de la marca de barras inclinadas, blanco sobre #1C1C1C).
import { THEME_COLOR } from './seo.js';

export const FLOW_THEME_COLOR = THEME_COLOR;
export const FLOW_APP_TITLE = 'FLOW';
export const FLOW_MANIFEST = '/flow/manifest.webmanifest';
export const FLOW_ICON_LINKS = [
  { rel: 'icon', href: '/flow/favicon.ico', sizes: 'any' },
  { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/flow/favicon-32.png' },
  { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/flow/favicon-16.png' },
  { rel: 'apple-touch-icon', sizes: '180x180', href: '/flow/apple-touch-icon.png' },
];
