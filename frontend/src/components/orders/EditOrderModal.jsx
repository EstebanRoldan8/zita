import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, AlertTriangle, History, RotateCcw, Search } from 'lucide-react';
import api from '../../lib/api';
import {
  ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS, DELIVERY_LABELS,
  formatCOP, orderCode, buildChanges, toDateInput, formatEditValue, groupEdits,
} from './orderEditUtils';

const INPUT = 'w-full min-w-0 bg-[#0f1422] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500 transition disabled:opacity-50';
const LABEL = 'block text-slate-400 text-xs mb-1';
const BTN_SOFT = 'inline-flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs font-medium px-3 py-2 rounded-lg transition';
const SECTION = 'border-t border-slate-800 pt-4 space-y-3';

const attrLabel = (attributes) => Object.values(attributes || {}).filter(Boolean).join(' / ');
const needsVariant = (p) => !!p && (p.has_variants || (p.is_bundle && (p.bundle?.variants?.length || 0) > 0));

// Formulario inicial a partir del pedido guardado
function formFrom(order) {
  return {
    client_name: order.client_name || '',
    client_phone: order.client_phone || '',
    customer_email: order.customer_email || '',
    delivery_type: order.delivery_type || 'retiro',
    delivery_address: order.delivery_address || '',
    shipping_city: order.shipping_city || '',
    shipping_carrier: order.shipping_carrier || '',
    tracking_code: order.tracking_code || '',
    notes: order.notes || '',
    status: order.status || 'recibido',
    payment_status: order.payment_status || 'pendiente',
    payment_method: order.payment_method || '',
    created_at: toDateInput(order.created_at),
    discount_amount: String(Number(order.discount_amount) || 0),
    shipping_cost: String(Number(order.shipping_cost) || 0),
    shipping_zone: order.shipping_zone || '',
    items: (order.order_items || []).map((i) => ({
      key: i.id, id: i.id, product_id: i.product_id || null, variant_id: i.variant_id || '', description: i.description || '',
      quantity: String(i.quantity), unit_price: String(Number(i.unit_price)), is_set: !!i.bundle_snapshot,
    })),
  };
}

export default function EditOrderModal({ order, products = [], isTienda, onClose, onSaved }) {
  const original = useMemo(() => formFrom(order), [order]);
  const [form, setForm] = useState(original);
  const [variantsByProduct, setVariantsByProduct] = useState({});
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(null); // { product_id, variant_id, quantity }
  const [previewState, setPreview] = useState(null); // { key, data }: vale solo para los cambios con los que se pidió
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedStrong, setConfirmedStrong] = useState(false);
  const [history, setHistory] = useState({ loading: true, edits: [], available: true });
  const [reopenStatus, setReopenStatus] = useState('');
  const [reopenPreview, setReopenPreview] = useState(null);

  const isCancelled = order.status === 'cancelado';
  const code = orderCode(order.id);
  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const changes = useMemo(() => buildChanges(original, form), [original, form]);
  const dirty = Object.keys(changes).length > 0;
  const changesKey = JSON.stringify(changes);
  // Cualquier cambio en el formulario invalida la vista previa (y con ella la confirmación)
  const preview = previewState && previewState.key === changesKey ? previewState.data : null;

  useEffect(() => {
    let alive = true;
    api.get(`/api/orders/${order.id}/edits`)
      .then((r) => { if (alive) setHistory({ loading: false, ...(r.data?.data || { edits: [], available: true }) }); })
      .catch(() => { if (alive) setHistory({ loading: false, edits: [], available: true, error: true }); });
    return () => { alive = false; };
  }, [order.id]);

  const loadVariants = (productId) => {
    const p = productById[productId];
    if (!p || variantsByProduct[productId]) return;
    if (p.is_bundle) {
      setVariantsByProduct((prev) => ({ ...prev, [productId]: { loading: false, list: p.bundle?.variants || [] } }));
      return;
    }
    setVariantsByProduct((prev) => ({ ...prev, [productId]: { loading: true, list: [] } }));
    api.get(`/api/products/${productId}/variants`)
      .then((r) => setVariantsByProduct((prev) => ({ ...prev, [productId]: { loading: false, list: (r.data?.data || []).filter((v) => v.is_active) } })))
      .catch(() => setVariantsByProduct((prev) => ({ ...prev, [productId]: { loading: false, list: [] } })));
  };

  // Variantes de las líneas existentes de productos con variantes (para poder cambiarla)
  useEffect(() => {
    let alive = true;
    const ids = [...new Set(original.items.filter((i) => !i.is_set && i.product_id && productById[i.product_id]?.has_variants).map((i) => i.product_id))];
    for (const id of ids) {
      api.get(`/api/products/${id}/variants`)
        .then((r) => { if (alive) setVariantsByProduct((prev) => ({ ...prev, [id]: { loading: false, list: (r.data?.data || []).filter((v) => v.is_active) } })); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [original.items, productById]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setItem = (key, field, value) => setForm((f) => ({ ...f, items: f.items.map((i) => (i.key === key ? { ...i, [field]: value } : i)) }));
  const removeItem = (key) => setForm((f) => ({ ...f, items: f.items.filter((i) => i.key !== key) }));

  const catalog = products.filter((p) => p.is_active !== false);
  const hits = search.trim().length >= 2
    ? catalog.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8)
    : [];

  const startAdd = (p) => {
    setAdding({ product_id: p.id, variant_id: '', quantity: '1' });
    setSearch('');
    if (needsVariant(p)) loadVariants(p.id);
  };
  const confirmAdd = () => {
    const p = productById[adding.product_id];
    if (!p) return;
    if (needsVariant(p) && !adding.variant_id) { setError(`Elige la talla y el color de ${p.name}.`); return; }
    const v = (variantsByProduct[p.id]?.list || []).find((x) => x.id === adding.variant_id);
    setForm((f) => ({
      ...f,
      items: [...f.items, {
        key: `new-${Date.now()}`, id: null, product_id: p.id, variant_id: adding.variant_id || '', is_set: !!p.is_bundle,
        description: v ? `${p.name} (${attrLabel(v.attributes)})` : p.name, quantity: adding.quantity || '1', unit_price: String(Number(p.price) || 0),
      }],
    }));
    setAdding(null);
    setError('');
  };

  const requestPreview = async () => {
    setBusy('preview');
    setError('');
    try {
      const r = await api.post(`/api/orders/${order.id}/edit/preview`, { changes });
      setPreview({ key: changesKey, data: r.data?.data || null });
      setConfirmed(false);
      setConfirmedStrong(false);
      return r.data?.data || null;
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo calcular la vista previa.');
      return null;
    } finally {
      setBusy('');
    }
  };

  // Botones de recálculo: llenan el campo con la sugerencia del servidor; lo que escribas a mano manda
  const recalcSetDiscount = async () => {
    const pv = await requestPreview();
    if (pv) setForm((f) => ({ ...f, discount_amount: String(pv.set_discount?.amount || 0) }));
  };
  const recalcShipping = async () => {
    const pv = await requestPreview();
    if (pv?.shipping_suggestion) setForm((f) => ({ ...f, shipping_cost: String(pv.shipping_suggestion.cost), shipping_zone: pv.shipping_suggestion.zone }));
  };

  const save = async () => {
    if (!preview) return;
    setBusy('save');
    setError('');
    try {
      const r = await api.post(`/api/orders/${order.id}/edit`, {
        changes, confirm: confirmed, confirm_strong: confirmedStrong, expected: preview.expected,
      });
      onSaved?.(r.data?.data, 'Pedido actualizado. Stock, Caja e historial quedaron al día.');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar. No se cambió nada.');
      if (err.response?.data?.code === 'MODIFICADO') setPreview(null);
    } finally {
      setBusy('');
    }
  };

  const askReopen = async () => {
    if (!reopenStatus) { setError('Elige el estado al que vuelve el pedido.'); return; }
    setBusy('reopen-preview');
    setError('');
    try {
      const r = await api.post(`/api/orders/${order.id}/reopen/preview`, { status: reopenStatus });
      setReopenPreview(r.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo preparar la reapertura.');
    } finally {
      setBusy('');
    }
  };
  const doReopen = async () => {
    setBusy('reopen');
    setError('');
    try {
      const r = await api.post(`/api/orders/${order.id}/reopen`, { status: reopenStatus, confirm: true, confirm_strong: true });
      onSaved?.(r.data?.data, 'Pedido reabierto: su stock y su Caja volvieron a contar.');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo reabrir el pedido.');
    } finally {
      setBusy('');
    }
  };

  const canSave = !!preview && !preview.noop && preview.short.length === 0 && confirmed && (!preview.strong_confirm || confirmedStrong) && !busy;
  const lockMoney = isCancelled;
  const groups = groupEdits(history.edits || []);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-[60] md:px-4 md:py-4" role="dialog" aria-modal="true" aria-labelledby="edit-order-title">
      <div className="bg-[#131929] border border-slate-800 w-full h-[100dvh] md:h-auto md:max-h-[calc(100vh-2rem)] md:max-w-3xl md:rounded-2xl shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 md:px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="min-w-0">
            <h3 id="edit-order-title" className="text-white font-semibold">Editar pedido {code}</h3>
            <p className="text-slate-500 text-xs mt-0.5">El número del pedido no cambia. Nada se guarda hasta que confirmes.</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-500 hover:text-white transition flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-4 space-y-4">
          {error && <p role="alert" className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg break-words">{error}</p>}

          {isCancelled && (
            <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 space-y-2">
              <p className="text-amber-300 text-sm">Este pedido está cancelado: aquí solo puedes cambiar los datos del cliente y las notas. Para cambiar artículos, dinero o estado, primero reábrelo.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <select value={reopenStatus} onChange={(e) => { setReopenStatus(e.target.value); setReopenPreview(null); }} className={INPUT} aria-label="Estado al reabrir">
                  <option value="">Reabrir como…</option>
                  {Object.entries(ORDER_STATUS_LABELS).filter(([k]) => k !== 'cancelado').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button onClick={askReopen} disabled={!!busy || !reopenStatus} className={`${BTN_SOFT} sm:w-auto w-full`}>
                  <RotateCcw size={14} /> Revisar reapertura
                </button>
              </div>
              {reopenPreview && (
                <div className="text-xs text-slate-300 space-y-1">
                  {reopenPreview.stock.length > 0 && (
                    <p>Stock que vuelve a salir: {reopenPreview.stock.map((s) => `${s.label} ${s.available ?? '?'} → ${s.after ?? '?'}`).join(' · ')}</p>
                  )}
                  {reopenPreview.cash.applies && <p>Caja: vuelve el ingreso de {formatCOP(reopenPreview.cash.income.after)}{reopenPreview.cash.expense.after ? ` y el costo de ${formatCOP(reopenPreview.cash.expense.after)}` : ''}.</p>}
                  {reopenPreview.short.length > 0
                    ? <p className="text-red-400">No se puede reabrir: falta stock de {reopenPreview.short.join('; ')}.</p>
                    : (
                      <button onClick={doReopen} disabled={!!busy} className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition">
                        {busy === 'reopen' ? 'Reabriendo…' : `Sí, reabrir como ${ORDER_STATUS_LABELS[reopenStatus]}`}
                      </button>
                    )}
                </div>
              )}
            </div>
          )}

          {/* Cliente */}
          <section className="space-y-3">
            <p className="text-slate-300 text-sm font-medium">Cliente</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label htmlFor="eo-name" className={LABEL}>Nombre</label><input id="eo-name" maxLength={120} value={form.client_name} onChange={set('client_name')} className={INPUT} /></div>
              <div><label htmlFor="eo-phone" className={LABEL}>Teléfono</label><input id="eo-phone" inputMode="tel" maxLength={30} value={form.client_phone} onChange={set('client_phone')} className={INPUT} /></div>
              <div><label htmlFor="eo-email" className={LABEL}>Correo</label><input id="eo-email" type="email" maxLength={254} value={form.customer_email} onChange={set('customer_email')} className={INPUT} /></div>
            </div>
          </section>

          {/* Entrega */}
          <section className={SECTION}>
            <p className="text-slate-300 text-sm font-medium">Entrega</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="eo-dtype" className={LABEL}>Tipo de entrega</label>
                <select id="eo-dtype" value={form.delivery_type} onChange={set('delivery_type')} disabled={lockMoney} className={INPUT}>
                  {Object.entries(DELIVERY_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  {!DELIVERY_LABELS[form.delivery_type] && <option value={form.delivery_type}>{form.delivery_type}</option>}
                </select>
              </div>
              <div><label htmlFor="eo-city" className={LABEL}>Ciudad</label><input id="eo-city" maxLength={80} value={form.shipping_city} onChange={set('shipping_city')} className={INPUT} /></div>
              <div className="sm:col-span-2"><label htmlFor="eo-addr" className={LABEL}>Dirección</label><input id="eo-addr" maxLength={300} value={form.delivery_address} onChange={set('delivery_address')} className={INPUT} /></div>
              <div><label htmlFor="eo-carrier" className={LABEL}>Transportadora</label><input id="eo-carrier" maxLength={100} value={form.shipping_carrier} onChange={set('shipping_carrier')} className={INPUT} /></div>
              <div><label htmlFor="eo-track" className={LABEL}>Guía</label><input id="eo-track" maxLength={100} value={form.tracking_code} onChange={set('tracking_code')} className={INPUT} /></div>
            </div>
          </section>

          {/* Artículos */}
          <section className={SECTION}>
            <p className="text-slate-300 text-sm font-medium">Artículos</p>
            <ul className="space-y-2">
              {form.items.map((item) => {
                const p = item.product_id ? productById[item.product_id] : null;
                const canChangeVariant = !lockMoney && !item.is_set && p?.has_variants && item.id;
                const vlist = variantsByProduct[item.product_id]?.list || [];
                return (
                  <li key={item.key} className="bg-[#0f1422] border border-slate-800 rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-white text-sm break-words min-w-0">{item.description || 'Artículo'}{!item.id && <span className="ml-2 text-xs text-emerald-400">nuevo</span>}</p>
                      {!lockMoney && (
                        <button onClick={() => removeItem(item.key)} aria-label={`Quitar ${item.description}`} className="text-red-400 hover:text-red-300 flex-shrink-0 p-1"><Trash2 size={15} /></button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <label className={LABEL} htmlFor={`q-${item.key}`}>Cantidad</label>
                        <input id={`q-${item.key}`} type="number" inputMode="numeric" min="1" max="999" step="1" value={item.quantity} disabled={lockMoney}
                          onChange={(e) => setItem(item.key, 'quantity', e.target.value)} className={INPUT} />
                      </div>
                      <div>
                        <label className={LABEL} htmlFor={`p-${item.key}`}>Precio unitario</label>
                        <input id={`p-${item.key}`} type="number" inputMode="numeric" min="0" step="1" value={item.unit_price} disabled={lockMoney}
                          onChange={(e) => setItem(item.key, 'unit_price', e.target.value)} className={INPUT} />
                      </div>
                      {canChangeVariant && (
                        <div className="col-span-2">
                          <label className={LABEL} htmlFor={`v-${item.key}`}>Variante</label>
                          <select id={`v-${item.key}`} value={item.variant_id} onChange={(e) => {
                            const v = vlist.find((x) => x.id === e.target.value);
                            setForm((f) => ({ ...f, items: f.items.map((i) => (i.key === item.key ? { ...i, variant_id: e.target.value, description: v ? `${p.name} (${attrLabel(v.attributes)})` : i.description } : i)) }));
                          }} className={INPUT}>
                            {!vlist.find((v) => v.id === item.variant_id) && <option value={item.variant_id}>{item.description}</option>}
                            {vlist.map((v) => <option key={v.id} value={v.id}>{attrLabel(v.attributes)} · stock {v.stock}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {!lockMoney && isTienda && (
              <div className="space-y-2">
                {!adding ? (
                  <div className="relative">
                    <label htmlFor="eo-search" className={LABEL}>Agregar producto o set</label>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input id="eo-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Busca por nombre (mín. 2 letras)" className={`${INPUT} pl-8`} autoComplete="off" />
                    </div>
                    {hits.length > 0 && (
                      <ul className="mt-1 bg-[#0f1422] border border-slate-700 rounded-lg overflow-hidden">
                        {hits.map((p) => (
                          <li key={p.id}>
                            <button onClick={() => startAdd(p)} className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 flex justify-between gap-2">
                              <span className="truncate">{p.name}{p.is_bundle ? ' (set)' : ''}</span>
                              <span className="text-slate-500 flex-shrink-0">{formatCOP(p.price)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div className="p-3 border border-violet-500/30 bg-violet-500/5 rounded-lg space-y-2">
                    <p className="text-white text-sm">{productById[adding.product_id]?.name}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {needsVariant(productById[adding.product_id]) && (
                        <div className="sm:col-span-2">
                          <label className={LABEL} htmlFor="eo-add-variant">Talla / color</label>
                          <select id="eo-add-variant" value={adding.variant_id} onChange={(e) => setAdding((a) => ({ ...a, variant_id: e.target.value }))} className={INPUT}>
                            <option value="">{variantsByProduct[adding.product_id]?.loading ? 'Cargando…' : 'Elige una'}</option>
                            {(variantsByProduct[adding.product_id]?.list || []).map((v) => (
                              <option key={v.id} value={v.id} disabled={Number(v.stock) <= 0}>{attrLabel(v.attributes)} · stock {v.stock}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <label className={LABEL} htmlFor="eo-add-qty">Cantidad</label>
                        <input id="eo-add-qty" type="number" inputMode="numeric" min="1" max="999" value={adding.quantity} onChange={(e) => setAdding((a) => ({ ...a, quantity: e.target.value }))} className={INPUT} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setAdding(null)} className={`${BTN_SOFT} flex-1`}>Cancelar</button>
                      <button onClick={confirmAdd} className="flex-1 inline-flex items-center justify-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium px-3 py-2 rounded-lg transition"><Plus size={14} /> Agregar</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Dinero, pago y estado */}
          <section className={SECTION}>
            <p className="text-slate-300 text-sm font-medium">Descuento, envío y pago</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="eo-disc" className={LABEL}>Descuento ($)</label>
                <input id="eo-disc" type="number" inputMode="numeric" min="0" step="1" value={form.discount_amount} disabled={lockMoney} onChange={set('discount_amount')} className={INPUT} />
                {!lockMoney && isTienda && (
                  <button onClick={recalcSetDiscount} disabled={!!busy} className={`${BTN_SOFT} mt-2 w-full`}>Recalcular descuento por set</button>
                )}
              </div>
              <div>
                <label htmlFor="eo-ship" className={LABEL}>Costo de envío ($)</label>
                <input id="eo-ship" type="number" inputMode="numeric" min="0" step="1" value={form.shipping_cost} disabled={lockMoney} onChange={set('shipping_cost')} className={INPUT} />
                {!lockMoney && isTienda && (
                  <button onClick={recalcShipping} disabled={!!busy} className={`${BTN_SOFT} mt-2 w-full`}>Recalcular por zona{form.shipping_zone ? ` (${form.shipping_zone})` : ''}</button>
                )}
              </div>
              <div>
                <label htmlFor="eo-pay" className={LABEL}>Estado de pago</label>
                <select id="eo-pay" value={form.payment_status} onChange={set('payment_status')} disabled={lockMoney} className={INPUT}>
                  {Object.entries(PAYMENT_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="eo-method" className={LABEL}>Método de pago</label>
                <select id="eo-method" value={form.payment_method} onChange={set('payment_method')} disabled={lockMoney} className={INPUT}>
                  <option value="">Sin método</option>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="eo-status" className={LABEL}>Estado del pedido</label>
                <select id="eo-status" value={form.status} onChange={set('status')} disabled={lockMoney} className={INPUT}>
                  {Object.entries(ORDER_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="eo-date" className={LABEL}>Fecha del pedido</label>
                <input id="eo-date" type="date" value={form.created_at} disabled={lockMoney} onChange={set('created_at')} className={INPUT} />
              </div>
            </div>
            {form.status === 'cancelado' && !isCancelled && (
              <p className="text-amber-300 text-xs">Al cancelar, todo su stock vuelve al inventario y el pedido sale de Caja.</p>
            )}
          </section>

          <section className={SECTION}>
            <label htmlFor="eo-notes" className="text-slate-300 text-sm font-medium block">Notas</label>
            <textarea id="eo-notes" rows={3} maxLength={1000} value={form.notes} onChange={set('notes')} className={`${INPUT} resize-y`} />
          </section>

          {/* Vista previa y confirmación */}
          {preview && (
            <section className="border border-violet-500/30 bg-violet-500/5 rounded-xl p-3 md:p-4 space-y-3" aria-live="polite">
              <p className="text-white text-sm font-medium">Vista previa de los cambios</p>
              {preview.noop ? <p className="text-slate-400 text-sm">No hay cambios por guardar.</p> : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {[['Subtotal', 'subtotal'], ['Envío', 'shipping'], ['Descuento', 'discount'], ['Total', 'total']].map(([l, k]) => (
                      <div key={k} className="bg-[#0f1422] rounded-lg p-2 min-w-0">
                        <p className="text-slate-500">{l}</p>
                        <p className={`break-words ${k === 'total' ? 'text-violet-300 font-semibold' : 'text-slate-200'}`}>
                          {preview.before[k] !== preview.after[k] ? <><span className="line-through text-slate-500">{formatCOP(preview.before[k])}</span> → </> : null}{formatCOP(preview.after[k])}
                        </p>
                      </div>
                    ))}
                  </div>
                  {preview.stock.length > 0 && (
                    <div>
                      <p className="text-slate-400 text-xs mb-1">Inventario</p>
                      <ul className="space-y-0.5 text-xs">
                        {preview.stock.map((s, i) => (
                          <li key={i} className={s.short ? 'text-red-400' : 'text-slate-300'}>
                            {s.label}: {s.change > 0 ? `vuelven ${s.change}` : `salen ${-s.change}`} ({s.available ?? '?'} → {s.after ?? '?'})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {preview.cash.applies && (preview.cash.income.before !== preview.cash.income.after || preview.cash.expense.before !== preview.cash.expense.after) && (
                    <div className="text-xs text-slate-300">
                      <p className="text-slate-400 mb-1">Caja (se ajusta la fila del pedido en su fecha original)</p>
                      <p>Ingreso: {formatCOP(preview.cash.income.before)} → {formatCOP(preview.cash.income.after)}</p>
                      <p>Costo de venta: {formatCOP(preview.cash.expense.before)} → {formatCOP(preview.cash.expense.after)}</p>
                    </div>
                  )}
                  <ul className="text-xs text-slate-300 space-y-0.5">
                    {preview.changes.filter((c) => !['items', 'total_amount'].includes(c.field)).map((c) => (
                      <li key={c.field} className="break-words">{c.label}: {formatEditValue(c.field, c.before)} → {formatEditValue(c.field, c.after)}</li>
                    ))}
                  </ul>
                  {preview.short.length > 0 && (
                    <p className="flex items-start gap-1.5 text-red-400 text-xs"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> No alcanza el stock: {preview.short.join('; ')}. Ajusta las cantidades.</p>
                  )}
                  <label className="flex items-start gap-2 text-sm text-slate-200">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
                    <span>Revisé los cambios y quiero guardarlos.</span>
                  </label>
                  {preview.strong_confirm && (
                    <label className="flex items-start gap-2 text-sm text-amber-300">
                      <input type="checkbox" checked={confirmedStrong} onChange={(e) => setConfirmedStrong(e.target.checked)} className="mt-1" />
                      <span>
                        Este pedido {[preview.is_paid ? 'está pagado' : null, preview.is_old ? `tiene ${preview.age_days} días` : null].filter(Boolean).join(' y ')}.
                        Entiendo que se ajustarán su inventario{preview.is_paid ? ' y su Caja' : ''}.
                      </span>
                    </label>
                  )}
                </>
              )}
            </section>
          )}

          {/* Historial */}
          <section className={SECTION}>
            <p className="flex items-center gap-1.5 text-slate-300 text-sm font-medium"><History size={14} /> Historial de cambios</p>
            {history.loading ? <p className="text-slate-500 text-xs">Cargando…</p>
              : !history.available ? <p className="text-slate-500 text-xs">El historial se activa con la actualización de la base (migración 068).</p>
                : groups.length === 0 ? <p className="text-slate-500 text-xs">Este pedido no tiene ediciones.</p> : (
                  <ul className="space-y-2">
                    {groups.map((g) => (
                      <li key={g.id} className="bg-[#0f1422] border border-slate-800 rounded-lg p-2.5 text-xs">
                        <p className="text-slate-400">{new Date(g.created_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })} · {g.source === 'asistente' ? 'Asistente' : 'Panel'}</p>
                        <ul className="mt-1 space-y-0.5 text-slate-300">
                          {g.rows.map((e) => <li key={e.id} className="break-words">{e.label}: {formatEditValue(e.field, e.before_value)} → {formatEditValue(e.field, e.after_value)}</li>)}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
          </section>
        </div>

        <div className="flex gap-3 px-4 md:px-6 py-4 border-t border-slate-800 flex-shrink-0">
          <button onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">Cerrar</button>
          {!preview ? (
            <button onClick={requestPreview} disabled={!dirty || !!busy}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
              {busy === 'preview' ? 'Calculando…' : 'Revisar cambios'}
            </button>
          ) : (
            <button onClick={save} disabled={!canSave}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
              {busy === 'save' ? 'Guardando…' : 'Guardar cambios'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
