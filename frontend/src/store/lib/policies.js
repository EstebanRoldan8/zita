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

// Guía de tallas: { title, intro, note, tables: [{ title, types, columns, rows }] } con solo las tablas válidas,
// o null si no hay ninguna (la página, los enlaces y el SEO se ocultan).
export function sizeGuide() {
  const g = flowContent.sizeGuide;
  const tables = (Array.isArray(g?.tables) ? g.tables : [])
    .filter((t) => t && text(t.title) && Array.isArray(t.columns) && t.columns.length && Array.isArray(t.rows) && t.rows.length);
  if (!tables.length) return null;
  return { title: text(g.title) || 'Guía de tallas', intro: text(g.intro), note: text(g.note), tables };
}

// Tablas de la guía que aplican a unos tipos de prenda (p. ej. ['Licras']); [] si ninguna
export function sizeGuideTablesFor(types) {
  const want = new Set((Array.isArray(types) ? types : []).map((t) => String(t).trim().toLowerCase()));
  return (sizeGuide()?.tables || []).filter((t) => (t.types || []).some((x) => want.has(String(x).trim().toLowerCase())));
}
