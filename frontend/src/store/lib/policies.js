// Textos de ayuda/legales: primero flowContent, luego store_settings.policies. null si no hay nada
// (la sección o el enlace se ocultan). Nunca se inventa texto.
import { flowContent } from '../content/flowContent.js';

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const POLICIES = {
  envios: { title: 'Envíos', get: (store) => text(flowContent.shipping) || text(store?.policies?.envios) },
  cambios: { title: 'Cambios y devoluciones', get: (store) => text(flowContent.returns) || text(flowContent.legal?.returns) || text(store?.policies?.cambios) },
  privacidad: { title: 'Privacidad y tratamiento de datos', get: (store) => text(flowContent.legal?.privacy) || text(store?.policies?.privacidad) },
  terminos: { title: 'Términos y condiciones', get: () => text(flowContent.legal?.terms) },
};

export function policyText(kind, store) {
  return POLICIES[kind]?.get(store) || null;
}

export function faqItems() {
  return (Array.isArray(flowContent.faq) ? flowContent.faq : []).filter((f) => f && text(f.q) && text(f.a));
}

export function sizeGuide() {
  const g = flowContent.sizeGuide;
  if (!g || !Array.isArray(g.columns) || !Array.isArray(g.rows) || g.rows.length === 0) return null;
  return g;
}
