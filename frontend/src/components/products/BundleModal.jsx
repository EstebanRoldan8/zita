import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, Package, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import api from '../../lib/api';
import { getColorOptions } from '../../lib/optionKey';
import { ColorPhotosEdit, ColorPhotosCreate } from './ColorPhotos';
import { ProductPhotosEdit, ProductPhotosCreate } from './ProductPhotos';
import { uploadProductPhotos } from '../../lib/productPhotos';

const formatCOP = (v) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(v) || 0);
const label = (attributes) => Object.values(attributes || {}).filter(Boolean).join(' / ');

// Crear / editar un set (solo negocios tienda). El set no tiene stock propio: sus variantes y su
// disponibilidad se calculan de sus productos. La vista previa avisa qué combinaciones se pierden.
export default function BundleModal({ initial, products, onClose, onSave }) {
  const qc = useQueryClient();
  const isEdit = !!initial;
  const [form, setForm] = useState({
    name: initial?.name || '',
    price: initial?.price ?? '',
    category: initial?.category || 'Sets',
    gender: initial?.gender || 'mujer',
    description: initial?.description || '',
  });
  const [components, setComponents] = useState(
    (initial?.bundle?.components || []).map((c) => ({ product_id: c.product_id, quantity: c.quantity })),
  );
  const [pick, setPick] = useState('');
  const [previewState, setPreviewState] = useState({ key: '', data: null, error: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState({ main: null, gallery: [] });
  const [pendingColorFiles, setPendingColorFiles] = useState({});

  // Solo productos normales y activos pueden ser parte de un set
  const options = useMemo(() => (products || []).filter((p) => !p.is_bundle && p.is_active !== false && p.id !== initial?.id), [products, initial?.id]);
  const nameOf = (id) => options.find((p) => p.id === id)?.name || (products || []).find((p) => p.id === id)?.name || 'Producto';

  // Vista previa en vivo de las variantes derivadas
  const key = JSON.stringify(components);
  useEffect(() => {
    if (components.length < 2) return undefined;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.post('/api/products/bundles/preview', { components, bundle_id: initial?.id || null });
        if (alive) setPreviewState({ key, data: r.data.data, error: '' });
      } catch (e) {
        if (alive) setPreviewState({ key, data: null, error: e.response?.data?.error || 'No se pudo calcular la vista previa.' });
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Solo vale la vista previa de los componentes actuales (con menos de 2 no hay)
  const current = components.length >= 2 && previewState.key === key;
  const preview = current ? previewState.data : null;
  const previewError = current ? previewState.error : '';

  const colors = useMemo(() => getColorOptions((preview?.variants || []).map((v) => ({ ...v, is_active: true }))), [preview]);

  const addComponent = () => {
    if (!pick || components.some((c) => c.product_id === pick)) return;
    setComponents([...components, { product_id: pick, quantity: 1 }]);
    setPick('');
  };
  const setQty = (id, q) => setComponents(components.map((c) => (c.product_id === id ? { ...c, quantity: Math.min(10, Math.max(1, Number(q) || 1)) } : c)));
  const remove = (id) => setComponents(components.filter((c) => c.product_id !== id));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('El nombre del set es obligatorio.');
    if (!(Number(form.price) > 0)) return setError('El precio del set debe ser mayor que 0.');
    if (components.length < 2) return setError('Un set necesita al menos 2 productos.');
    if (preview?.error) return setError(preview.error);
    setSaving(true);
    const body = { ...form, name: form.name.trim(), price: Number(form.price), components };
    try {
      const r = isEdit ? await api.put(`/api/products/bundles/${initial.id}`, body) : await api.post('/api/products/bundles', body);
      const id = r.data.data.id;
      const warnings = [];
      if (!isEdit) warnings.push(...await uploadProductPhotos(id, photos));
      if (!isEdit) {
        for (const c of colors) {
          const files = pendingColorFiles[c.key] || [];
          if (!files.length) continue;
          const fd = new FormData();
          fd.append('option', c.label);
          files.forEach((f) => fd.append('images', f));
          try { await api.post(`/api/products/${id}/option-images`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
          catch { warnings.push(`las fotos de ${c.label}`); }
        }
      }
      qc.invalidateQueries({ queryKey: ['products'] });
      if (warnings.length) {
        setSaving(false);
        setError(`Set guardado, pero no se pudieron subir ${warnings.join(', ')}. Puedes agregarlas editando el set.`);
        return;
      }
      onSave?.();
    } catch (err) {
      setSaving(false);
      setError(err.response?.data?.error || 'No se pudo guardar el set.');
    }
  };

  const inputCls = 'w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 py-6">
      <form onSubmit={submit} className="bg-[#0f1523] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-full overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-white font-semibold flex items-center gap-2"><Package size={18} /> {isEdit ? 'Editar set' : 'Crear set'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Cerrar"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2"><span className="text-slate-400 text-xs">Nombre</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Set Aria" maxLength={120} /></label>
            <label className="block"><span className="text-slate-400 text-xs">Precio del set</span>
              <input type="number" min="1" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={inputCls} /></label>
            <label className="block"><span className="text-slate-400 text-xs">Categoría</span>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} /></label>
            <label className="block"><span className="text-slate-400 text-xs">Género</span>
              <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })} className={inputCls}>
                <option value="mujer">Mujer</option>
                <option value="hombre">Hombre</option>
                <option value="unisex">Unisex</option>
              </select></label>
            <label className="block sm:col-span-2"><span className="text-slate-400 text-xs">Descripción</span>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={inputCls} /></label>
          </div>

          <div className="space-y-2">
            <p className="text-white text-sm font-medium">Productos del set</p>
            {components.map((c) => (
              <div key={c.product_id} className="flex items-center gap-2 bg-slate-800/30 border border-slate-700 rounded-lg px-3 py-2">
                <span className="flex-1 text-sm text-white truncate">{nameOf(c.product_id)}</span>
                <label className="text-slate-400 text-xs flex items-center gap-1">Cantidad
                  <input type="number" min="1" max="10" value={c.quantity} onChange={(e) => setQty(c.product_id, e.target.value)}
                    className="w-16 bg-[#131929] border border-slate-700 text-white rounded px-2 py-1 text-xs" /></label>
                <button type="button" onClick={() => remove(c.product_id)} className="p-1.5 text-slate-400 hover:text-red-400" aria-label="Quitar"><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="flex gap-2">
              <select value={pick} onChange={(e) => setPick(e.target.value)} className={inputCls}>
                <option value="">Agregar producto…</option>
                {options.filter((p) => !components.some((c) => c.product_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" onClick={addComponent} disabled={!pick}
                className="flex-shrink-0 px-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg text-sm flex items-center gap-1"><Plus size={14} /> Agregar</button>
            </div>
          </div>

          {/* Vista previa de variantes derivadas */}
          {components.length >= 2 && (
            <div className="space-y-2">
              <p className="text-white text-sm font-medium">Variantes del set (calculadas)</p>
              {!preview && !previewError && <p className="text-slate-500 text-xs">Calculando…</p>}
              {previewError && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{previewError}</p>}
              {preview?.error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{preview.error}</p>}
              {preview && !preview.error && (
                <>
                  {preview.has_variants ? (
                    <div className="flex flex-wrap gap-2">
                      {preview.variants.map((v) => (
                        <span key={v.id} className={`text-xs px-2 py-1 rounded-lg border ${v.stock > 0 ? 'border-slate-600 text-slate-200' : 'border-slate-700 text-slate-500'}`}>
                          {label(v.attributes)} · {v.stock} disp.
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-300 text-xs">Sin variantes · {preview.stock} disponibles</p>
                  )}
                  {preview.lost.length > 0 && (
                    <div className="text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg space-y-1">
                      <p className="flex items-center gap-1 font-medium"><AlertTriangle size={13} /> Combinaciones que no entran en el set:</p>
                      {preview.lost.map((l) => <p key={label(l.attributes)}>{label(l.attributes)}: no existe en {l.missing.join(', ')}</p>)}
                    </div>
                  )}
                  <p className="text-slate-500 text-xs">
                    Costo del set: {preview.cost_price == null ? 'falta el costo de algún producto' : formatCOP(preview.cost_price)}
                    {preview.cost_price != null && Number(form.price) > 0 && ` · margen ${Math.round((1 - preview.cost_price / Number(form.price)) * 100)}%`}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Fotos: principal, galería y por color (mismo manejo que un producto normal) */}
          <div className="space-y-3">
            <p className="text-white text-sm font-medium flex items-center gap-1"><ImageIcon size={14} /> Fotos del set</p>
            {isEdit
              ? <ProductPhotosEdit productId={initial.id} initialMain={initial.image_url} initialImages={initial.images} />
              : <ProductPhotosCreate value={photos} onChange={setPhotos} />}
            {isEdit
              ? <ColorPhotosEdit productId={initial.id} />
              : <ColorPhotosCreate colors={colors} pending={pendingColorFiles} onChange={setPendingColorFiles} />}
          </div>

          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-slate-800">
          <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg">
            {saving ? 'Guardando…' : isEdit ? 'Guardar set' : 'Crear set'}
          </button>
        </div>
      </form>
    </div>
  );
}
