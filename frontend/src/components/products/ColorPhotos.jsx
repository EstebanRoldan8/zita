import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Star, Palette } from 'lucide-react';
import api from '../../lib/api';

export const MAX_PHOTOS_PER_COLOR = 8;
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const NO_COLOR_MSG = 'Para subir fotos por color, agrega a las variantes un atributo llamado «color».';

// Validación en el cliente: tipo, 2 MB y cupos restantes del color
export function pickValidFiles(fileList, remaining) {
  const files = Array.from(fileList || []);
  const valid = files.filter((f) => ALLOWED_TYPES.includes(f.type) && f.size <= MAX_BYTES);
  const notes = [];
  if (valid.length < files.length) notes.push('Se descartaron imágenes que no eran JPG, PNG o WebP o pesaban más de 2 MB.');
  if (valid.length > remaining) notes.push(`Solo quedaban ${remaining} cupo${remaining !== 1 ? 's' : ''}; se tomaron las primeras.`);
  return { files: valid.slice(0, Math.max(remaining, 0)), note: notes.join(' ') };
}

// Una fila por color: miniaturas con ✕ y ★ Principal, y "+ Agregar fotos"
// status: 'inactive' (todas sus variantes están desactivadas) | 'orphan' (fotos de un color que ya ninguna
// variante usa: solo se pueden quitar) | undefined
function ColorRow({ label, variantCount, photos, onAdd, onRemove, onCover, busy, error, note, status }) {
  const inputRef = useRef(null);
  const remaining = MAX_PHOTOS_PER_COLOR - photos.length;
  const orphan = status === 'orphan';
  return (
    <div className={`p-3 border rounded-lg space-y-2 ${orphan ? 'bg-amber-500/5 border-amber-500/30' : 'bg-slate-800/30 border-slate-700'}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-white text-sm font-medium break-words min-w-0">
          {label}
          {status === 'inactive' && <span className="ml-2 text-[11px] font-normal text-slate-400 bg-slate-700/60 px-1.5 py-0.5 rounded">variante inactiva</span>}
          {orphan && <span className="ml-2 text-[11px] font-normal text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded">sin variante</span>}
        </p>
        <span className="text-slate-500 text-xs flex-shrink-0">
          {photos.length}/{MAX_PHOTOS_PER_COLOR} fotos{orphan ? '' : ` · ${variantCount} variante${variantCount !== 1 ? 's' : ''}`}
        </span>
      </div>
      {orphan && (
        <p className="text-amber-300/90 text-xs">Ninguna variante usa este color: la tienda no muestra estas fotos. Quítalas o vuelve a ponerle este color a una variante.</p>
      )}

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((p, idx) => (
            <div key={p.id} className="w-24 flex flex-col gap-1">
              <div className="relative w-24 h-24 bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                <img src={p.src} alt={`${label} ${idx + 1}`} className="w-full h-full object-cover" />
                {idx === 0 && (
                  <span className="absolute bottom-1 left-1 text-[10px] font-medium bg-violet-600/90 text-white px-1.5 py-0.5 rounded">Principal</span>
                )}
              </div>
              <div className="flex gap-1">
                {idx > 0 && onCover && (
                  <button type="button" onClick={() => onCover(idx)} disabled={busy} title="Usar como foto principal"
                    className="flex-1 flex items-center justify-center gap-0.5 text-[11px] text-violet-300 bg-violet-600/20 border border-violet-500/30 rounded py-1 hover:bg-violet-600/30 disabled:opacity-50 transition">
                    <Star size={11} /> Principal
                  </button>
                )}
                <button type="button" onClick={() => onRemove(idx)} disabled={busy} title="Quitar foto"
                  className="flex-1 flex items-center justify-center text-red-400 bg-red-500/10 border border-red-500/30 rounded py-1 hover:bg-red-500/20 disabled:opacity-50 transition">
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!orphan && (
        <>
          <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { onAdd(e.target.files, remaining); e.target.value = ''; }} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || remaining <= 0}
            className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm font-medium py-2 rounded-lg transition">
            {busy ? 'Guardando...' : remaining <= 0 ? 'Máximo de fotos alcanzado' : `+ Agregar fotos (quedan ${remaining})`}
          </button>
        </>
      )}
      {note && <p className="text-yellow-400 text-xs">{note}</p>}
      {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 px-2 py-1.5 rounded">{error}</p>}
    </div>
  );
}

function SectionHeader() {
  return (
    <div>
      <h4 className="text-white text-sm font-semibold flex items-center gap-2"><Palette size={14} className="text-violet-400" /> Fotos por color</h4>
      <p className="text-slate-500 text-xs mt-0.5">Se comparten entre todas las tallas del mismo color. La primera es la principal. JPG, PNG o WebP, máx 2 MB.</p>
    </div>
  );
}

// Modo edición: lee y escribe directamente contra /api/products/:id/option-images
export function ColorPhotosEdit({ productId }) {
  const qc = useQueryClient();
  const queryKey = ['option-images', productId];
  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () => api.get(`/api/products/${productId}/option-images`).then((r) => r.data?.data),
    staleTime: 0,
  });
  const [busyKey, setBusyKey] = useState(null);
  const [errors, setErrors] = useState({});
  const [notes, setNotes] = useState({});

  const setImages = (key, images) => qc.setQueryData(queryKey, (prev) => (prev
    ? { ...prev, options: prev.options.map((o) => (o.key === key ? { ...o, images } : o)) }
    : prev));

  const run = async (option, fn, fallback) => {
    setBusyKey(option.key);
    setErrors((e) => ({ ...e, [option.key]: '' }));
    try {
      const res = await fn();
      setImages(option.key, res.data?.data?.images || []);
    } catch (err) {
      setErrors((e) => ({ ...e, [option.key]: err.response?.data?.error || fallback }));
    } finally {
      setBusyKey(null);
    }
  };

  const handleAdd = (option, fileList, remaining) => {
    const { files, note } = pickValidFiles(fileList, remaining);
    setNotes((n) => ({ ...n, [option.key]: note }));
    if (files.length === 0) return;
    const formData = new FormData();
    formData.append('option', option.label);
    files.forEach((f) => formData.append('images', f));
    run(option, () => api.post(`/api/products/${productId}/option-images`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }), 'Error al subir las fotos.');
  };

  const handleRemove = (option, idx) => {
    if (!window.confirm(`¿Quitar esta foto del color ${option.label}?`)) return;
    const url = option.images[idx];
    run(option, () => api.delete(`/api/products/${productId}/option-images`, { data: { option: option.key, url } }),
      'Error al quitar la foto.');
  };

  const handleCover = (option, idx) => {
    const url = option.images[idx];
    run(option, () => api.patch(`/api/products/${productId}/option-images/cover`, { option: option.key, url }),
      'Error al cambiar la foto principal.');
  };

  return (
    <div className="border-t border-slate-800 pt-4 space-y-3">
      <SectionHeader />
      {isLoading ? (
        <div className="h-24 bg-slate-800/40 rounded-lg animate-pulse" />
      ) : isError ? (
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">
          {error?.response?.data?.error || 'No se pudieron cargar las fotos por color.'}
        </p>
      ) : !data?.options?.length ? (
        <p className="text-slate-500 text-xs bg-slate-800/30 border border-slate-700 px-3 py-2 rounded-lg">{NO_COLOR_MSG}</p>
      ) : (
        data.options.map((option) => (
          <ColorRow key={option.key}
            label={option.label}
            status={option.orphan ? 'orphan' : option.variant_count > 0 && option.active_count === 0 ? 'inactive' : undefined}
            variantCount={option.variant_count}
            photos={option.images.map((src) => ({ id: src, src }))}
            busy={busyKey === option.key}
            error={errors[option.key]}
            note={notes[option.key]}
            onAdd={(files, remaining) => handleAdd(option, files, remaining)}
            onRemove={(idx) => handleRemove(option, idx)}
            onCover={(idx) => handleCover(option, idx)} />
        ))
      )}
    </div>
  );
}

// Modo creación: los archivos se guardan en memoria por color y se suben después de crear
// el producto. pending = { [colorKey]: File[] }. Las URL de objeto se liberan al desmontar.
export function ColorPhotosCreate({ colors, pending, onChange }) {
  const [notes, setNotes] = useState({});

  const previews = useMemo(() => {
    const map = {};
    for (const [key, files] of Object.entries(pending || {})) {
      map[key] = files.map((file, i) => ({ id: `${key}-${i}-${file.name}-${file.lastModified}`, src: URL.createObjectURL(file) }));
    }
    return map;
  }, [pending]);

  useEffect(() => () => {
    Object.values(previews).flat().forEach((p) => URL.revokeObjectURL(p.src));
  }, [previews]);

  const update = (key, files) => onChange({ ...(pending || {}), [key]: files });

  return (
    <div className="border-t border-slate-800 pt-4 space-y-3">
      <SectionHeader />
      {colors.length === 0 ? (
        <p className="text-slate-500 text-xs bg-slate-800/30 border border-slate-700 px-3 py-2 rounded-lg">{NO_COLOR_MSG}</p>
      ) : (
        colors.map((c) => {
          const files = pending?.[c.key] || [];
          return (
            <ColorRow key={c.key}
              label={c.label}
              variantCount={c.variant_count}
              photos={previews[c.key] || []}
              busy={false}
              note={notes[c.key]}
              onAdd={(fileList, remaining) => {
                const { files: picked, note } = pickValidFiles(fileList, remaining);
                setNotes((n) => ({ ...n, [c.key]: note }));
                if (picked.length) update(c.key, [...files, ...picked]);
              }}
              onRemove={(idx) => update(c.key, files.filter((_, i) => i !== idx))}
              onCover={(idx) => update(c.key, [files[idx], ...files.filter((_, i) => i !== idx)])} />
          );
        })
      )}
      <p className="text-slate-600 text-xs">Las fotos se suben al crear el producto.</p>
    </div>
  );
}
