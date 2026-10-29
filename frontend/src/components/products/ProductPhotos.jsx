import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Image as ImageIcon } from 'lucide-react';
import api from '../../lib/api';
import { pickValidFiles } from './ColorPhotos';
import { MAX_GALLERY, UPLOAD } from '../../lib/productPhotos';

// Foto principal y galería de un producto (también de un set). Mismos endpoints que el formulario de producto:
//   POST /api/products/:id/image   (campo "image": principal)
//   POST /api/products/:id/images  (campo "images", hasta 8 por envío: galería)
//   DELETE /api/products/:id/images { url }
// Mismas reglas del backend: JPG, PNG o WebP, máx 2 MB c/u, galería de hasta 8 fotos. Las fotos por color
// siguen en ColorPhotos.

function useObjectUrls(files) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

function Thumb({ src, alt, onRemove, busy }) {
  return (
    <div className="relative w-20 h-20 bg-slate-800 border border-slate-700 rounded-lg overflow-hidden flex-shrink-0">
      <img src={src} alt={alt} className="w-full h-full object-cover" />
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={busy} aria-label={`Quitar ${alt}`}
          className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-600 disabled:opacity-50 transition">
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function MainPicker({ src, onPick, busy }) {
  const inputRef = useRef(null);
  return (
    <div className="flex gap-3">
      <div className="w-20 h-20 bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
        {src ? <img src={src} alt="Foto principal" className="w-full h-full object-cover" /> : <ImageIcon size={28} className="text-slate-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
          className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm font-medium py-2 rounded-lg transition">
          {busy ? 'Subiendo...' : src ? 'Cambiar foto principal' : 'Seleccionar foto principal'}
        </button>
        <p className="text-slate-500 text-xs mt-1">Es la que se ve en las tarjetas y al abrir la ficha. JPG, PNG o WebP — máx 2 MB</p>
      </div>
    </div>
  );
}

function GalleryAdd({ count, onAdd, busy }) {
  const inputRef = useRef(null);
  const remaining = MAX_GALLERY - count;
  return (
    <>
      <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { onAdd(e.target.files, remaining); e.target.value = ''; }} />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || remaining <= 0}
        className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm font-medium py-2 rounded-lg transition">
        {busy ? 'Subiendo...' : remaining <= 0 ? 'Máximo de fotos alcanzado' : `+ Agregar fotos a la galería (${count}/${MAX_GALLERY})`}
      </button>
    </>
  );
}

// Crear: las fotos quedan elegidas en el formulario ({ main: File|null, gallery: File[] }) y las sube el padre
// con uploadProductPhotos() después de crear el producto.
export function ProductPhotosCreate({ value, onChange }) {
  const [note, setNote] = useState('');
  const gallery = value.gallery || [];
  const mainFiles = useMemo(() => (value.main ? [value.main] : []), [value.main]);
  const mainUrls = useObjectUrls(mainFiles);
  const galleryUrls = useObjectUrls(gallery);
  return (
    <div className="space-y-3">
      <MainPicker src={mainUrls[0]} onPick={(list) => {
        const { files, note: n } = pickValidFiles(list, 1);
        setNote(n);
        if (files[0]) onChange({ ...value, main: files[0] });
      }} />
      <div className="space-y-2">
        <p className="text-slate-400 text-sm">Galería de fotos (opcional)</p>
        {gallery.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {gallery.map((f, i) => (
              <Thumb key={`${f.name}-${i}`} src={galleryUrls[i]} alt={`foto ${i + 1} de la galería`}
                onRemove={() => onChange({ ...value, gallery: gallery.filter((_, j) => j !== i) })} />
            ))}
          </div>
        )}
        <GalleryAdd count={gallery.length} onAdd={(list, remaining) => {
          const { files, note: n } = pickValidFiles(list, remaining);
          setNote(n);
          if (files.length) onChange({ ...value, gallery: [...gallery, ...files] });
        }} />
      </div>
      {note && <p className="text-yellow-400 text-xs">{note}</p>}
    </div>
  );
}

// Editar: cada acción se guarda al momento, como en el formulario de producto.
export function ProductPhotosEdit({ productId, initialMain, initialImages }) {
  const qc = useQueryClient();
  const [main, setMain] = useState(initialMain || null);
  const [images, setImages] = useState(Array.isArray(initialImages) ? initialImages : []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); qc.invalidateQueries({ queryKey: ['products'] }); }
    catch (err) { setError(err.response?.data?.error || 'No se pudo guardar la foto.'); }
    finally { setBusy(false); }
  };
  const pickMain = (list) => {
    const { files, note: n } = pickValidFiles(list, 1);
    setNote(n);
    if (!files[0]) return;
    run(async () => {
      const fd = new FormData(); fd.append('image', files[0]);
      const r = await api.post(`/api/products/${productId}/image`, fd, UPLOAD);
      setMain(r.data?.data?.image_url || null);
    });
  };
  const addGallery = (list, remaining) => {
    const { files, note: n } = pickValidFiles(list, remaining);
    setNote(n);
    if (!files.length) return;
    run(async () => {
      const fd = new FormData(); files.forEach((f) => fd.append('images', f));
      const r = await api.post(`/api/products/${productId}/images`, fd, UPLOAD);
      setImages(r.data?.data?.images || []);
    });
  };
  const removeGallery = (url) => run(async () => {
    const r = await api.delete(`/api/products/${productId}/images`, { data: { url } });
    setImages(r.data?.data?.images || []);
  });

  return (
    <div className="space-y-3">
      <MainPicker src={main} onPick={pickMain} busy={busy} />
      <div className="space-y-2">
        <p className="text-slate-400 text-sm">Galería de fotos</p>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((url, i) => <Thumb key={url} src={url} alt={`foto ${i + 1} de la galería`} busy={busy} onRemove={() => removeGallery(url)} />)}
          </div>
        )}
        <GalleryAdd count={images.length} onAdd={addGallery} busy={busy} />
      </div>
      {note && <p className="text-yellow-400 text-xs">{note}</p>}
      {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 px-2 py-1.5 rounded">{error}</p>}
    </div>
  );
}
