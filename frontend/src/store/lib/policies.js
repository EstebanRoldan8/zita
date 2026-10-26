// Páginas legales y de ayuda. Los textos legales viven en content/flowLegal.js (generado desde los Word
// aprobados) y solo los cargan esas páginas; aquí van rutas y títulos para menú, footer, SEO y sitemap.
import { flowContent } from '../content/flowContent.js';

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// kind = ruta (/terminos…) y clave en LEGAL_DOCS. title = título del Word; label = enlace corto;
// seoTitle = título para buscadores cuando el del Word no cabe en 60 caracteres con " | FLOW".
export const POLICIES = {
  terminos: { title: 'Términos y condiciones de compra por canales digitales', label: 'Términos y condiciones', seoTitle: 'Términos y condiciones de compra' },
  privacidad: { title: 'Política de tratamiento de datos personales', label: 'Privacidad' },
  cambios: { title: 'Cambios, retracto, garantía y reversión del pago', label: 'Cambios y devoluciones' },
  envios: { title: 'Envíos y pagos', label: 'Envíos y pagos' },
  'preguntas-frecuentes': { title: 'Preguntas frecuentes', label: 'Preguntas frecuentes' },
  promociones: { title: 'Términos generales de promociones y sorteos', label: 'Promociones y sorteos', seoTitle: 'Términos de promociones y sorteos' },
};

// Formatos imprimibles (/formatos/:kind) — Anexos 2 y 3
export const FORMS = {
  retracto: { title: 'Formato de solicitud de retracto' },
  garantia: { title: 'Formato de solicitud de garantía' },
};
export const FORMS_TITLE = 'Formatos';

// Enlaces a las políticas para footer, menú y Ayuda (path relativo a la tienda)
export function policyLinks() {
  return [
    { label: 'Términos y condiciones', href: '/terminos' },
    { label: 'Privacidad', href: '/privacidad' },
    { label: 'Cambios y devoluciones', href: '/cambios' },
    { label: 'Envíos y pagos', href: '/envios' },
    { label: 'Preguntas frecuentes', href: '/preguntas-frecuentes' },
    { label: FORMS_TITLE, href: '/formatos' },
    { label: 'PQR', href: '/terminos#pqr' },
  ];
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
