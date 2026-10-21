import { flowContent } from '../content/flowContent.js';

// ID del video de YouTube de Sobre FLOW (flowContent.aboutVideo.youtubeId) o null si está vacío o no tiene
// forma de ID (placeholder). Lo usan la página (una o dos columnas) y el reproductor.
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function aboutVideoId(content = flowContent) {
  const id = String(content?.aboutVideo?.youtubeId || '').trim();
  return ID_RE.test(id) ? id : null;
}
