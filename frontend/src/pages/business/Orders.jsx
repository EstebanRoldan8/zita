import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, Plus, X, ChevronRight, Trash2 } from 'lucide-react';
import api from '../../lib/api';

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

function NewOrderModal({ onClose, onSuccess, clients }) {
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 overflow-y-auto py-4">
      <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-2xl shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h3 className="text-white font-semibold">Nuevo pedido</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="px-6 py-4 max-h-[calc(100vh-200px)] overflow-y-auto space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}

          <div className="space-y-3">
            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Nombre cliente *</label>
              <input type="text" value={form.client_name}
                onChange={(e) => setForm({ ...form, client_name: e.target.value })}
                className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition" />
            </div>

            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Teléfono cliente *</label>
              <input type="text" value={form.client_phone}
                onChange={(e) => setForm({ ...form, client_phone: e.target.value })}
                className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition" />
            </div>

            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Tipo de entrega *</label>
              <select value={form.delivery_type}
                onChange={(e) => setForm({ ...form, delivery_type: e.target.value })}
                className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition">
                <option value="retiro">Retiro</option>
                <option value="envio">Envío</option>
              </select>
            </div>

            {form.delivery_type === 'envio' && (
              <div>
                <label className="block text-slate-400 text-sm mb-1.5">Dirección de envío *</label>
                <input type="text" value={form.delivery_address}
                  onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
                  className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition" />
              </div>
            )}

            <div>
              <label className="block text-slate-400 text-sm mb-1.5">Notas (opcional)</label>
              <textarea value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows="2"
                className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition" />
            </div>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <h4 className="text-white text-sm font-semibold mb-3">Items del pedido *</h4>
            <div className="space-y-2">
              {form.items.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <input type="text" placeholder="Descripción" value={item.description}
                    onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                    className="flex-1 bg-[#131929] border border-slate-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
                  <input type="number" placeholder="Cant." min="1" value={item.quantity}
                    onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                    className="w-20 bg-[#131929] border border-slate-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
                  <input type="number" placeholder="Precio" min="0" step="100" value={item.unit_price}
                    onChange={(e) => handleItemChange(idx, 'unit_price', e.target.value)}
                    className="w-24 bg-[#131929] border border-slate-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
                  {form.items.length > 1 && (
                    <button type="button" onClick={() => handleRemoveItem(idx)}
                      className="px-2 py-2 text-slate-500 hover:text-red-400 transition">
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
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

        <div className="flex gap-3 px-6 py-4 border-t border-slate-800">
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

function OrderDetailModal({ order, onClose, onStatusChange, onDelete }) {
  const [newStatus, setNewStatus] = useState(order.status);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  const handleStatusChange = async () => {
    setLoading(true);
    try {
      await api.patch(`/api/orders/${order.id}/status`, { status: newStatus });
      qc.invalidateQueries({ queryKey: ['orders'] });
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al actualizar estado.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('¿Eliminar este pedido?')) return;
    try {
      await api.delete(`/api/orders/${order.id}`);
      qc.invalidateQueries({ queryKey: ['orders'] });
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al eliminar pedido.');
    }
  };

  const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.recibido;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 overflow-y-auto py-4">
      <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h3 className="text-white font-semibold">Detalle del pedido</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="px-6 py-4 max-h-[calc(100vh-200px)] overflow-y-auto space-y-3">
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
                <div key={idx} className="flex items-center justify-between text-sm">
                  <div className="flex-1">
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

          <div>
            <label className="block text-slate-400 text-sm mb-1.5">Cambiar estado</label>
            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}
              className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500">
              {VALID_STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-800">
          {order.status === 'recibido' && (
            <button onClick={handleDelete}
              className="flex-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium py-2.5 rounded-lg transition">
              Eliminar
            </button>
          )}
          <button onClick={onClose}
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">
            Cancelar
          </button>
          <button onClick={handleStatusChange} disabled={loading || newStatus === order.status}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Orders() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMonth, setFilterMonth] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7));
  const [newOrderModal, setNewOrderModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders', filterStatus, filterMonth],
    queryFn: () => api.get(`/api/orders?status=${filterStatus}&month=${filterMonth}`).then(r => r.data?.data || []),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get('/api/clients').then(r => r.data?.data || []),
  });

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <ShoppingBag size={22} className="text-violet-400" />
        <div>
          <h1 className="text-white text-2xl font-bold">Pedidos</h1>
          <p className="text-slate-400 text-sm mt-0.5">{orders.length} pedido{orders.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          className="flex-1 bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500">
          <option value="">Todos los estados</option>
          {VALID_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
          ))}
        </select>

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
      ) : orders.length === 0 ? (
        <div className="text-center py-20">
          <ShoppingBag size={40} className="mx-auto mb-3 text-slate-700" />
          <p className="text-slate-500">No hay pedidos en este período</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.recibido;
            return (
              <div key={order.id} className="bg-[#131929] border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <p className="text-white font-semibold truncate">{order.client_name}</p>
                      <span className={`text-xs border px-2 py-0.5 rounded-full flex-shrink-0 ${config.color}`}>
                        {config.label}
                      </span>
                    </div>
                    <p className="text-slate-500 text-sm">{order.client_phone}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                      <span>{new Date(order.created_at).toLocaleDateString('es-CO')}</span>
                      <span className="capitalize">{order.delivery_type}</span>
                    </div>
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
            setNewOrderModal(false);
          }}
          clients={clients}
        />
      )}

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStatusChange={() => qc.invalidateQueries({ queryKey: ['orders'] })}
          onDelete={() => qc.invalidateQueries({ queryKey: ['orders'] })}
        />
      )}
    </div>
  );
}
