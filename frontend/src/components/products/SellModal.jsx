import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import api from '../../lib/api';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function normalizeText(text) {
  return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ── Sell Modal ──────────────────────────────────────────────────────────────
// sellPath: endpoint de venta (por defecto el del dueño).
// variants: variantes ya cargadas (el empleado no puede llamar a /api/products/:id/variants).
// showChannel: mostrar el selector de canal (el empleado solo vende presencial).
export default function SellModal({ product, clients, onClose, onSuccess, sellPath, variants: preloadedVariants, showChannel = true }) {
  const [qty, setQty] = useState('1');
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDrop, setShowClientDrop] = useState(false);
  const [soldVia, setSoldVia] = useState('presencial');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [fetchedVariants, setVariants] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const clientSearchRef = useRef(null);
  // Variantes ya cargadas (panel del empleado) o pedidas al backend (dueño)
  const variants = preloadedVariants ?? fetchedVariants;

  useEffect(() => {
    if (product.has_variants && !preloadedVariants) {
      setLoadingVariants(true);
      api.get(`/api/products/${product.id}/variants`)
        .then(r => setVariants(r.data?.data?.filter(v => v.is_active) || []))
        .catch(err => console.error('Error loading variants:', err))
        .finally(() => setLoadingVariants(false));
    }
  }, [product, preloadedVariants]);

  const filteredClients = (clients || []).filter((c) => {
    const searchNorm = normalizeText(clientSearch);
    return !clientSearch || normalizeText(c.name).includes(searchNorm) || c.phone?.includes(clientSearch);
  }).slice(0, 8);

  const selectedClient = (clients || []).find((c) => c.id === clientId);
  const selectedVariant = variants.find(v => v.id === selectedVariantId);

  const handleSell = async () => {
    setError('');
    const q = Number(qty);
    if (!q || q <= 0) return setError('La cantidad debe ser mayor a 0.');
    if (product.has_variants && !selectedVariantId) return setError('Debes seleccionar una variante.');
    const availableStock = product.has_variants ? selectedVariant?.stock || 0 : product.stock;
    if (q > availableStock) return setError(`Stock insuficiente. Disponible: ${availableStock}.`);
    setLoading(true);
    try {
      await api.post(sellPath || `/api/products/${product.id}/sell`, {
        quantity: q,
        client_id: clientId || null,
        sold_via: soldVia,
        variant_id: selectedVariantId || null,
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al registrar la venta.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Reset variant selection when loading or if only one variant
    if (!loadingVariants && variants.length === 1) {
      setSelectedVariantId(variants[0].id);
    }
  }, [loadingVariants, variants]);

  const inputCls = "w-full bg-[#0f172a] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition";
  const labelCls = "block text-slate-300 text-sm mb-1.5";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50 md:px-4">
      <div className="bg-[#131929] border border-violet-500/20 md:rounded-2xl w-full md:max-w-sm h-[100dvh] md:h-auto flex flex-col md:block md:p-6 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800 md:border-0 md:p-0 md:mb-5 flex-shrink-0">
          <h3 className="text-white font-semibold">Registrar venta</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-4 md:p-0 md:overflow-visible">
        <div className="mb-4 p-3 bg-[#0f172a] border border-slate-700 rounded-xl">
          <p className="text-white text-sm font-semibold">{product.name}</p>
          <p className="text-violet-400 text-xs mt-0.5">{formatCOP(product.price)}</p>
        </div>

        {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mb-4">{error}</p>}

        <div className="space-y-3">
          {product.has_variants && (
            <div>
              <label className={labelCls}>Variante</label>
              {loadingVariants ? (
                <p className="text-slate-500 text-xs py-2">Cargando variantes...</p>
              ) : (
                <select value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value)} className={inputCls}>
                  <option value="">Seleccionar variante...</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {Object.entries(v.attributes || {}).map(([k, val]) => `${k}: ${val}`).join(' · ')} (Stock: {v.stock})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div>
            <label className={labelCls}>Cantidad</label>
            <input type="number" inputMode="numeric" min="1" max={product.has_variants ? selectedVariant?.stock : product.stock} value={qty}
              onChange={(e) => setQty(e.target.value)} className={inputCls} />
            {selectedVariant && <p className="text-slate-400 text-xs mt-1">Stock disponible: {selectedVariant.stock}</p>}
            {!product.has_variants && <p className="text-slate-400 text-xs mt-1">Stock disponible: {product.stock}</p>}
          </div>
          {showChannel && (
            <div>
              <label className={labelCls}>Canal de venta</label>
              <select value={soldVia} onChange={(e) => setSoldVia(e.target.value)} className={inputCls}>
                <option value="presencial">Presencial</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>
          )}
          <div>
            <label className={labelCls}>Cliente (opcional)</label>
            <div className="relative">
              {selectedClient ? (
                <div className="flex items-center justify-between bg-[#0f172a] border border-violet-500/50 rounded-lg px-4 py-2.5">
                  <div>
                    <p className="text-white text-sm font-medium">{selectedClient.name}</p>
                    <p className="text-slate-400 text-xs">{selectedClient.phone}</p>
                  </div>
                  <button type="button" onClick={() => { setClientId(''); setClientSearch(''); }}
                    className="text-slate-500 hover:text-white p-0.5 transition"><X size={14} /></button>
                </div>
              ) : (
                <input ref={clientSearchRef} type="text" value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setShowClientDrop(true); }}
                  onFocus={() => setShowClientDrop(true)}
                  placeholder="Buscar cliente por nombre o teléfono..."
                  className={`${inputCls} placeholder-slate-500`} />
              )}
              {showClientDrop && !selectedClient && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#0f172a] border border-slate-700 rounded-lg overflow-hidden z-20 shadow-xl max-h-44 overflow-y-auto">
                  <button type="button" onMouseDown={() => { setClientId(''); setClientSearch(''); setShowClientDrop(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-800 border-b border-slate-700 transition">
                    Cliente sin registro
                  </button>
                  {filteredClients.length === 0 && clientSearch ? (
                    <p className="text-slate-500 text-xs px-4 py-2.5">Sin resultados</p>
                  ) : (
                    filteredClients.map((c) => (
                      <button key={c.id} type="button"
                        onMouseDown={() => { setClientId(c.id); setClientSearch(''); setShowClientDrop(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-800 transition">
                        <span className="text-white">{c.name}</span>
                        <span className="text-slate-500 text-xs ml-2">{c.phone}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {qty && Number(qty) > 0 && (
          <p className="text-white font-bold text-sm mt-3">
            Total: <span className="text-violet-400">{formatCOP(product.price * Number(qty))}</span>
          </p>
        )}
        </div>

        <div className="flex gap-3 px-4 py-4 border-t border-slate-800 md:border-0 md:p-0 md:mt-5 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium py-2.5 rounded-lg transition">
            Cancelar
          </button>
          <button onClick={handleSell} disabled={loading}
            className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
            {loading ? 'Registrando...' : 'Registrar venta'}
          </button>
        </div>
      </div>
    </div>
  );
}
