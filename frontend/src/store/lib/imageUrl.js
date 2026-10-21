// Fotos de producto pre-reducidas: el navegador reducía el archivo completo (1365×2048) 4-8× de un
// solo paso y dejaba bordes punteados. Un script aparte genera en Storage, por cada foto original
//   …/storage/v1/object/public/product-images/<ruta>.<ext>
// sus versiones de ancho W en
//   …/storage/v1/object/public/product-images/w<W>/<ruta sin extensión>.webp
// Si una versión aún no existe, StoreImage vuelve a la original (onError).
// SEO (og:image, JSON-LD, prerender, sitemap) sigue con la URL original: no usar esto ahí.

const BUCKET_PATH = '/storage/v1/object/public/product-images/';

export const IMAGE_WIDTHS = [400, 800, 1200];
export const DEFAULT_WIDTH = 800;

// Ruta dentro del bucket si la URL es una foto original de product-images; null si no
function originalPath(src) {
  if (typeof src !== 'string' || !src) return null;
  let url;
  try { url = new URL(src); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || !url.pathname.startsWith(BUCKET_PATH)) return null;
  const path = url.pathname.slice(BUCKET_PATH.length);
  // Vacía o ya es una versión reducida (w400/…): no se vuelve a transformar
  if (!path || /^w\d+\//.test(path)) return null;
  return { origin: url.origin, path };
}

// Versión de ancho W, o la URL sin cambios si no coincide con el patrón
export function imageUrl(src, width = DEFAULT_WIDTH) {
  const o = originalPath(src);
  if (!o) return src;
  const noExt = o.path.replace(/\.[a-z0-9]+$/i, '');
  return `${o.origin}${BUCKET_PATH}w${width}/${noExt}.webp`;
}

export const hasSizedVersions = (src) => originalPath(src) !== null;

// "url 400w, url 800w, url 1200w", o undefined si la URL no coincide con el patrón
export function imageSrcSet(src, widths = IMAGE_WIDTHS) {
  if (!hasSizedVersions(src)) return undefined;
  return widths.map((w) => `${imageUrl(src, w)} ${w}w`).join(', ');
}
