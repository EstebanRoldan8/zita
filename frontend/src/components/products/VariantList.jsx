import { useState } from 'react';
import { Image as ImageIcon, Pencil, Power, Trash2 } from 'lucide-react';
import api from '../../lib/api';

const INPUT = 'bg-[#131929] border border-slate-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:border-violet-500';
const BTN = 'px-2.5 py-1.5 text-xs rounded border transition flex items-center gap-1 disabled:opacity-50';

const errorOf = (err, fallback) => err.response?.data?.error || fallback;
const labelOf = (v) => Object.values(v.attributes || {}).filter(Boolean).join(' / ') || 'Variante';

// Una variante ya guardada: ver, editar (color, talla, SKU, stock mínimo, foto), ajustar stock,
// desactivar / activar y eliminar (solo si nunca se usó). Las acciones destructivas piden confirmación.
function VariantRow({ productId, variant: v, onChange, onRemoved, onChanged }) {
  const [mode, setMode] = useState('view'); // view | edit | confirm-off | confirm-delete
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [stockDraft, setStockDraft] = useState(null);
  const base = `/api/products/${productId}/variants/${v.id}`;
  const usage = v.usage || {};
  const canDelete = usage.can_delete !== false;
  const stock = Number(v.stock) || 0;
  const vMin = v.min_stock ?? 2;

  const fail = (err, fallback) => setMsg({ type: 'error', text: errorOf(err, fallback) });
  const apply = (data, extra) => {
    onChange({ ...v, ...data, usage: v.usage });
    onChanged?.();
    setMsg(extra?.warning ? { type: 'warn', text: extra.warning } : { type: '', text: '' });
  };

  const startEdit = () => {
    setDraft({ attrs: { ...(v.attributes || {}) }, sku: v.sku || '', min_stock: String(v.min_stock ?? 2) });
    setMsg({ type: '', text: '' });
    setMode('edit');
  };

  const save = async () => {
    setBusy(true); setMsg({ type: '', text: '' });
    try {
      const body = { attributes: draft.attrs, min_stock: Number(draft.min_stock) };
      if (draft.sku.trim() && draft.sku.trim() !== (v.sku || '')) body.sku = draft.sku.trim();
      const r = await api.patch(base, body);
      apply(r.data.data, r.data);
      setMode('view');
    } catch (err) { fail(err, 'No se pudo guardar la variante.'); } finally { setBusy(false); }
  };

  const adjustStock = async () => {
    if (stockDraft === null) return;
    const n = Number(stockDraft);
    setStockDraft(null);
    if (!Number.isInteger(n) || n < 0 || n === stock) return;
    setBusy(true);
    try {
      const r = await api.patch(base, { stock: n });
      apply(r.data.data, r.data);
    } catch (err) { fail(err, 'No se pudo ajustar el stock.'); } finally { setBusy(false); }
  };

  const toggle = async (active) => {
    setBusy(true); setMsg({ type: '', text: '' });
    try {
      const r = await api.patch(base, { is_active: active });
      apply(r.data.data, r.data);
      setMode('view');
    } catch (err) { fail(err, active ? 'No se pudo activar.' : 'No se pudo desactivar.'); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setMsg({ type: '', text: '' });
    try {
      const r = await api.delete(base);
      onRemoved(v.id, r.data);
      onChanged?.();
    } catch (err) {
      if (err.response?.data?.code === 'VARIANT_HAS_HISTORY') onChange({ ...v, usage: { ...usage, can_delete: false, delete_block: err.response.data.error } });
      fail(err, 'No se pudo eliminar la variante.');
      setMode('view');
    } finally { setBusy(false); }
  };

  const uploadImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setMsg({ type: 'error', text: 'La imagen debe ser menor a 2 MB.' });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setMsg({ type: 'error', text: 'Solo se permiten JPG, PNG o WebP.' });
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('image', file);
      const r = await api.post(`${base}/image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange({ ...v, image_url: r.data?.data?.image_url || v.image_url });
      onChanged?.();
    } catch (err) { fail(err, 'No se pudo subir la foto de la variante.'); } finally { setBusy(false); }
  };

  const active = v.is_active !== false;
  return (
    <div className={`p-2 rounded-lg border ${active ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-900/60 border-slate-800'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <label title="Foto específica de esta variante (opcional)" aria-label={`Foto de la variante ${labelOf(v)}`}
          className="w-9 h-9 flex-shrink-0 bg-slate-800 border border-slate-700 rounded flex items-center justify-center overflow-hidden cursor-pointer hover:border-violet-500 transition">
          {v.image_url ? <img src={v.image_url} alt={`variante ${labelOf(v)}`} className="w-full h-full object-cover" /> : <ImageIcon size={14} className="text-slate-500" />}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={uploadImage} />
        </label>
        <div className="flex flex-wrap gap-1 flex-1 min-w-0">
          {Object.entries(v.attributes || {}).map(([k, val]) => (
            <span key={k} className={`text-xs px-2 py-1 rounded border ${active ? 'bg-violet-600/30 text-violet-300 border-violet-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>{k}: {val}</span>
          ))}
          {!active && <span className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-500">Inactiva</span>}
        </div>
        {active && (
          <label className="flex items-center gap-1 text-slate-500 text-xs">Stock
            <input type="number" inputMode="numeric" min="0" aria-label={`Stock de ${labelOf(v)}`}
              value={stockDraft ?? v.stock} disabled={busy}
              onChange={(e) => setStockDraft(e.target.value)} onBlur={adjustStock}
              className={`w-16 ${INPUT}`} />
          </label>
        )}
        {!active && <span className="text-slate-500 text-xs">Stock {stock}</span>}
      </div>

      {mode === 'edit' && draft && (
        <div className="mt-2 p-2 rounded border border-slate-700 bg-[#0f1523] space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.keys(draft.attrs).map((k) => (
              <label key={k} className="block text-slate-400 text-xs capitalize">{k}
                <input value={draft.attrs[k]} maxLength={40} onChange={(e) => setDraft({ ...draft, attrs: { ...draft.attrs, [k]: e.target.value } })} className={`w-full mt-1 ${INPUT}`} />
              </label>
            ))}
            <label className="block text-slate-400 text-xs">SKU
              <input value={draft.sku} maxLength={64} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} placeholder="Sin SKU" className={`w-full mt-1 ${INPUT}`} />
            </label>
            <label className="block text-slate-400 text-xs">Stock mínimo (alerta)
              <input type="number" inputMode="numeric" min="0" value={draft.min_stock} onChange={(e) => setDraft({ ...draft, min_stock: e.target.value })} className={`w-full mt-1 ${INPUT}`} />
            </label>
          </div>
          <p className="text-slate-500 text-xs">El stock se ajusta en el campo «Stock» de arriba y queda registrado como movimiento. La foto se cambia tocando la miniatura.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('view')} disabled={busy} className={`${BTN} flex-1 justify-center bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700`}>Cancelar</button>
            <button type="button" onClick={save} disabled={busy} className={`${BTN} flex-1 justify-center bg-violet-600 border-violet-500 text-white hover:bg-violet-500`}>{busy ? 'Guardando...' : 'Guardar variante'}</button>
          </div>
        </div>
      )}

      {mode === 'confirm-off' && (
        <div role="alertdialog" className="mt-2 p-2 rounded border border-yellow-500/30 bg-yellow-500/10 space-y-2">
          <p className="text-yellow-200 text-xs">¿Desactivar {labelOf(v)}? Deja de mostrarse y venderse en la tienda, pero conserva su historial. Puedes activarla de nuevo.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('view')} disabled={busy} className={`${BTN} flex-1 justify-center bg-slate-800 border-slate-700 text-slate-300`}>No, volver</button>
            <button type="button" onClick={() => toggle(false)} disabled={busy} className={`${BTN} flex-1 justify-center bg-yellow-600/30 border-yellow-500/40 text-yellow-100`}>{busy ? '...' : 'Sí, desactivar'}</button>
          </div>
        </div>
      )}

      {mode === 'confirm-delete' && (
        <div role="alertdialog" className="mt-2 p-2 rounded border border-red-500/30 bg-red-500/10 space-y-2">
          <p className="text-red-200 text-xs">¿Eliminar {labelOf(v)} para siempre? Nunca se usó, por eso se puede borrar. No se puede deshacer.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode('view')} disabled={busy} className={`${BTN} flex-1 justify-center bg-slate-800 border-slate-700 text-slate-300`}>No, volver</button>
            <button type="button" onClick={remove} disabled={busy} className={`${BTN} flex-1 justify-center bg-red-600/30 border-red-500/40 text-red-100`}>{busy ? '...' : 'Sí, eliminar'}</button>
          </div>
        </div>
      )}

      {mode === 'view' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={startEdit} disabled={busy} className={`${BTN} bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700`}><Pencil size={12} /> Editar</button>
          {active
            ? <button type="button" onClick={() => setMode('confirm-off')} disabled={busy} className={`${BTN} bg-yellow-500/10 border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/20`}><Power size={12} /> Desactivar</button>
            : <button type="button" onClick={() => toggle(true)} disabled={busy} className={`${BTN} bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20`}><Power size={12} /> {busy ? '...' : 'Activar'}</button>}
          {canDelete
            ? <button type="button" onClick={() => setMode('confirm-delete')} disabled={busy} className={`${BTN} bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20`}><Trash2 size={12} /> Eliminar</button>
            : <span className="text-slate-500 text-xs">No se puede eliminar: tiene historial{stock > 0 ? ' o stock' : ''}. {active ? 'Desactívala para retirarla.' : ''}</span>}
        </div>
      )}

      {active && mode === 'view' && (stock === 0
        ? <p className="mt-1 text-right text-red-400 text-xs">Agotada</p>
        : stock <= vMin ? <p className="mt-1 text-right text-yellow-400 text-xs">Stock bajo (mínimo {vMin})</p> : null)}
      {msg.text && (
        <p role={msg.type === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs px-2 py-1.5 rounded border ${msg.type === 'error' ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-yellow-200 bg-yellow-500/10 border-yellow-500/20'}`}>{msg.text}</p>
      )}
    </div>
  );
}

// Lista de variantes de un producto en edición: activas primero y, aparte, las inactivas (para activarlas o eliminarlas).
export default function VariantList({ productId, variants, setVariants, onChanged }) {
  const [showInactive, setShowInactive] = useState(false);
  const [notice, setNotice] = useState('');
  const active = variants.filter((v) => v.is_active !== false);
  const inactive = variants.filter((v) => v.is_active === false);
  const replace = (nv) => setVariants((prev) => prev.map((x) => (x.id === nv.id ? nv : x)));
  const removed = (id, resp) => {
    setVariants((prev) => prev.filter((x) => x.id !== id));
    setNotice(resp?.warning || '');
  };
  const row = (v) => <VariantRow key={v.id} productId={productId} variant={v} onChange={replace} onRemoved={removed} onChanged={onChanged} />;

  return (
    <div className="space-y-2 mb-4" data-testid="variant-list">
      {notice && <p role="status" className="text-yellow-200 text-xs bg-yellow-500/10 border border-yellow-500/20 px-2 py-1.5 rounded">{notice}</p>}
      {active.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-3 border border-dashed border-slate-700 rounded-lg">
          No hay variantes activas. {inactive.length > 0 ? 'Activa una de las inactivas o ' : ''}crea una abajo para que el producto se pueda vender.
        </p>
      )}
      <div className="space-y-2 max-h-[28rem] overflow-y-auto">{active.map(row)}</div>
      {inactive.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowInactive(!showInactive)} aria-expanded={showInactive}
            className="text-xs text-slate-400 hover:text-slate-200 transition">
            {showInactive ? '▾' : '▸'} Variantes inactivas ({inactive.length})
          </button>
          {showInactive && <div className="mt-2 space-y-2">{inactive.map(row)}</div>}
        </div>
      )}
    </div>
  );
}
