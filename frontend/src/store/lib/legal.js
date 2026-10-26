// Marcas de los textos legales (content/flowLegal.js) → piezas para pintar. Lo usan la SPA
// (components/LegalText) y el prerender, así bots y personas ven el mismo texto.
// Imports con extensión .js: también se carga en Node (funciones serverless).
import { flowContent } from '../content/flowContent.js';
import { whatsappNumber, whatsappDisplay, instagramUrl } from './contact.js';
import { waLink } from './format.js';

const TOKEN = /\*\*(.+?)\*\*|\{\{link:([^|}]+)\|([^}]+)\}\}|\{\{(whatsapp|notificaciones)\}\}|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)|(www\.sic\.gov\.co)|(@flow\.col)\b/g;

// Texto con marcas → [{ type: 'text'|'bold'|'link'|'a', text, href?, external?, children? }]
// link = ruta interna de la tienda (sin base); a = enlace externo (mailto, wa.me, sitios)
export function legalTokens(value, store) {
  const s = String(value ?? '');
  const out = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
    last = m.index + m[0].length;
    const [, bold, linkHref, linkText, field, email, sic, handle] = m;
    if (bold !== undefined) out.push({ type: 'bold', children: legalTokens(bold, store) });
    else if (linkHref) out.push({ type: 'link', href: linkHref, text: linkText });
    else if (field === 'whatsapp') {
      const shown = whatsappDisplay(store);
      const href = waLink(whatsappNumber(store));
      out.push(href ? { type: 'a', href, text: shown, external: true } : { type: 'text', text: shown || 'WhatsApp' });
    } else if (field === 'notificaciones') out.push(...legalTokens(flowContent.seller?.notificationAddress || '', store));
    else if (email) out.push({ type: 'a', href: `mailto:${email}`, text: email });
    else if (sic) out.push({ type: 'a', href: `https://${sic}`, text: sic, external: true });
    else if (handle) {
      const ig = instagramUrl(store);
      out.push(ig ? { type: 'a', href: ig, text: handle, external: true } : { type: 'text', text: handle });
    }
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
  return out;
}

// Texto plano (descripciones SEO, búsqueda)
export function legalPlain(value, store) {
  return legalTokens(value, store).map((t) => (t.children ? t.children.map((c) => c.text || '').join('') : t.text || '')).join('');
}

// Primer párrafo con texto del documento → descripción
export function legalDescription(doc, store) {
  const blocks = [...(doc?.intro || []), ...(doc?.sections || []).flatMap((s) => s.blocks)];
  const p = blocks.find((b) => b.t === 'p' && legalPlain(b.text, store).length > 40);
  return p ? legalPlain(p.text, store) : '';
}

// "Fecha de vigencia: …" del Word o, si el Word no la trae, la de flowContent.legal
export function legalEffective(doc) {
  if (doc?.effective) return doc.effective;
  const date = flowContent.legal?.effectiveDate;
  return date ? `Fecha de vigencia: ${date}` : null;
}

// Campo de un formato: "☐ A ☐ B: ____" → opciones; '' → espacio para escribir
export function formOptions(value) {
  const v = String(value || '');
  if (!v.includes('☐')) return null;
  return v.split('☐').map((o) => o.trim()).filter(Boolean).map((o) => {
    const blank = /_{3,}/.test(o);
    return { label: o.replace(/\s*_{3,}\s*/g, ' ').trim(), blank };
  });
}
