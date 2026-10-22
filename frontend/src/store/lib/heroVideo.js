// Video de fondo del hero (collection.hero.video = { src, poster }). null si falta o está vacío:
// el hero se comporta como siempre (imagen o composición tipográfica).
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function heroVideoOf(hero) {
  const src = clean(hero?.video?.src);
  return src ? { src, poster: clean(hero.video.poster) } : null;
}

// ¿El fondo del hero es oscuro (foto o video)? El header y los botones usan su variante clara.
export const heroIsDark = (hero) => !!(clean(hero?.image) || heroVideoOf(hero));

// ¿Conviene cargar el video? No con movimiento reducido, ahorro de datos o conexión 2G.
export function canLoadHeroVideo(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  const c = win.navigator?.connection;
  if (c?.saveData) return false;
  if (['slow-2g', '2g'].includes(c?.effectiveType)) return false;
  return true;
}
