import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ShoppingBag, Plus, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { isTiendaBusiness } from '../../lib/businessType';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

const STATUS_CONFIG = {
  recibido: { label: 'Recibido', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  en_proceso: { label: 'En proceso', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  listo: { label: 'Listo', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
  enviado: { label: 'Enviado', color: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
  entregado: { label: 'Entregado', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  cancelado: { label: 'Cancelado', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

const VALID_STATUSES = Object.keys(STATUS_CONFIG);

// Solo tienda: estado y método de pago
const PAYMENT_CONFIG = {
  pendiente: { label: 'Pendiente', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  pagado: { label: 'Pagado', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  fallido: { label: 'Fallido', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  reembolsado: { label: 'Reembolsado', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
};
const PAYMENT_METHODS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  tarjeta: 'Tarjeta',
  wompi: 'Wompi',
  otro: 'Otro',
};
const paymentOf = (order) => order.payment_status || 'pendiente';

// Unidades de catálogo que vuelven al inventario al cancelar o eliminar
const unitsToReturn = (order) => (order.order_items || [])
  .filter((i) => i.product_id)
  .reduce((s, i) => s + Number(i.quantity || 0), 0);

const variantLabel = (attributes) => Object.entries(attributes || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');

const INPUT = 'w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition';
const MODAL_OVERLAY = 'fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50 md:px-4 md:py-4';
const MODAL_PANEL = 'bg-[#131929] border border-slate-800 w-full h-[100dvh] md:h-auto md:max-h-[calc(100vh-2rem)] md:rounded-2xl shadow-xl flex flex-col';

function NewOrderModal({ onClose, onSuccess, clients, isTienda, products }) {
  const [form, setForm] = useState({
    client_name: '',
    client_phone: '',
    delivery_type: 'retiro',
    delivery_address: '',
    notes: '',
    items: [{ description: '', quantity: 1, unit_price: 0 }],
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDrop, setShowClientDrop] = useState(false);
  const [variantsByProduct, setVariantsByProduct] = useState({});

  const catalog = isTienda ? (products || []).filter((p) => p.is_active !== false) : [];
  const productById = Object.fromEntries(catalog.map((p) => [p.id, p]));

  const filteredClients = (clients || []).filter(c =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.phone?.includes(clientSearch)
  ).slice(0, 5);

  const handleAddItem = () => {
    setForm({
      ...form,
      items: [...form.items, { description: '', quantity: 1, unit_price: 0 }],
    });
  };

  const handleRemoveItem = (idx) => {
    setForm({
      ...form,
      items: form.items.filter((_, i) => i !== idx),
    });
  };

  const handleItemChange = (idx, field, val) => {
    const updated = [...form.items];
    updated[idx] = { ...updated[idx], [field]: field === 'quantity' || field === 'unit_price' ? Number(val) : val };
    setForm({ ...form, items: updated });
  };

  // Solo tienda: elegir un producto del catálogo (y su variante) para que el pedido descuente stock
  const loadVariants = (productId) => {
    if (variantsByProduct[productId]) return;
    setVariantsByProduct((prev) => ({ ...prev, [productId]: { loading: true, list: [] } }));
    api.get(`/api/products/${productId}/variants`)
      .then((r) => setVariantsByProduct((prev) => ({ ...prev, [productId]: { loading: false, list: (r.data?.data || []).filter((v) => v.is_active) } })))
      .catch(() => setVariantsByProduct((prev) => ({ ...prev, [productId]: { loading: false, list: [] } })));
  };

  const handleSelectProduct = (idx, productId) => {
    const updated = [...form.items];
    const p = productById[productId];
    updated[idx] = p
      ? { ...updated[idx], product_id: p.id, variant_id: '', description: p.name, unit_price: Number(p.price) || 0 }
      : { ...updated[idx], product_id: '', variant_id: '' };
    setForm({ ...form, items: updated });
    if (p?.has_variants) loadVariants(p.id);
  };

  const handleSelectVariant = (idx, variantId) => {
    const updated = [...form.items];
    const item = updated[idx];
    const p = productById[item.product_id];
    const v = (variantsByProduct[item.product_id]?.list || []).find((x) => x.id === variantId);
    updated[idx] = { ...item, variant_id: variantId, description: v ? `${p?.name} (${variantLabel(v.attributes)})` : (p?.name || item.description) };
    setForm({ ...form, items: updated });
  };

  const totalAmount = form.items.reduce((s, item) => s + (item.quantity * item.unit_price), 0);

  const handleCreate = async () => {
    setError('');
    if (!form.client_name?.trim() || !form.client_phone?.trim()) {
      return setError('Nombre y teléfono son obligatorios.');
    }
    if (form.delivery_type === 'envio' && !form.delivery_address?.trim()) {
      return setError('Dirección de envío es obligatoria.');
    }
    if (form.items.length === 0 || form.items.some(i => !i.description?.trim() || i.quantity <= 0 || i.unit_price < 0)) {
      return setError('Todos los items deben ser válidos.');
    }
    if (isTienda && form.items.some(i => i.product_id && productById[i.product_id]?.has_variants && !i.variant_id)) {
      return setError('Selecciona la variante (talla/color) de cada producto que la tenga.');
    }

    setLoading(true);
    try {
      await api.post('/api/orders', {
        client_name: form.client_name.trim(),
        client_phone: form.client_phone.trim(),
        delivery_type: form.delivery_type,
        delivery_address: form.delivery_type === 'envio' ? form.delivery_address.trim() : null,
        notes: form.notes?.trim() || null,
        items: form.items.map(i => ({
          description: i.description.trim(),
          quantity: i.quantity,
          unit_price: i.unit_price,
          ...(isTienda && i.product_id ? { product_id: i.product_id, variant_id: i.variant_id || null } : {}),
        })),
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al crear pedido.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={MODAL_OVERLAY}>
      <div className={`${MODAL_PANEL} md:max-w-2xl`}>
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <h3 className="text-white font-semibold">Nuevo pedido</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}

          <div className="space-y-3">
            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Nombre cliente *</label>
              <input type="text" value={form.client_name}
                onChange={(e) => setForm({ ...form, client_name: e.target.value })}
                className={INPUT} />
            </div>

            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Teléfono cliente *</label>
              <input type="tel" inputMode="tel" value={form.client_phone}
                onChange={(e) => setForm({ ...form, client_phone: e.target.value })}
                className={INPUT} />
            </div>

            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Tipo de entrega *</label>
              <select value={form.delivery_type}
                onChange={(e) => setForm({ ...form, delivery_type: e.target.value })}
                className={INPUT}>
                <option value="retiro">Retiro</option>
                <option value="envio">Envío</option>
              </select>
            </div>

            {form.delivery_type === 'envio' && (
              <div>
                <label className="block text-slate-400 text-sm mb-1.5">Dirección de envío *</label>
                <input type="text" value={form.delivery_address}
                  onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
                  className={INPUT} />
              </div>
            )}

            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Notas (opcional)</label>
              <textarea value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows="2"
                className={INPUT} />
            </div>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <h4 className="text-white text-sm font-semibold mb-3">Items del pedido *</h4>
            <div className="space-y-2">
              {form.items.map((item, idx) => {
                const p = item.product_id ? productById[item.product_id] : null;
                const vState = p?.has_variants ? variantsByProduct[p.id] : null;
                const selectedVariant = (vState?.list || []).find((v) => v.id === item.variant_id);
                const available = p ? (p.has_variants ? selectedVariant?.stock : p.stock) : null;
                return (
                  <div key={idx} className={isTienda ? 'p-2 rounded-lg border border-slate-800 space-y-2' : ''}>
                    {isTienda && (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select value={item.product_id || ''} onChange={(e) => handleSelectProduct(idx, e.target.value)}
                          className="flex-1 bg-[#131929] border border-slate-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-violet-500">
                          <option value="">Artículo libre (no descuenta stock)</option>
                          {catalog.map((x) => (
                            <option key={x.id} value={x.id}>{x.name}{x.has_variants ? '' : ` · stock ${x.stock ?? 0}`}</option>
                          ))}
                        </select>
                        {p?.has_variants && (
                          <select value={item.variant_id || ''} onChange={(e) => handleSelectVariant(idx, e.target.value)}
                            disabled={vState?.loading}
                            className="flex-1 bg-[#131929] border border-slate-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-violet-500">
                            <option value="">{vState?.loading ? 'Cargando variantes...' : 'Seleccionar variante...'}</option>
                            {(vState?.list || []).map((v) => (
                              <option key={v.id} value={v.id}>{variantLabel(v.attributes)} (stock: {v.stock})</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input type="text" placeholder="Descripción" value={item.description}
                        onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                        className="flex-1 min-w-0 bg-[#131929] border border-slate-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
                      <input type="number" inputMode="numeric" placeholder="Cant." min="1" value={item.quantity}
                        onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                        className="w-16 sm:w-20 bg-[#131929] border border-slate-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
                      <input type="number" inputMode="numeric" placeholder="Precio" min="0" step="100" value={item.unit_price}
                        onChange={(e) => handleItemChange(idx, 'unit_price', e.target.value)}
                        className="w-24 bg-[#131929] border border-slate-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
                      {form.items.length > 1 && (
                        <button type="button" onClick={() => handleRemoveItem(idx)}
                          className="px-2 py-2 text-slate-500 hover:text-red-400 transition">
                          <X size={16} />
                        </button>
                      )}
                    </div>
                    {isTienda && available != null && (
                      <p className={`text-xs ${item.quantity > available ? 'text-red-400' : 'text-slate-500'}`}>
                        Disponible: {available}{item.quantity > available ? ' · cantidad mayor al stock' : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={handleAddItem}
              className="mt-2 w-full text-sm text-violet-400 hover:text-violet-300 py-2 transition">
              + Agregar item
            </button>
          </div>

          <p className="text-slate-300 text-sm">
            Total: <span className="font-bold">{formatCOP(totalAmount)}</span>
          </p>
        </div>

        <div className="flex gap-3 px-4 md:px-6 py-4 border-t border-slate-800 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">
            Cancelar
          </button>
          <button onClick={handleCreate} disabled={loading}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
            {loading ? 'Creando...' : 'Crear pedido'}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderDetailModal({ order: initialOrder, onClose, isTienda, onNotice }) {
  const [order, setOrder] = useState(initialOrder);
  const [newStatus, setNewStatus] = useState(initialOrder.status);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState(null); // 'cancel' | 'delete' (solo tienda)
  const [payMethod, setPayMethod] = useState(initialOrder.payment_method || '');
  const [payStatusSel, setPayStatusSel] = useState(paymentOf(initialOrder));
  const [payLoading, setPayLoading] = useState(false);
  const [carrier, setCarrier] = useState(initialOrder.shipping_carrier || '');
  const [tracking, setTracking] = useState(initialOrder.tracking_code || '');
  const [shipLoading, setShipLoading] = useState(false);
  const qc = useQueryClient();

  const isCancelled = order.status === 'cancelado';
  const units = unitsToReturn(order);
  const payment = paymentOf(order);
  const shippingDirty = carrier.trim() !== (order.shipping_carrier || '') || tracking.trim() !== (order.tracking_code || '');
  const showShipping = isTienda && (order.delivery_type === 'envio' || newStatus === 'enviado' || order.status === 'enviado' || order.shipping_carrier || order.tracking_code);

  // Pago, cancelación y eliminación mueven la caja de tienda: refrescar caja y dashboard
  const invalidateMoney = () => {
    qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('cash-') });
    qc.invalidateQueries({ queryKey: ['metrics-overview'] });
    qc.invalidateQueries({ queryKey: ['dashboard-tienda'] });
  };

  const invalidateAfterStock = () => {
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['inventory-summary'] });
    if (isTienda) invalidateMoney();
  };

  const saveShipping = async () => {
    const res = await api.patch(`/api/orders/${order.id}/shipping`, {
      shipping_carrier: carrier.trim() || null,
      tracking_code: tracking.trim() || null,
    });
    setOrder((prev) => ({ ...prev, ...res.data?.data }));
  };

  const doStatusChange = async () => {
    setLoading(true);
    setError('');
    try {
      await api.patch(`/api/orders/${order.id}/status`, { status: newStatus });
      if (isTienda && newStatus === 'enviado' && shippingDirty) {
        try { await saveShipping(); } catch (shipErr) {
          onNotice?.({ type: 'error', text: shipErr.response?.data?.error || 'El estado se guardó, pero no la información de envío.' });
        }
      }
      if (newStatus === 'cancelado') {
        invalidateAfterStock();
        if (isTienda) onNotice?.({ type: 'ok', text: units > 0 ? `Pedido cancelado. ${units} unidad${units !== 1 ? 'es' : ''} volvieron al inventario.` : 'Pedido cancelado.' });
      } else {
        qc.invalidateQueries({ queryKey: ['orders'] });
      }
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al actualizar estado.';
      if (isTienda) setError(msg); else alert(msg);
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  const handleStatusChange = () => {
    if (isTienda && newStatus === 'cancelado') return setConfirmAction('cancel');
    doStatusChange();
  };

  const doDelete = async () => {
    setLoading(true);
    setError('');
    try {
      await api.delete(`/api/orders/${order.id}`);
      invalidateAfterStock();
      if (isTienda) onNotice?.({ type: 'ok', text: units > 0 ? `Pedido eliminado. ${units} unidad${units !== 1 ? 'es' : ''} volvieron al inventario.` : 'Pedido eliminado.' });
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al eliminar pedido.';
      if (isTienda) setError(msg); else alert(msg);
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  const handleDelete = () => {
    if (isTienda) return setConfirmAction('delete');
    if (!confirm('¿Eliminar este pedido?')) return;
    doDelete();
  };

  const updatePayment = async (status) => {
    setPayLoading(true);
    setError('');
    try {
      const res = await api.patch(`/api/orders/${order.id}/payment`, {
        payment_status: status,
        ...(payMethod ? { payment_method: payMethod } : {}),
      });
      setOrder((prev) => ({ ...prev, ...res.data?.data }));
      setPayStatusSel(status);
      qc.invalidateQueries({ queryKey: ['orders'] });
      invalidateMoney();
    } catch (err) {
      setError(err.response?.data?.error || 'Error al actualizar el pago.');
    } finally {
      setPayLoading(false);
    }
  };

  const handleSaveShipping = async () => {
    setShipLoading(true);
    setError('');
    try {
      await saveShipping();
      qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (err) {
      setError(err.response?.data?.error || 'Error al guardar el envío.');
    } finally {
      setShipLoading(false);
    }
  };

  const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.recibido;
  const payConfig = PAYMENT_CONFIG[payment] || PAYMENT_CONFIG.pendiente;

  return (
    <div className={MODAL_OVERLAY}>
      <div className={`${MODAL_PANEL} md:max-w-md`}>
        <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-slate-800 flex-shrink-0">
          <h3 className="text-white font-semibold">Detalle del pedido</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}

          <div>
            <p className="text-slate-500 text-xs">Cliente</p>
            <p className="text-white font-medium">{order.client_name}</p>
            <p className="text-slate-400 text-sm">{order.client_phone}</p>
          </div>

          <div>
            <p className="text-slate-500 text-xs">Estado</p>
            <span className={`text-xs border px-3 py-1 rounded-full ${config.color}`}>
              {config.label}
            </span>
          </div>

          <div>
            <p className="text-slate-500 text-xs">Fecha</p>
            <p className="text-white">{new Date(order.created_at).toLocaleDateString('es-CO')}</p>
          </div>

          <div>
            <p className="text-slate-500 text-xs">Tipo de entrega</p>
            <p className="text-white capitalize">{order.delivery_type}</p>
          </div>

          {order.delivery_address && (
            <div>
              <p className="text-slate-500 text-xs">Dirección</p>
              <p className="text-white text-sm">{order.delivery_address}</p>
            </div>
          )}

          {order.notes && (
            <div>
              <p className="text-slate-500 text-xs">Notas</p>
              <p className="text-white text-sm">{order.notes}</p>
            </div>
          )}

          <div className="border-t border-slate-800 pt-3">
            <p className="text-slate-400 text-xs mb-2">Items</p>
            <div className="space-y-1">
              {(order.order_items || []).map((item, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="text-white">{item.description}</p>
                    <p className="text-slate-500 text-xs">{item.quantity}x {formatCOP(item.unit_price)}</p>
                  </div>
                  <p className="text-violet-400 font-semibold">{formatCOP(item.quantity * item.unit_price)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <p className="text-white text-sm">
              Total: <span className="font-bold">{formatCOP(order.total_amount)}</span>
            </p>
          </div>

          {/* Pago (solo tienda) */}
          {isTienda && (
            <div className="border-t border-slate-800 pt-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-slate-400 text-xs">Pago</p>
                <span className={`text-xs border px-3 py-1 rounded-full ${payConfig.color}`}>{payConfig.label}</span>
              </div>
              {(order.payment_method || order.paid_at) && (
                <p className="text-slate-500 text-xs">
                  {order.payment_method ? PAYMENT_METHODS[order.payment_method] || order.payment_method : ''}
                  {order.payment_method && order.paid_at ? ' · ' : ''}
                  {order.paid_at ? `Pagado el ${new Date(order.paid_at).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}` : ''}
                </p>
              )}
              {order.status === 'enviado' && payment === 'pendiente' && (
                <p className="flex items-center gap-1.5 text-yellow-400 text-xs">
                  <AlertTriangle size={13} /> Pedido enviado con el pago pendiente.
                </p>
              )}
              {!isCancelled && (
                <>
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={INPUT}>
                    <option value="">Método de pago...</option>
                    {Object.entries(PAYMENT_METHODS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                  {payment !== 'pagado' && (
                    <button onClick={() => updatePayment('pagado')} disabled={payLoading}
                      className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 text-sm font-medium py-2.5 rounded-lg transition disabled:opacity-50">
                      {payLoading ? 'Guardando...' : 'Marcar pagado'}
                    </button>
                  )}
                  <div className="flex gap-2">
                    <select value={payStatusSel} onChange={(e) => setPayStatusSel(e.target.value)} className={INPUT}>
                      {Object.entries(PAYMENT_CONFIG).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
                    </select>
                    <button onClick={() => updatePayment(payStatusSel)}
                      disabled={payLoading || (payStatusSel === payment && (payMethod || '') === (order.payment_method || ''))}
                      className="flex-shrink-0 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm font-medium px-4 rounded-lg transition">
                      Guardar pago
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Envío (solo tienda) */}
          {showShipping && (
            <div className="border-t border-slate-800 pt-3 space-y-2">
              <p className="text-slate-400 text-xs">Envío</p>
              <input type="text" value={carrier} maxLength={100} disabled={isCancelled}
                onChange={(e) => setCarrier(e.target.value)} placeholder="Transportadora (ej: Servientrega)" className={INPUT} />
              <input type="text" value={tracking} maxLength={100} disabled={isCancelled}
                onChange={(e) => setTracking(e.target.value)} placeholder="Guía de seguimiento" className={INPUT} />
              {!isCancelled && (
                <button onClick={handleSaveShipping} disabled={shipLoading || !shippingDirty}
                  className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">
                  {shipLoading ? 'Guardando...' : 'Guardar envío'}
                </button>
              )}
              {newStatus === 'enviado' && order.status !== 'enviado' && shippingDirty && (
                <p className="text-slate-500 text-xs">Se guardará junto con el cambio de estado.</p>
              )}
            </div>
          )}

          {isCancelled ? (
            <p className="text-slate-500 text-xs border-t border-slate-800 pt-3">Este pedido está cancelado; su estado ya no se puede cambiar.</p>
          ) : (
            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Cambiar estado</label>
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)} className={INPUT}>
                {VALID_STATUSES.map(s => (
                  <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                ))}
              </select>
            </div>
          )}

          {confirmAction && (
            <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 space-y-2">
              <p className="text-red-300 text-sm">
                {confirmAction === 'delete' ? '¿Eliminar este pedido?' : '¿Cancelar este pedido?'}{' '}
                {units > 0
                  ? `${units} unidad${units !== 1 ? 'es' : ''} volverán al inventario.`
                  : 'No tiene productos del catálogo; el inventario no cambia.'}
                {' '}Esta acción no se puede deshacer.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmAction(null)} disabled={loading}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2 rounded-lg transition">
                  Volver
                </button>
                <button onClick={confirmAction === 'delete' ? doDelete : doStatusChange} disabled={loading}
                  className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition">
                  {loading ? 'Procesando...' : confirmAction === 'delete' ? 'Sí, eliminar' : 'Sí, cancelar pedido'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-4 md:px-6 py-4 border-t border-slate-800 flex-shrink-0">
          {order.status === 'recibido' && (
            <button onClick={handleDelete} disabled={loading}
              className="flex-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium py-2.5 rounded-lg transition">
              Eliminar
            </button>
          )}
          <button onClick={onClose}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">
            Cancelar
          </button>
          {!isCancelled && (
            <button onClick={handleStatusChange} disabled={loading || newStatus === order.status}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Orders() {
  const qc = useQueryClient();
  const { business } = useAuth();
  const isTienda = isTiendaBusiness(business);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMonth, setFilterMonth] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7));
  const [filterPayment, setFilterPayment] = useState('');
  const [newOrderModal, setNewOrderModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [notice, setNotice] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Acción rápida del dashboard: /dashboard/pedidos?nuevo=1 abre el modal de nuevo pedido
  useEffect(() => {
    if (searchParams.get('nuevo') !== '1') return;
    setNewOrderModal(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders', filterStatus, filterMonth],
    queryFn: () => api.get(`/api/orders?status=${filterStatus}&month=${filterMonth}`).then(r => r.data?.data || []),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get('/api/clients').then(r => r.data?.data || []),
  });

  // Solo tienda: catálogo para el selector de productos del pedido (misma query que Productos)
  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.get('/api/products?includeInactive=true').then((r) => r.data.data),
    enabled: isTienda,
  });

  const visibleOrders = isTienda && filterPayment
    ? orders.filter((o) => paymentOf(o) === filterPayment)
    : orders;
  const porCobrar = isTienda
    ? orders.filter((o) => o.status !== 'cancelado' && paymentOf(o) === 'pendiente').length
    : 0;

  return (
    <div className="zita-touch p-4 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <ShoppingBag size={22} className="text-violet-400" />
        <div>
          <h1 className="text-white text-2xl font-bold">Pedidos</h1>
          <p className="text-slate-400 text-sm mt-0.5">{visibleOrders.length} pedido{visibleOrders.length !== 1 ? 's' : ''}</p>
        </div>
        {isTienda && porCobrar > 0 && (
          <button onClick={() => setFilterPayment(filterPayment === 'pendiente' ? '' : 'pendiente')}
            className="ml-auto text-xs font-medium text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 hover:bg-yellow-500/20 px-3 py-1.5 rounded-full transition">
            {porCobrar} por cobrar
          </button>
        )}
      </div>

      {notice && (
        <div className={`mb-4 flex items-start gap-2 text-sm px-4 py-3 rounded-xl border ${notice.type === 'ok'
          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
          : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>
          {notice.type === 'ok' ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-current opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="flex-1 bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500">
          <option value="">Todos los estados</option>
          {VALID_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
          ))}
        </select>

        {isTienda && (
          <select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)}
            className="flex-1 bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500">
            <option value="">Todos los pagos</option>
            {Object.entries(PAYMENT_CONFIG).map(([k, c]) => <option key={k} value={k}>Pago: {c.label}</option>)}
          </select>
        )}

        <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
          className="flex-1 bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500">
          {Array.from({ length: 6 }, (_, i) => {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const val = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7);
            const label = d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
            return <option key={val} value={val}>{label}</option>;
          })}
        </select>

        <button onClick={() => setNewOrderModal(true)}
          className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          <Plus size={15} /> Nuevo
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-[#131929] border border-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="text-center py-20">
          <ShoppingBag size={40} className="mx-auto mb-3 text-slate-700" />
          <p className="text-slate-500">No hay pedidos en este período</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleOrders.map((order) => {
            const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.recibido;
            const payConfig = PAYMENT_CONFIG[paymentOf(order)] || PAYMENT_CONFIG.pendiente;
            return (
              <div key={order.id} className="bg-[#131929] border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                      <p className="text-white font-semibold truncate">{order.client_name}</p>
                      <span className={`text-xs border px-2 py-0.5 rounded-full flex-shrink-0 ${config.color}`}>
                        {config.label}
                      </span>
                      {isTienda && order.status !== 'cancelado' && (
                        <span className={`text-xs border px-2 py-0.5 rounded-full flex-shrink-0 ${payConfig.color}`}>
                          {payConfig.label}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500 text-sm">{order.client_phone}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                      <span>{new Date(order.created_at).toLocaleDateString('es-CO')}</span>
                      <span className="capitalize">{order.delivery_type}</span>
                    </div>
                    {isTienda && order.status === 'enviado' && paymentOf(order) === 'pendiente' && (
                      <p className="flex items-center gap-1.5 text-yellow-400 text-xs mt-2">
                        <AlertTriangle size={12} /> Enviado con pago pendiente
                      </p>
                    )}
                  </div>

                  <div className="text-right flex-shrink-0">
                    <p className="text-violet-400 font-bold">{formatCOP(order.total_amount)}</p>
                    <button
                      onClick={() => setSelectedOrder(order)}
                      className="mt-2 flex items-center gap-1.5 bg-violet-600/20 hover:bg-violet-600 border border-violet-500/30 hover:border-violet-500 text-violet-400 hover:text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
                    >
                      Ver detalle →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {newOrderModal && (
        <NewOrderModal
          onClose={() => setNewOrderModal(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['orders'] });
            if (isTienda) {
              qc.invalidateQueries({ queryKey: ['products'] });
              qc.invalidateQueries({ queryKey: ['inventory-summary'] });
              qc.invalidateQueries({ queryKey: ['dashboard-tienda'] });
            }
            setNewOrderModal(false);
          }}
          clients={clients}
          isTienda={isTienda}
          products={products}
        />
      )}

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          isTienda={isTienda}
          onNotice={setNotice}
        />
      )}
    </div>
  );
}
