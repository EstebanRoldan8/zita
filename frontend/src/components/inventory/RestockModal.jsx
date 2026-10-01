import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, PackagePlus, Check, AlertCircle } from 'lucide-react';
import api from '../../lib/api';
import { variantLabel, MODAL_OVERLAY, MODAL_PANEL, INPUT_CLS } from './inventoryLabels';

function normalizeText(text) {
  return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

let lineSeq = 0;
const newLine = () => ({ key: ++lineSeq, search: '', productId: '', variantId: '', quantity: '', status: null, message: '' });

export default function RestockModal({ products, onClose }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState([newLine()]);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [variantsByProduct, setVariantsByProduct] = useState({});

  const activeProducts = (products || []).filter((p) => p.is_active !== false);
  const productById = Object.fromEntries(activeProducts.map((p) => [p.id, p]));

  const updateLine = (key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const loadVariants = (productId) => {
    if (variantsByProduct[productId]) return;
    setVariantsByProduct((prev) => ({ ...prev, [productId]: { loading: true, list: [] } }));
    api.get(`/api/products/${productId}/variants`)
      .then((r) => setVariantsByProduct((prev) => ({ ...prev, [productId]: { loading: false, list: (r.data?.data || []).filter((v) => v.is_active) } })))
      .catch(() => setVariantsByProduct((prev) => ({ ...prev, [productId]: { loading: false, list: [], error: true } })));
  };

  const selectProduct = (line, productId) => {
    updateLine(line.key, { productId, variantId: '', status: null, message: '' });
    if (productId && productById[productId]?.has_variants) loadVariants(productId);
  };

  const validateLine = (l) => {
    const p = productById[l.productId];
    if (!p) return 'Selecciona un producto.';
    if (p.has_variants && !l.variantId) return 'Selecciona una variante.';
    const q = Number(l.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 100000) return 'La cantidad debe ser un entero entre 1 y 100000.';
    return null;
  };

  const send = async () => {
    setSending(true);
    setAttempted(true);
    const trimmedNote = note.trim() || undefined;
    let anyOk = false;
    // Secuencial: una petición por línea, sin detenerse en el primer error
    for (const l of lines) {
      if (l.status === 'ok') continue;
      const invalid = validateLine(l);
      if (invalid) {
        updateLine(l.key, { status: 'error', message: invalid });
        continue;
      }
      const p = productById[l.productId];
      try {
        const res = await api.post(`/api/products/${l.productId}/restock`, {
          quantity: Number(l.quantity),
          variant_id: p.has_variants ? l.variantId : undefined,
          note: trimmedNote,
        });
        const d = res.data?.data || {};
        const msg = d.stock_variante != null
          ? `Variante en ${d.stock_variante} · total ${d.stock_producto}`
          : `Stock en ${d.stock_producto}`;
        updateLine(l.key, { status: 'ok', message: msg });
        anyOk = true;
      } catch (err) {
        updateLine(l.key, { status: 'error', message: err.response?.data?.error || 'Error al registrar la entrada.' });
      }
    }
    if (anyOk) {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      qc.invalidateQueries({ queryKey: ['product-movements'] });
    }
    setSending(false);
  };

  const okCount = lines.filter((l) => l.status === 'ok').length;
  const errorCount = lines.filter((l) => l.status === 'error').length;
  const allDone = lines.length > 0 && okCount === lines.length;

  return (
    <div className={MODAL_OVERLAY}>
      <div className={`${MODAL_PANEL} md:max-w-2xl`}>
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <h3 className="text-white font-semibold flex items-center gap-2"><PackagePlus size={16} className="text-violet-400" /> Entrada de mercancía</h3>
          <button onClick={onClose} disabled={sending} className="text-slate-500 hover:text-white transition p-1 disabled:opacity-40"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
          <div>
            <label className="block text-slate-400 text-sm mb-1.5">Proveedor / factura (opcional)</label>
            <input type="text" value={note} maxLength={200} disabled={sending}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ej: Proveedor ABC, factura 1234"
              className={INPUT_CLS} />
            <p className="text-slate-600 text-xs mt-1">Se guarda como motivo en cada línea del historial.</p>
          </div>

          {lines.map((l, idx) => {
            const p = productById[l.productId];
            const locked = l.status === 'ok' || sending;
            const vState = p?.has_variants ? variantsByProduct[p.id] : null;
            const filtered = activeProducts
              .filter((x) => !l.search || normalizeText(x.name).includes(normalizeText(l.search)) || normalizeText(x.sku).includes(normalizeText(l.search)))
              .slice(0, 50);
            return (
              <div key={l.key} className={`p-3 rounded-lg border space-y-2 ${
                l.status === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5'
                  : l.status === 'error' ? 'border-red-500/30 bg-red-500/5'
                  : 'border-slate-700 bg-slate-800/30'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-slate-400 text-xs font-medium">Línea {idx + 1}</p>
                  {!locked && lines.length > 1 && (
                    <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                      className="text-slate-500 hover:text-red-400 transition p-1"><X size={14} /></button>
                  )}
                </div>

                {!locked && (
                  <input type="text" value={l.search} placeholder="Buscar producto por nombre o SKU..."
                    onChange={(e) => updateLine(l.key, { search: e.target.value })}
                    className={INPUT_CLS} />
                )}
                <select value={l.productId} disabled={locked} onChange={(e) => selectProduct(l, e.target.value)} className={INPUT_CLS}>
                  <option value="">Seleccionar producto...</option>
                  {p && !filtered.some((x) => x.id === p.id) && <option value={p.id}>{p.name}</option>}
                  {filtered.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}{x.has_variants ? ' (variantes)' : ` · stock ${x.stock ?? 0}`}</option>
                  ))}
                </select>

                {p?.has_variants && (
                  vState?.loading ? (
                    <p className="text-slate-500 text-xs py-1">Cargando variantes...</p>
                  ) : vState?.error ? (
                    <p className="text-red-400 text-xs py-1">No se pudieron cargar las variantes.</p>
                  ) : (
                    <select value={l.variantId} disabled={locked}
                      onChange={(e) => updateLine(l.key, { variantId: e.target.value, status: null, message: '' })}
                      className={INPUT_CLS}>
                      <option value="">Seleccionar variante...</option>
                      {(vState?.list || []).map((v) => (
                        <option key={v.id} value={v.id}>{variantLabel(v.attributes)} (stock actual: {v.stock})</option>
                      ))}
                    </select>
                  )
                )}

                <div className="flex items-center gap-2">
                  <label className="text-slate-400 text-xs flex-shrink-0">Cantidad</label>
                  <input type="number" inputMode="numeric" min="1" step="1" value={l.quantity} disabled={locked}
                    onChange={(e) => updateLine(l.key, { quantity: e.target.value, status: l.status === 'error' ? null : l.status })}
                    className={`${INPUT_CLS} max-w-[140px]`} />
                  {p && !p.has_variants && <span className="text-slate-500 text-xs">Actual: {p.stock ?? 0}</span>}
                </div>

                {l.status && (
                  <p className={`text-xs flex items-center gap-1.5 ${l.status === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {l.status === 'ok' ? <Check size={13} /> : <AlertCircle size={13} />} {l.message}
                  </p>
                )}
              </div>
            );
          })}

          {!sending && !allDone && (
            <button type="button" onClick={() => setLines((prev) => [...prev, newLine()])}
              className="w-full text-sm text-violet-400 hover:text-violet-300 py-2 transition">
              + Agregar línea
            </button>
          )}

          {attempted && !sending && (
            <p className={`text-sm px-3 py-2 rounded-lg border ${errorCount === 0
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
              : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'}`}>
              {okCount} de {lines.length} línea{lines.length !== 1 ? 's' : ''} registrada{okCount !== 1 ? 's' : ''}
              {errorCount > 0 ? ` · ${errorCount} con error` : ''}.
            </p>
          )}
        </div>

        <div className="flex gap-3 px-4 md:px-6 py-4 border-t border-slate-800 flex-shrink-0">
          <button onClick={onClose} disabled={sending}
            className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">
            {allDone ? 'Cerrar' : 'Cancelar'}
          </button>
          {!allDone && (
            <button onClick={send} disabled={sending}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
              {sending ? 'Registrando...' : errorCount > 0 ? 'Reintentar fallidas' : 'Registrar entrada'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
