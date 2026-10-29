import api from './api';

// Reglas y subida de fotos de producto/set (mismos endpoints del formulario de producto)
export const MAX_GALLERY = 8;
export const UPLOAD = { headers: { 'Content-Type': 'multipart/form-data' } };

// Sube principal y galería de un producto recién creado. Devuelve lo que falló (vacío = todo bien).
export async function uploadProductPhotos(productId, { main, gallery = [] }) {
  const failed = [];
  if (main) {
    try {
      const fd = new FormData(); fd.append('image', main);
      await api.post(`/api/products/${productId}/image`, fd, UPLOAD);
    } catch { failed.push('la foto principal'); }
  }
  if (gallery.length) {
    try {
      const fd = new FormData(); gallery.forEach((f) => fd.append('images', f));
      await api.post(`/api/products/${productId}/images`, fd, UPLOAD);
    } catch { failed.push('las fotos de la galería'); }
  }
  return failed;
}
