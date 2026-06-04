import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, X, AlertTriangle, ShoppingCart, Edit2, TrendingUp, ToggleRight, ToggleLeft, Trash2, Image as ImageIcon, Layers2 } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { es } from 'date-fns/locale';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

registerLocale('es', es);

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function normalizeText(text) {
  return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const STOCK_STATUS = (stock, min_stock) => {
  if (stock === 0) return { label: 'Agotado', cls: 'text-red-400 bg-red-500/10 border-red-500/20' };
  if (stock <= min_stock) return { label: 'Stock bajo', cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' };
  return { label: 'OK', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
};

const emptyForm = { name: '', description: '', price: '', stock: '0', min_stock: '5', category: '', cost_price: '' };

// ── Sell Modal ──────────────────────────────────────────────────────────────
function SellModal({ product, clients, onClose, onSuccess }) {
  const [qty, setQty] = useState('1');
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDrop, setShowClientDrop] = useState(false);
  const [soldVia, setSoldVia] = useState('presencial');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [variants, setVariants] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const clientSearchRef = useRef(null);

  useEffect(() => {
    if (product.has_variants) {
      setLoadingVariants(true);
      api.get(`/api/products/${product.id}/variants`)
        .then(r => setVariants(r.data?.data?.filter(v => v.is_active) || []))
        .catch(err => console.error('Error loading variants:', err))
        .finally(() => setLoadingVariants(false));
    }
  }, [product]);

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
      await api.post(`/api/products/${product.id}/sell`, {
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

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="bg-[#1e293b] border border-white/15 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-white font-semibold">Registrar venta</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="mb-4 p-3 bg-[#131929]/80 border border-slate-700 rounded-xl shadow-lg shadow-black/30">
          <p className="text-white text-sm font-medium">{product.name}</p>
          <p className="text-slate-400 text-xs mt-0.5">{formatCOP(product.price)}</p>
        </div>

        {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mb-4">{error}</p>}

        <div className="space-y-3">
          {product.has_variants && (
            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Variante</label>
              {loadingVariants ? (
                <p className="text-slate-500 text-xs py-2">Cargando variantes...</p>
              ) : (
                <select value={selectedVariantId} onChange={(e) => setSelectedVariantId(e.target.value)}
                  className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all duration-150">
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
            <label className="block text-slate-400 text-sm mb-1.5">Cantidad</label>
            <input type="number" min="1" max={product.has_variants ? selectedVariant?.stock : product.stock} value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition" />
            {selectedVariant && <p className="text-slate-500 text-xs mt-1">Stock disponible: {selectedVariant.stock}</p>}
            {!product.has_variants && <p className="text-slate-500 text-xs mt-1">Stock disponible: {product.stock}</p>}
          </div>
          <div>
            <label className="block text-slate-400 text-sm mb-1.5">Canal de venta</label>
            <select value={soldVia} onChange={(e) => setSoldVia(e.target.value)}
              className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition">
              <option value="presencial">Presencial</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-400 text-sm mb-1.5">Cliente (opcional)</label>
            <div className="relative">
              {selectedClient ? (
                <div className="flex items-center justify-between bg-[#131929] border border-violet-500/50 rounded-lg px-4 py-2.5">
                  <div>
                    <p className="text-white text-sm font-medium">{selectedClient.name}</p>
                    <p className="text-slate-500 text-xs">{selectedClient.phone}</p>
                  </div>
                  <button type="button" onClick={() => { setClientId(''); setClientSearch(''); }}
                    className="text-slate-500 hover:text-white p-0.5 transition"><X size={14} /></button>
                </div>
              ) : (
                <input ref={clientSearchRef} type="text" value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setShowClientDrop(true); }}
                  onFocus={() => setShowClientDrop(true)}
                  placeholder="Buscar cliente por nombre o teléfono..."
                  className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition" />
              )}
              {showClientDrop && !selectedClient && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#131929] border border-slate-700 rounded-lg overflow-hidden z-20 shadow-xl max-h-44 overflow-y-auto">
                  <button type="button" onMouseDown={() => { setClientId(''); setClientSearch(''); setShowClientDrop(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-700 border-b border-slate-700 transition">
                    Cliente sin registro
                  </button>
                  {filteredClients.length === 0 && clientSearch ? (
                    <p className="text-slate-500 text-xs px-4 py-2.5">Sin resultados</p>
                  ) : (
                    filteredClients.map((c) => (
                      <button key={c.id} type="button"
                        onMouseDown={() => { setClientId(c.id); setClientSearch(''); setShowClientDrop(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-700 transition">
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
          <p className="text-slate-400 text-sm mt-3">
            Total: <span className="text-white font-semibold">{formatCOP(product.price * Number(qty))}</span>
          </p>
        )}

        <div className="flex gap-3 mt-5">
          <button onClick={onClose}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">
            Cancelar
          </button>
          <button onClick={handleSell} disabled={loading}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
            {loading ? 'Registrando...' : 'Registrar venta'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Product Form Modal ──────────────────────────────────────────────────────
function ProductModal({ initial, onClose, onSave, isTienda }) {
  const [form, setForm] = useState({
    ...emptyForm,
    ...initial,
    cost_price: initial?.cost_price ?? '',
  });
  const [imagePreview, setImagePreview] = useState(initial?.image_url || null);
  const [imageFile, setImageFile] = useState(null);
  const [hasVariants, setHasVariants] = useState(initial?.has_variants || false);
  const [variants, setVariants] = useState([]);
  const [newVariant, setNewVariant] = useState({ attributes: {}, stock: 0 });
  const [variantAttrs, setVariantAttrs] = useState([{ key: '', value: '' }]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const fileInputRef = useRef(null);
  const isEdit = !!initial?.id;
  const qc = useQueryClient();

  useEffect(() => {
    if (isEdit && hasVariants) {
      setLoadingVariants(true);
      api.get(`/api/products/${initial.id}/variants`)
        .then(r => setVariants(r.data?.data || []))
        .catch(err => console.error('Error loading variants:', err))
        .finally(() => setLoadingVariants(false));
    }
  }, [isEdit, hasVariants, initial?.id]);

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setError('La imagen debe ser menor a 2MB');
        return;
      }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setError('Solo se permiten JPG, PNG o WebP');
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleAddVariantAttr = () => {
    setVariantAttrs([...variantAttrs, { key: '', value: '' }]);
  };

  const handleRemoveVariantAttr = (idx) => {
    setVariantAttrs(variantAttrs.filter((_, i) => i !== idx));
  };

  const handleVariantAttrChange = (idx, field, val) => {
    const updated = [...variantAttrs];
    updated[idx] = { ...updated[idx], [field]: val };
    setVariantAttrs(updated);
  };

  const handleCreateVariant = async () => {
    setError('');
    const attrs = Object.fromEntries(variantAttrs.filter(a => a.key && a.value).map(a => [a.key, a.value]));
    if (Object.keys(attrs).length === 0) return setError('Agrega al menos un atributo a la variante.');
    if (Number(newVariant.stock) < 0) return setError('El stock no puede ser negativo.');

    try {
      if (isEdit) {
        await api.post(`/api/products/${initial.id}/variants`, {
          attributes: attrs,
          stock: Number(newVariant.stock),
        });
      }
      setVariants(prev => [...prev, { attributes: attrs, stock: Number(newVariant.stock), is_active: true }]);
      setNewVariant({ attributes: {}, stock: 0 });
      setVariantAttrs([{ key: '', value: '' }]);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear variante.');
    }
  };

  const handleUpdateVariantStock = async (variantId, newStock) => {
    try {
      await api.patch(`/api/products/${initial.id}/variants/${variantId}`, { stock: newStock });
      setVariants(prev => prev.map(v => v.id === variantId ? { ...v, stock: newStock } : v));
    } catch (err) {
      setError(err.response?.data?.error || 'Error al actualizar stock.');
    }
  };

  const handleDeactivateVariant = async (variantId) => {
    try {
      await api.delete(`/api/products/${initial.id}/variants/${variantId}`);
      setVariants(prev => prev.map(v => v.id === variantId ? { ...v, is_active: false } : v));
    } catch (err) {
      setError(err.response?.data?.error || 'Error al desactivar variante.');
    }
  };

  const handleSave = async () => {
    setError('');
    if (!form.name?.trim()) return setError('El nombre es obligatorio.');
    if (form.price === '' || Number(form.price) < 0) return setError('El precio debe ser mayor o igual a 0.');
    if (hasVariants && variants.filter(v => v.is_active).length === 0) {
      return setError('Debes crear al menos una variante activa.');
    }

    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: Number(form.price),
        stock: hasVariants ? 0 : Number(form.stock),
        min_stock: Number(form.min_stock),
        category: form.category.trim() || null,
        has_variants: hasVariants,
        cost_price: form.cost_price !== '' && form.cost_price !== null ? Number(form.cost_price) : null,
      };

      if (isEdit) {
        await api.put(`/api/products/${initial.id}`, payload);
        if (imageFile) {
          const formData = new FormData();
          formData.append('image', imageFile);
          await api.post(`/api/products/${initial.id}/image`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        }
      } else {
        const res = await api.post('/api/products', payload);
        if (imageFile) {
          const formData = new FormData();
          formData.append('image', imageFile);
          await api.post(`/api/products/${res.data.data.id}/image`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        }
      }
      qc.invalidateQueries({ queryKey: ['products'] });
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar el producto.');
    } finally {
      setLoading(false);
    }
  };

  const field = (label, key, type = 'text', extra = {}) => (
    <div key={key}>
      <label className="block text-slate-400 text-sm mb-1.5">{label}</label>
      <input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...extra}
        className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition" />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 overflow-y-auto py-4">
      <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-2xl shadow-xl border border-violet-500/25 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h3 className="text-white font-semibold">{isEdit ? 'Editar producto' : 'Nuevo producto'}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="px-6 py-4 max-h-[calc(100vh-200px)] overflow-y-auto space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}

          {/* Image upload */}
          {isTienda && (
            <div>
              <label className="block text-slate-400 text-sm mb-2">Foto del producto</label>
              <div className="flex gap-3">
                <div className="w-20 h-20 bg-slate-800 border border-slate-700 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {imagePreview ? (
                    <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={28} className="text-slate-600" />
                  )}
                </div>
                <div className="flex-1">
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
                  <button type="button" onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2 rounded-lg transition">
                    Seleccionar imagen
                  </button>
                  <p className="text-slate-500 text-xs mt-1">JPG, PNG o WebP — máx 2MB</p>
                </div>
              </div>
            </div>
          )}

          {/* Basic info */}
          <div className="space-y-3">
            {field('Nombre *', 'name')}
            {field('Descripción (opcional)', 'description')}
            {field('Categoría (opcional)', 'category')}
          </div>

          {/* Variants toggle */}
          {isTienda && (
            <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
              <input type="checkbox" checked={hasVariants} onChange={(e) => setHasVariants(e.target.checked)}
                className="w-4 h-4 rounded bg-[#131929] border border-slate-700 cursor-pointer accent-violet-600" />
              <label className="flex-1 cursor-pointer">
                <p className="text-slate-300 text-sm font-medium">Este producto tiene variantes</p>
                <p className="text-slate-500 text-xs">Tallas, colores, etc.</p>
              </label>
              {hasVariants && <Layers2 size={16} className="text-violet-400 flex-shrink-0" />}
            </div>
          )}

          {/* Price and stock */}
          {isTienda && hasVariants ? (
            <div className="grid grid-cols-2 gap-3">
              {field('Precio *', 'price', 'number', { min: '0', step: '100' })}
              {field('Stock mínimo', 'min_stock', 'number', { min: '0' })}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {field('Precio *', 'price', 'number', { min: '0', step: '100' })}
              {field('Stock inicial', 'stock', 'number', { min: '0' })}
              {field('Stock mínimo', 'min_stock', 'number', { min: '0' })}
            </div>
          )}

          {/* Cost price */}
          <div>
            <label className="block text-slate-400 text-sm mb-1.5">Precio de costo (opcional)</label>
            <input
              type="number" min="0" step="100"
              value={form.cost_price}
              onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
              placeholder="0"
              className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition"
            />
            <p className="text-slate-600 text-xs mt-1">Si lo defines, se registrará un egreso automático al vender</p>
          </div>

          {/* Variants section */}
          {isTienda && hasVariants && isEdit && (
            <div className="border-t border-slate-800 pt-4">
              <h4 className="text-white text-sm font-semibold mb-3">Variantes ({variants.filter(v => v.is_active).length})</h4>

              {loadingVariants ? (
                <p className="text-slate-500 text-sm text-center py-4">Cargando variantes...</p>
              ) : (
                <>
                  {variants.filter(v => v.is_active).length > 0 && (
                    <div className="mb-4 space-y-2 max-h-40 overflow-y-auto">
                      {variants.filter(v => v.is_active).map((v, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2 p-2 bg-slate-800/50 rounded-lg border border-slate-700">
                          <div className="flex flex-wrap gap-1 flex-1">
                            {Object.entries(v.attributes || {}).map(([k, val]) => (
                              <span key={k} className="text-xs px-2 py-1 bg-violet-600/30 text-violet-300 rounded border border-violet-500/30">
                                {k}: {val}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <input type="number" min="0" value={v.stock}
                              onChange={(e) => handleUpdateVariantStock(v.id, Number(e.target.value))}
                              className="w-16 bg-[#131929] border border-slate-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:border-violet-500" />
                            <button type="button" onClick={() => handleDeactivateVariant(v.id)}
                              className="px-2 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 transition">
                              Desactivar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="p-3 bg-slate-800/30 border border-slate-700 rounded-lg space-y-2">
                    <p className="text-slate-400 text-xs font-medium">Agregar variante</p>
                    <div className="space-y-1.5">
                      {variantAttrs.map((attr, idx) => (
                        <div key={idx} className="flex gap-1.5">
                          <input type="text" placeholder="Clave (ej: talla)" value={attr.key}
                            onChange={(e) => handleVariantAttrChange(idx, 'key', e.target.value)}
                            className="flex-1 bg-[#131929] border border-slate-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:border-violet-500" />
                          <input type="text" placeholder="Valor (ej: M)" value={attr.value}
                            onChange={(e) => handleVariantAttrChange(idx, 'value', e.target.value)}
                            className="flex-1 bg-[#131929] border border-slate-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:border-violet-500" />
                          {variantAttrs.length > 1 && (
                            <button type="button" onClick={() => handleRemoveVariantAttr(idx)}
                              className="px-2 py-1.5 text-slate-500 hover:text-red-400 transition">
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={handleAddVariantAttr}
                      className="w-full text-xs text-violet-400 hover:text-violet-300 py-1.5 transition">
                      + Agregar atributo
                    </button>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Stock</label>
                      <input type="number" min="0" value={newVariant.stock}
                        onChange={(e) => setNewVariant({ ...newVariant, stock: Number(e.target.value) })}
                        className="w-full bg-[#131929] border border-slate-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:border-violet-500" />
                    </div>
                    <button type="button" onClick={handleCreateVariant}
                      className="w-full text-xs bg-violet-600 hover:bg-violet-500 text-white font-medium py-1.5 rounded transition">
                      Crear variante
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-800">
          <button onClick={onClose}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={loading}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
            {loading ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Catálogo Tab ─────────────────────────────────────────────────────────────
function CatalogoTab({ products, clients, showInactive, onShowInactiveChange, sortBy, onSortChange, isTienda, newModal, setNewModal }) {
  if (!products || !Array.isArray(products)) {
    return <div className="text-slate-500">Error cargando productos</div>;
  }

  const qc = useQueryClient();
  const [sellProduct, setSellProduct] = useState(null);
  const [editProduct, setEditProduct] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const toggleMutation = useMutation({
    mutationFn: (id) => api.put(`/api/products/${id}/toggle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/api/products/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); setDeleteConfirm(null); },
  });

  const sortFn = {
    name: (a, b) => a.name.localeCompare(b.name),
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price
  }[sortBy];

  const sorted = [
    ...products
      .filter(p => p.is_active)
      .sort(sortFn),
    ...(showInactive ? products
      .filter(p => !p.is_active)
      .sort(sortFn) : [])
  ];
  const active = sorted.filter((p) => p.is_active);
  const inactive = sorted.filter((p) => !p.is_active);
  const displayedProducts = showInactive ? sorted : active;

  if (active.length === 0) {
    return (
      <div className="text-center py-20">
        <Package size={40} className="mx-auto mb-3 text-slate-700" />
        <p className="text-slate-500">No hay productos registrados</p>
        <button onClick={() => setNewModal(true)}
          className="mt-4 flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition mx-auto">
          <Plus size={15} /> Agregar producto
        </button>
        {newModal && <ProductModal onClose={() => setNewModal(false)} onSave={() => { qc.invalidateQueries({ queryKey: ['products'] }); setNewModal(false); }} isTienda={isTienda} />}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => onShowInactiveChange(e.target.checked)}
              className="w-4 h-4 rounded bg-[#131929] border border-slate-700 cursor-pointer accent-violet-600"
            />
            <span className="text-slate-400 text-sm whitespace-nowrap">
              Mostrar inactivos ({inactive.length})
            </span>
          </label>
          <select value={sortBy} onChange={(e) => onSortChange(e.target.value)}
            className="bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500 transition">
            <option value="name">A - Z</option>
            <option value="price_asc">Precio: menor a mayor</option>
            <option value="price_desc">Precio: mayor a menor</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayedProducts.map((p) => {
          const displayStock = p.has_variants ? 0 : p.stock;
          const status = STOCK_STATUS(displayStock, p.min_stock);
          const inactive = p.is_active === false;
          return (
            <div key={p.id} className={`group bg-[#131929] border border-violet-500/15 hover:border-violet-500/35 rounded-xl shadow-lg shadow-black/30 overflow-hidden transition-all duration-200 flex flex-col justify-between min-h-[130px] ${inactive ? 'opacity-50' : ''}`}>
              {/* Image */}
              {isTienda && (
                <div className="w-full h-32 bg-slate-800 flex items-center justify-center overflow-hidden border-b border-slate-800 relative">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={40} className="text-slate-700" />
                  )}
                  {p.has_variants && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-violet-600/90 px-2 py-1 rounded-full text-white text-[10px] font-medium">
                      <Layers2 size={12} /> Variantes
                    </div>
                  )}
                </div>
              )}

              <div className="p-3 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="text-white font-semibold text-sm leading-tight truncate">{p.name}</p>
                    {p.category && <p className="text-slate-500 text-xs mt-0.5">{p.category}</p>}
                  </div>
                  {inactive ? (
                    <span className="text-xs font-medium text-slate-600 bg-[#131929] border border-slate-700 px-2 py-0.5 rounded-full flex-shrink-0">Inactivo</span>
                  ) : status.label === 'OK' ? (
                    <span className="text-[10px] font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 px-1.5 py-0.5 rounded-full flex-shrink-0">OK</span>
                  ) : (
                    <span className={`text-xs font-medium border px-2 py-0.5 rounded-full flex-shrink-0 ${status.cls}`}>
                      {status.label}
                    </span>
                  )}
                </div>

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-slate-500 text-xs">Precio</p>
                    <p className="text-white font-bold">{formatCOP(p.price)}</p>
                  </div>
                  {p.cost_price != null ? (
                    <div className="text-right">
                      <p className="text-slate-500 text-xs">Margen</p>
                      <p className={`font-bold text-sm ${
                        ((p.price - p.cost_price) / p.price * 100) > 40 ? 'text-emerald-400' :
                        ((p.price - p.cost_price) / p.price * 100) >= 20 ? 'text-yellow-400' :
                        'text-red-400'
                      }`}>
                        {((p.price - p.cost_price) / p.price * 100).toFixed(0)}%
                      </p>
                    </div>
                  ) : !p.has_variants ? (
                    <div className="text-right">
                      <p className="text-slate-500 text-xs">Stock</p>
                      <p className={`font-bold ${p.stock === 0 ? 'text-red-400' : p.stock <= p.min_stock ? 'text-yellow-400' : 'text-white'}`}>
                        {p.stock} <span className="text-slate-500 text-xs font-normal">/ mín {p.min_stock}</span>
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => setSellProduct(p)} disabled={displayStock === 0 || !p.is_active}
                    className="w-full py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors flex items-center justify-center gap-2 mt-3 disabled:opacity-40">
                    <ShoppingCart size={13} /> Vender
                  </button>
                  <div className="ml-auto flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditProduct(p)}
                      className="p-2 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/20 transition">
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => toggleMutation.mutate(p.id)}
                      disabled={toggleMutation.isPending}
                      className="p-2 rounded-lg text-slate-400 hover:text-yellow-400 hover:bg-yellow-500/20 transition disabled:opacity-50"
                      title={p.is_active ? 'Desactivar' : 'Reactivar'}
                    >
                      {p.is_active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(p)}
                      className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/20 transition"
                      title="Eliminar"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {sellProduct && (
        <SellModal
          product={sellProduct}
          clients={clients}
          onClose={() => setSellProduct(null)}
          onSuccess={() => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['product-sales'] }); setSellProduct(null); }}
        />
      )}
      {editProduct && (
        <ProductModal
          initial={editProduct}
          onClose={() => setEditProduct(null)}
          onSave={() => { qc.invalidateQueries({ queryKey: ['products'] }); setEditProduct(null); }}
          isTienda={isTienda}
        />
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl">
            <h3 className="text-white font-semibold text-lg mb-4">Eliminar producto</h3>
            <p className="text-slate-300 text-sm mb-6">
              ¿Estás seguro que deseas eliminar <span className="font-semibold">{deleteConfirm.name}</span>? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleteMutation.isPending}
                className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition"
              >
                {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Inventario Tab ───────────────────────────────────────────────────────────
function InventarioTab({ products, sales, sortBy, onSortChange }) {
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [productSales, setProductSales] = useState([]);
  const [error, setError] = useState(null);
  const [inventoryError, setInventoryError] = useState(null);
  const [expandedProducts, setExpandedProducts] = useState({});

  useEffect(() => {
    console.log('inventario data:', { products, sales, sortBy });
  }, [products, sales, sortBy]);

  useEffect(() => {
    api.get(`/api/cash/products-sold?period=month&month=${selectedMonth}`)
      .then(r => {
        const data = r.data?.data || [];
        setProductSales(data);
        console.log('productSales data:', data);
      })
      .catch(err => {
        console.error('Error fetching product sales:', err);
        setProductSales([]);
      });
  }, [selectedMonth]);

  useEffect(() => {
    try {
      if (products && Array.isArray(products)) {
        products.forEach(p => {
          if (p && p.id) {
            const s = STOCK_STATUS(p.stock ?? 0, p.min_stock ?? 0);
            if (!s) throw new Error(`Invalid stock status for product ${p.id}`);
          }
        });
      }
      setInventoryError(null);
    } catch(e) {
      console.error('Inventory validation error:', e);
      setInventoryError(e.message);
    }
  }, [products]);

  const sortFn = {
    name: (a, b) => (a.name || '').localeCompare(b.name || ''),
    price_asc: (a, b) => (a.price || 0) - (b.price || 0),
    price_desc: (a, b) => (b.price || 0) - (a.price || 0)
  }[sortBy];

  let sortedProducts = [];
  let safeSortedProducts = [];
  let outOfStock = [];
  let totalSales = 0;

  try {
    if (!Array.isArray(products) || products.length === 0) {
      sortedProducts = [];
      safeSortedProducts = [];
      outOfStock = [];
    } else {
      sortedProducts = [...products].sort(sortFn);
      safeSortedProducts = sortedProducts.filter(p => p && p.id);
      outOfStock = safeSortedProducts.filter((p) => (p?.stock ?? 0) === 0);
    }
    totalSales = (productSales || []).reduce((s, r) => s + Number(r?.total ?? 0), 0);
  } catch (err) {
    console.error('Error rendering inventario tab:', err);
    setError(err.message);
  }

  if (error) {
    return (
      <div className="text-center py-10">
        <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-4 py-3 rounded-lg inline-block">
          Error al cargar el inventario: {error}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {outOfStock.length > 0 && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-red-400 text-sm">
            <span className="font-semibold">{outOfStock.length} producto{outOfStock.length > 1 ? 's' : ''} agotado{outOfStock.length > 1 ? 's': ''}:</span>{' '}
            {outOfStock.map((p) => p.name).join(', ')}
          </p>
        </div>
      )}

      {/* Stock table */}
      <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-white text-sm font-semibold">Estado del inventario</h3>
          <select value={sortBy} onChange={(e) => onSortChange(e.target.value)}
            className="bg-[#131929] border border-white/10 text-white/70 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500/50 transition">
            <option value="name">A - Z</option>
            <option value="price_asc">Precio: menor a mayor</option>
            <option value="price_desc">Precio: mayor a menor</option>
          </select>
        </div>
        {inventoryError ? (
          <p className="text-red-400 p-4 text-sm">Error cargando inventario: {inventoryError}</p>
        ) : safeSortedProducts.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-10">Sin productos registrados</p>
        ) : (
          <>
            {/* Mobile cards view */}
            <div className="md:hidden">
              {safeSortedProducts.map((p) => {
                const status = STOCK_STATUS(p.stock ?? 0, p.min_stock ?? 0);
                return (
                  <div key={p.id} className="p-4 border-b border-slate-800/50">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-white font-medium text-sm">{p.name}</p>
                      <span className={`text-xs border px-2 py-0.5 rounded-full ${status.cls}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-slate-500">Precio</p>
                        <p className="text-slate-300">{formatCOP(p.price)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Stock</p>
                        <p className={(p.stock ?? 0) === 0 ? 'text-red-400 font-bold' : (p.stock ?? 0) <= (p.min_stock ?? 0) ? 'text-yellow-400' : 'text-white'}>
                          {p.stock ?? 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Mínimo</p>
                        <p className="text-slate-400">{p.min_stock ?? 0}</p>
                      </div>
                    </div>
                    {p.category && <p className="text-slate-500 text-xs mt-1">{p.category}</p>}
                  </div>
                );
              })}
            </div>

            {/* Desktop table view */}
            <div className="hidden md:block overflow-x-auto rounded-xl border border-violet-500/15">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[#0d1420]">
                    <th className="w-[26%] text-left text-white/40 font-medium px-4 py-3 text-xs uppercase tracking-wider">Producto</th>
                    <th className="w-[11%] text-center text-white/40 font-medium px-4 py-3 text-xs uppercase tracking-wider">Categoría</th>
                    <th className="w-[11%] text-left text-white/40 font-medium px-4 py-3 text-xs uppercase tracking-wider">Precio</th>
                    <th className="w-[10%] text-left text-white/40 font-medium px-4 py-3 text-xs uppercase tracking-wider">Costo</th>
                    <th className="w-[9%] text-center text-white/40 font-medium px-4 py-3 text-xs uppercase tracking-wider">Margen</th>
                    <th className="w-[9%] text-center text-white/40 font-medium px-4 py-3 text-xs uppercase tracking-wider">Stock actual</th>
                    <th className="w-[9%] text-center text-white/40 font-medium px-4 py-3 text-xs uppercase tracking-wider">Stock mín.</th>
                    <th className="w-[15%] text-left text-white/40 font-medium px-4 py-3 text-xs uppercase tracking-wider">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {safeSortedProducts.map((p) => {
                    const status = STOCK_STATUS(p.stock ?? 0, p.min_stock ?? 0);
                    return (
                      <tr key={p.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                        <td className="px-4 py-3 text-white font-medium">{p.name}</td>
                        <td className="px-4 py-3 text-center text-slate-400">{p.category || '—'}</td>
                        <td className="px-4 py-3 text-slate-300">{formatCOP(p.price)}</td>
                        <td className="px-4 py-3">
                          {p.cost_price != null
                            ? <span className="text-slate-300">{formatCOP(p.cost_price)}</span>
                            : <span className="text-slate-600 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {p.cost_price != null ? (
                            <span className={`text-xs font-semibold ${
                              ((p.price - p.cost_price) / p.price * 100) > 40 ? 'text-emerald-400' :
                              ((p.price - p.cost_price) / p.price * 100) >= 20 ? 'text-yellow-400' :
                              'text-red-400'
                            }`}>
                              {((p.price - p.cost_price) / p.price * 100).toFixed(0)}%
                            </span>
                          ) : <span className="text-slate-600 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={(p.stock ?? 0) === 0 ? 'text-red-400 font-bold' : (p.stock ?? 0) <= (p.min_stock ?? 0) ? 'text-amber-400 font-semibold' : 'text-white'}>
                            {p.stock ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-400">{p.min_stock ?? 0}</td>
                        <td className="px-4 py-3">
                          {status.label === 'OK' ? (
                            <span className="text-xs font-medium text-emerald-400 bg-emerald-500/15 border border-emerald-500/20 px-2 py-1 rounded-lg">OK</span>
                          ) : status.label === 'Stock bajo' ? (
                            <span className="text-xs font-medium text-amber-400 bg-amber-500/15 border border-amber-500/20 px-2 py-1 rounded-lg">Stock bajo</span>
                          ) : (
                            <span className={`text-xs font-medium border px-2 py-1 rounded-lg ${status.cls}`}>{status.label}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Sales this month */}
      <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-3 border-b border-slate-800 gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp size={15} className="text-slate-400" />
            <h3 className="text-white text-sm font-semibold">Ventas de productos</h3>
          </div>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
            className="bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 transition">
            {Array.from({length: 6}, (_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - i);
              const val = d.toISOString().slice(0, 7);
              const label = d.toLocaleDateString('es-CO', {month:'long', year:'numeric'});
              return <option key={val} value={val}>{label}</option>;
            })}
          </select>
          <span className="text-emerald-400 text-sm font-bold">{formatCOP(totalSales)}</span>
        </div>
        {(productSales || []).length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-10">Sin ventas este período</p>
        ) : (
          <div className="space-y-2">
            {productSales.map((p) => (
              <div key={p.nombre} className="border border-slate-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedProducts(prev => ({ ...prev, [p.nombre]: !prev[p.nombre] }))}
                  className="w-full px-4 py-3 bg-[#131929]/80 hover:bg-slate-800 transition flex items-center justify-between"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className="flex-1 text-left">
                      <p className="text-white font-medium">{p.nombre}</p>
                      <p className="text-slate-400 text-xs">{p.unidades} unidade{p.unidades !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-emerald-400 font-bold">{formatCOP(p.total)}</p>
                    </div>
                  </div>
                  <span className="text-slate-400 ml-4">{expandedProducts[p.nombre] ? '▼' : '▶'}</span>
                </button>
                {expandedProducts[p.nombre] && (
                  <div className="bg-[#131929]/50 border-t border-slate-800">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[400px]">
                        <thead className="bg-[#131929]">
                          <tr className="border-b border-slate-800">
                            {['Fecha', 'Cantidad', 'Total', 'Canal'].map((h) => (
                              <th key={h} className="text-left text-slate-500 font-medium px-4 py-2 text-xs">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(p.ventas || []).map((v, idx) => (
                            <tr key={idx} className="border-b border-slate-800/30">
                              <td className="px-4 py-2 text-slate-400 text-xs">{v.fecha}</td>
                              <td className="px-4 py-2 text-slate-300">{v.cantidad}</td>
                              <td className="px-4 py-2 text-emerald-400 font-medium">{formatCOP(v.total)}</td>
                              <td className="px-4 py-2">
                                <span className={`text-xs border px-2 py-0.5 rounded-full ${
                                  v.canal === 'whatsapp'
                                    ? 'text-green-400 bg-green-500/10 border-green-500/20'
                                    : 'text-slate-400 bg-slate-500/10 border-slate-500/20'
                                }`}>
                                  {v.canal}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function Products() {
  const [tab, setTab] = useState('catalogo');
  const [showInactive, setShowInactive] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const [newModal, setNewModal] = useState(false);
  const { business } = useAuth();
  const isTienda = business?.business_type
    ?.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') === 'tienda';

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', showInactive],
    queryFn: () => api.get(`/api/products?includeInactive=${showInactive}`).then((r) => r.data.data),
  });

  const { data: sales = [] } = useQuery({
    queryKey: ['product-sales'],
    queryFn: () => api.get('/api/products/sales').then((r) => r.data.data),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get('/api/clients').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const activeCount = products.filter((p) => p.is_active).length;

  const tabs = [
    { id: 'catalogo',   label: 'Catálogo' },
    { id: 'inventario', label: 'Inventario' },
  ];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="border-b border-white/6 pb-4 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-white">
          Productos
          <span className="text-xs sm:text-sm font-normal text-white/40 ml-2">
            {activeCount} activos
          </span>
        </h1>
      </div>

      {/* Tabs + Botón */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="flex gap-1 bg-[#131929] border border-slate-800 rounded-xl p-1 w-fit">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
                tab === t.id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={() => setNewModal(true)} className="flex-shrink-0 px-3 py-2 text-xs sm:text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-colors flex items-center gap-1 whitespace-nowrap">
          <Plus size={14} /> Nuevo producto
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {tab === 'catalogo' ? (
            <CatalogoTab products={products} clients={clients} showInactive={showInactive} onShowInactiveChange={setShowInactive} sortBy={sortBy} onSortChange={setSortBy} isTienda={isTienda} newModal={newModal} setNewModal={setNewModal} />
          ) : (
            <InventarioTab products={products.filter((p) => p.is_active)} sales={sales} sortBy={sortBy} onSortChange={setSortBy} />
          )}
        </>
      )}

      {newModal && (
        <ProductModal
          onClose={() => setNewModal(false)}
          onSave={() => { qc.invalidateQueries({ queryKey: ['products'] }); setNewModal(false); }}
          isTienda={isTienda}
        />
      )}
    </div>
  );
}
