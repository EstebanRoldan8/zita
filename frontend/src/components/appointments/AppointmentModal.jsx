import { useRef } from 'react';
import { UserPlus, X, Package, Plus } from 'lucide-react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

const emptyForm = { client_id: '', service_id: '', employee_id: '', date: '', time: '09:00', notes: '', is_reward: false };

export default function AppointmentModal({
  isOpen,
  onClose,
  form,
  setForm,
  formError,
  setFormError,
  handleSubmit,
  clients,
  services,
  employees,
  products,
  loyaltyConfig,
  createMutation,
  clientSearch,
  setClientSearch,
  showClientDrop,
  setShowClientDrop,
  showNewClient,
  setShowNewClient,
  isWalkIn,
  setIsWalkIn,
  newClient,
  setNewClient,
  apptProducts,
  setApptProducts,
  productPickId,
  setProductPickId,
  productPickQty,
  setProductPickQty,
  resetClientState,
  limitError,
  setLimitError,
}) {
  const clientSearchRef = useRef(null);
  const selectedService = services?.find((s) => s.id === form.service_id);
  const selectedClient = (clients || []).find((c) => c?.id === form.client_id);
  const filteredClients = (clients || []).filter((c) => {
    try {
      return !clientSearch || (c?.name ?? '').toLowerCase().includes(clientSearch.toLowerCase()) || (c?.phone ?? '').includes(clientSearch);
    } catch (err) {
      return false;
    }
  }).slice(0, 8);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 py-4 sm:py-0">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-4 sm:p-6 shadow-xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
        <h3 className="text-white font-semibold text-base sm:text-lg mb-4 sm:mb-5">Nueva cita</h3>
        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
          {formError && <p className="text-red-400 text-xs sm:text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{formError}</p>}

          {/* Cliente */}
          <div>
            <label className="block text-slate-400 text-xs sm:text-sm mb-1.5">Cliente (opcional)</label>
            {isWalkIn ? (
              <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 sm:px-4 py-2">
                <p className="text-emerald-400 text-xs sm:text-sm font-medium">Cliente ocasional (sin registro)</p>
                <button type="button" onClick={() => { setIsWalkIn(false); setForm({ ...form, client_id: '' }); }}
                  className="text-emerald-500 hover:text-emerald-300 p-0.5 transition flex-shrink-0 ml-2"><X size={14} /></button>
              </div>
            ) : !showNewClient ? (
              <div className="space-y-2">
                <div className="relative">
                  {selectedClient ? (
                    <div className="flex items-center justify-between bg-slate-900 border border-violet-500/50 rounded-lg px-3 sm:px-4 py-2">
                      <div className="min-w-0">
                        <p className="text-white text-xs sm:text-sm font-medium truncate">{selectedClient.name}</p>
                        <p className="text-slate-500 text-xs truncate">{selectedClient.phone}</p>
                      </div>
                      <button type="button" onClick={() => { setForm({ ...form, client_id: '' }); setClientSearch(''); }}
                        className="text-slate-500 hover:text-white p-0.5 transition flex-shrink-0 ml-2"><X size={14} /></button>
                    </div>
                  ) : (
                    <input ref={clientSearchRef} type="text" value={clientSearch}
                      onChange={(e) => { setClientSearch(e.target.value); setShowClientDrop(true); }}
                      onFocus={() => setShowClientDrop(true)}
                      placeholder="Buscar cliente por nombre o teléfono..."
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition" />
                  )}
                  {showClientDrop && !selectedClient && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden z-20 shadow-xl max-h-44 overflow-y-auto">
                      <button type="button" onMouseDown={() => { setForm({ ...form, client_id: '' }); setClientSearch(''); setShowClientDrop(false); }}
                        className="w-full text-left px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-slate-400 hover:bg-slate-700 border-b border-slate-700 transition">
                        Cliente ocasional (sin registro)
                      </button>
                      {filteredClients.length === 0 && clientSearch ? (
                        <p className="text-slate-500 text-xs px-3 sm:px-4 py-2 sm:py-2.5">Sin resultados</p>
                      ) : (
                        filteredClients.filter(c => c && c.id).map((c) => (
                          <button key={c.id} type="button"
                            onMouseDown={() => { setForm({ ...form, client_id: c.id }); setClientSearch(''); setShowClientDrop(false); }}
                            className="w-full text-left px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm hover:bg-slate-700 transition">
                            <span className="text-white">{c.name}</span>
                            <span className="text-slate-500 text-xs ml-2 line-clamp-1">{c.phone ?? ''}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setIsWalkIn(true); setClientSearch(''); setShowClientDrop(false); setShowNewClient(false); setForm({ ...form, client_id: '' }); }}
                    className="flex-1 flex items-center justify-center gap-1.5 text-emerald-400 hover:text-emerald-300 text-xs font-medium transition px-2 py-1.5 border border-emerald-500/30 hover:border-emerald-500/50 rounded-lg bg-emerald-500/5 hover:bg-emerald-500/10">
                    Ocasional
                  </button>
                  <button type="button" onClick={() => { setShowNewClient(true); setClientSearch(''); setShowClientDrop(false); setForm({ ...form, client_id: '' }); }}
                    className="flex-1 flex items-center justify-center gap-1.5 text-violet-400 hover:text-violet-300 text-xs font-medium transition px-2 py-1.5 border border-violet-500/30 hover:border-violet-500/50 rounded-lg bg-violet-500/5 hover:bg-violet-500/10">
                    <UserPlus size={12} className="sm:w-[13px] sm:h-[13px]" /> Nuevo
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-slate-300 text-xs font-medium">Nuevo cliente</p>
                  <button type="button" onClick={() => setShowNewClient(false)} className="text-slate-500 hover:text-white p-0.5 transition flex-shrink-0"><X size={13} /></button>
                </div>
                <input type="text" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                  placeholder="Nombre *"
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs sm:text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition" />
                <input type="text" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })}
                  placeholder="Teléfono (opcional)"
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-xs sm:text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition" />
                {newClient.name ? (
                  <p className="text-emerald-400 text-xs">Se guardará en tu base de clientes</p>
                ) : null}
              </div>
            )}
          </div>

          {/* Servicio + Empleado */}
          {[
            { label: 'Servicio *', name: 'service_id', options: services.map((s) => ({ value: s.id, label: `${s.name} — ${formatCOP(s.price)}` })) },
            { label: 'Empleado (opcional)', name: 'employee_id', options: [{ value: '', label: 'Auto-asignar' }, ...employees.map((e) => ({ value: e.id, label: e.name }))] },
          ].map(({ label, name, options }) => (
            <div key={name}>
              <label className="block text-slate-400 text-xs sm:text-sm mb-1.5">{label}</label>
              <select value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm focus:outline-none focus:border-violet-500 transition">
                <option value="">Seleccionar...</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div>
              <label className="block text-slate-400 text-xs sm:text-sm mb-1.5">Fecha</label>
              <DatePicker
                selected={form.date ? (() => {
                  const [y, m, d] = form.date.split('-').map(Number);
                  return new Date(y, m - 1, d, 12, 0, 0);
                })() : null}
                onChange={(d) => setForm({ ...form, date: d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) })}
                dateFormat="dd/MM/yyyy"
                locale="es"
                placeholderText="Seleccionar"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm focus:outline-none focus:border-violet-500 transition"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs sm:text-sm mb-1.5">Hora</label>
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm focus:outline-none focus:border-violet-500 transition" />
            </div>
          </div>

          {selectedService && (
            <p className="text-slate-500 text-xs">Precio: {formatCOP(selectedService.price)} · {selectedService.duration_minutes} min</p>
          )}

          <div>
            <label className="block text-slate-400 text-xs sm:text-sm mb-1.5">Notas (opcional)</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition resize-none" />
          </div>

          {/* Cita de recompensa */}
          {selectedClient && loyaltyConfig && loyaltyConfig.reward_service_id && (
            <div className="border border-slate-700 rounded-xl p-3 bg-yellow-500/5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_reward}
                  onChange={(e) => setForm({ ...form, is_reward: e.target.checked })}
                  disabled={!selectedClient || (selectedClient.loyalty_visits ?? 0) < (loyaltyConfig.visits_for_reward ?? 1)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-800 text-yellow-500 focus:ring-yellow-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                />
                <span className="text-white text-xs sm:text-sm font-medium">Cita de recompensa 🎉</span>
              </label>
              {selectedClient && (selectedClient.loyalty_visits ?? 0) >= (loyaltyConfig.visits_for_reward ?? 1) && (
                <p className="text-yellow-400 text-xs mt-1.5">Cliente tiene recompensa disponible</p>
              )}
              {selectedClient && (selectedClient.loyalty_visits ?? 0) < (loyaltyConfig.visits_for_reward ?? 1) && (
                <p className="text-slate-500 text-xs mt-1.5">Cliente aún no tiene recompensa disponible</p>
              )}
            </div>
          )}

          {/* Productos */}
          {products.length > 0 && (
            <div className="border border-slate-700 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Package size={12} className="sm:w-[13px] sm:h-[13px] text-slate-400" />
                <p className="text-slate-400 text-xs font-medium">Productos vendidos en esta cita (opcional)</p>
              </div>
              <div className="flex gap-1 sm:gap-2 flex-wrap">
                <select value={productPickId} onChange={(e) => setProductPickId(e.target.value)}
                  className="flex-1 min-w-[120px] bg-slate-900 border border-slate-700 text-white rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 text-xs focus:outline-none focus:border-violet-500 transition">
                  <option value="">Seleccionar producto...</option>
                  {products.filter((p) => p.stock > 0).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {formatCOP(p.price)} (stock: {p.stock})</option>
                  ))}
                </select>
                <input type="number" min="1" value={productPickQty} onChange={(e) => setProductPickQty(e.target.value)}
                  className="w-12 bg-slate-900 border border-slate-700 text-white rounded-lg px-1 sm:px-2 py-1.5 sm:py-2 text-xs text-center focus:outline-none focus:border-violet-500 transition" />
                <button type="button"
                  onClick={() => {
                    const prod = products.find((p) => p.id === productPickId);
                    const qty = Number(productPickQty);
                    if (!prod || qty <= 0) return;
                    setApptProducts((prev) => {
                      const existing = prev.find((x) => x.product_id === prod.id);
                      if (existing) {
                        return prev.map((x) => x.product_id === prod.id ? { ...x, quantity: x.quantity + qty } : x);
                      }
                      return [...prev, { product_id: prod.id, name: prod.name, price: prod.price, quantity: qty }];
                    });
                    setProductPickId('');
                    setProductPickQty('1');
                  }}
                  className="w-8 h-8 flex-shrink-0 flex items-center justify-center bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition">
                  <Plus size={14} />
                </button>
              </div>
              {apptProducts.length > 0 && (
                <ul className="space-y-1 mt-1">
                  {apptProducts.map((p) => (
                    <li key={p.product_id} className="flex items-center justify-between text-xs text-slate-300 bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-1.5">
                      <span>{p.name} ×{p.quantity}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">{formatCOP(p.price * p.quantity)}</span>
                        <button type="button" onClick={() => setApptProducts((prev) => prev.filter((x) => x.product_id !== p.product_id))}
                          className="text-slate-500 hover:text-red-400 transition"><X size={12} /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => { onClose(); resetClientState(); setApptProducts([]); }} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs sm:text-sm font-medium py-2 sm:py-2.5 rounded-lg transition">Cancelar</button>
            <button type="submit" disabled={createMutation.isPending}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs sm:text-sm font-medium py-2 sm:py-2.5 rounded-lg transition">
              {createMutation.isPending ? 'Guardando...' : 'Crear cita'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
