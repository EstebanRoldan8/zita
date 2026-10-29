// Drops y cápsulas de la colección activa de una tienda, para el asistente.
// Fuente única: el mismo archivo de contenido que usa la tienda (frontend/src/store/content/flowContent.js),
// que no tiene dependencias. Se lee SOLO el bloque de la colección (nombres y colores que la definen) y solo para
// la tienda dueña de ese contenido. Si el archivo no está disponible en el servidor, devuelve null y el asistente
// lo dice en vez de inventar.
const path = require('path');
const { pathToFileURL } = require('url');

const CONTENT_BY_SLUG = {
  flow: path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'store', 'content', 'flowContent.js'),
};

const cache = new Map();

function summarize(content) {
  const list = Array.isArray(content?.collections) ? content.collections : [];
  const active = list.find((c) => c && c.slug === content.activeCollection) || list[0];
  if (!active) return null;
  const drops = (active.drops || []).map((d) => ({
    nombre: d.name, capsula: d.capsule || null, colores: (d.defines || d.colors || []).map(String), descripcion: d.description || null,
  }));
  const capsulas = (active.capsules || []).map((c) => ({
    nombre: c.name, lema: c.tagline || null,
    colores: [...new Set(drops.filter((d) => d.capsula === c.slug).flatMap((d) => d.colores))],
  }));
  return { coleccion: active.name, capsulas, drops };
}

async function loadStoreCatalog(slug, { loader } = {}) {
  const key = String(slug || '').toLowerCase();
  const file = CONTENT_BY_SLUG[key];
  if (!file) return null;
  if (cache.has(key)) return cache.get(key);
  let value = null;
  try {
    const mod = loader ? await loader(file) : await import(pathToFileURL(file).href);
    value = summarize(mod.flowContent || mod.default || mod);
  } catch {
    value = null;
  }
  cache.set(key, value);
  return value;
}

module.exports = { loadStoreCatalog, summarize };
