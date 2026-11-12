import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Plus, X, Phone, Clock } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { getTimezone, timeFromISO } from '../../lib/timezone';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function to12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${period}`;
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function prettyDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

const STATUS = {
  pending:   { label: 'Pendiente',  cls: 'text-amber-300 bg-amber-500/10 border-amber-500/25' },
  confirmed: { label: 'Confirmada', cls: 'text-violet-300 bg-violet-500/10 border-violet-500/25' },
  completed: { label: 'Hecha',      cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25' },
  cancelled: { label: 'Cancelada',  cls: 'text-slate-400 bg-slate-700/40 border-slate-600/50' },
};

const inputCls = 'w-full bg-[#0f172a] border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition';

function NewAppointmentModal({ date, canUseClients, onClose, onCreated }) {
  const [form, setForm] = useState({ service_id: '', client_id: '', date, time: '09:00', notes: '' });
  const [search, setSearch] = useState('');
  const [newClient, setNewClient] = useState(null);
  const [error, setError] = useState('');

  const { data: services = [] } = useQuery({
    queryKey: ['me', 'services'],
    queryFn: () => api.get('/api/me/services').then((r) => r.data.data),
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['me', 'clients', search],
    queryFn: () => api.get('/api/me/clients', { params: search ? { search } : {} }).then((r) => r.data.data),
    enabled: canUseClients,
  });

  const selectedClient = clients.find((c) => c.id === form.client_id);
  const selectedService = services.find((s) => s.id === form.service_id);

  const createMutation = useMutation({
    mutationFn: async () => {
      let clientId = form.client_id || null;
      if (newClient) {
        const res = await api.post('/api/me/clients', newClient);
        clientId = res.data.data.id;
      }
      return api.post('/api/me/appointments', {
        service_id: form.service_id,
        client_id: clientId,
        scheduled_at: `${form.date}T${form.time}`,
        notes: form.notes || null,
      });
    },
    onSuccess: () => onCreated(form.date),
    onError: (err) => setError(err.response?.data?.error || 'No se pudo crear la cita.'),
  });

  const submit = (e) => {
    e.preventDefault();
    setError('');
    if (!form.service_id) return setError('Elige un servicio.');
    if (!form.date || !form.time) return setError('Elige fecha y hora.');
    if (newClient && (!newClient.name.trim() || !newClient.phone.trim())) return setError('El cliente nuevo necesita nombre y teléfono.');
    createMutation.mutate();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50 md:px-4">
      <div className="bg-[#131929] border border-violet-500/20 md:rounded-2xl rounded-t-2xl w-full md:max-w-md p-5 shadow-2xl max-h-[100dvh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Nueva cita</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}

          <div>
            <label className="block text-slate-300 text-sm mb-1.5">Servicio *</label>
            <select value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} className={inputCls}>
              <option value="">Seleccionar...</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {formatCOP(s.price)}</option>)}
            </select>
            {selectedService && <p className="text-slate-500 text-xs mt-1">{selectedService.duration_minutes} min</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 text-sm mb-1.5">Fecha</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-slate-300 text-sm mb-1.5">Hora</label>
              <input type="time" step="300" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className={inputCls} />
            </div>
          </div>

          {canUseClients && (
            <div>
              <label className="block text-slate-300 text-sm mb-1.5">Cliente (opcional)</label>
              {newClient ? (
                <div className="bg-[#0f172a] border border-slate-700 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-slate-300 text-xs font-medium">Cliente nuevo</p>
                    <button type="button" onClick={() => setNewClient(null)} className="text-slate-500 hover:text-white"><X size={13} /></button>
                  </div>
                  <input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} placeholder="Nombre *" className={inputCls} maxLength={120} />
                  <input value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} placeholder="Teléfono *" inputMode="tel" className={inputCls} maxLength={20} />
                </div>
              ) : selectedClient ? (
                <div className="flex items-center justify-between bg-[#0f172a] border border-violet-500/50 rounded-lg px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{selectedClient.name}</p>
                    <p className="text-slate-500 text-xs">{selectedClient.phone}</p>
                  </div>
                  <button type="button" onClick={() => setForm({ ...form, client_id: '' })} className="text-slate-500 hover:text-white"><X size={14} /></button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o teléfono..." className={inputCls} />
                  {search && (
                    <div className="bg-[#0f172a] border border-slate-700 rounded-lg max-h-40 overflow-y-auto">
                      {clients.length === 0 ? (
                        <p className="text-slate-500 text-xs px-3 py-2.5">Sin resultados</p>
                      ) : clients.slice(0, 8).map((c) => (
                        <button key={c.id} type="button" onClick={() => { setForm({ ...form, client_id: c.id }); setSearch(''); }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800 transition">
                          <span className="text-white">{c.name}</span>
                          <span className="text-slate-500 text-xs ml-2">{c.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={() => setNewClient({ name: search, phone: '' })}
                    className="text-violet-400 hover:text-violet-300 text-xs font-medium">+ Cliente nuevo</button>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-slate-300 text-sm mb-1.5">Notas (opcional)</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} maxLength={500} className={`${inputCls} resize-none`} />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium py-2.5 rounded-lg transition">Cancelar</button>
            <button type="submit" disabled={createMutation.isPending} className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
              {createMutation.isPending ? 'Guardando...' : 'Crear cita'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MyAgenda() {
  const { business, employee, allowedModules } = useAuth();
  const qc = useQueryClient();
  const tz = getTimezone(business?.country);
  const today = useMemo(() => new Date().toLocaleDateString('en-CA', { timeZone: tz }), [tz]);
  const [date, setDate] = useState(today);
  const [showNew, setShowNew] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [actionError, setActionError] = useState('');

  const { data: appts = [], isLoading, isError } = useQuery({
    queryKey: ['me', 'appointments', date],
    queryFn: () => api.get('/api/me/appointments', { params: { date } }).then((r) => r.data.data),
    refetchInterval: 60_000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action }) => api.post(`/api/me/appointments/${id}/${action}`),
    onSuccess: () => {
      setActionError('');
      setConfirmCancel(null);
      qc.invalidateQueries({ queryKey: ['me', 'appointments'] });
      qc.invalidateQueries({ queryKey: ['me', 'commissions'] });
    },
    onError: (err) => {
      setActionError(err.response?.data?.error || 'No se pudo actualizar la cita.');
      qc.invalidateQueries({ queryKey: ['me', 'appointments'] });
    },
  });

  const active = appts.filter((a) => a.status === 'pending' || a.status === 'confirmed');
  const done = appts.filter((a) => a.status === 'completed');

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-white text-xl font-bold">Mi agenda</h1>
          <p className="text-slate-400 text-sm">Hola {employee?.name?.split(' ')[0] || ''} · {active.length} pendiente{active.length === 1 ? '' : 's'} · {done.length} hecha{done.length === 1 ? '' : 's'}</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition whitespace-nowrap">
          <Plus size={16} /> Nueva cita
        </button>
      </div>

      <div className="flex items-center gap-2 mb-5 bg-[#131929] border border-violet-500/15 rounded-xl p-2">
        <button onClick={() => setDate(shiftDate(date, -1))} className="p-2 rounded-lg hover:bg-white/5 text-slate-300" aria-label="Día anterior"><ChevronLeft size={18} /></button>
        <div className="flex-1 text-center">
          <p className="text-white text-sm font-medium capitalize">{prettyDate(date)}</p>
          {date !== today && <button onClick={() => setDate(today)} className="text-violet-400 text-xs hover:text-violet-300">Volver a hoy</button>}
        </div>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
          className="bg-transparent text-slate-300 text-xs w-[2.25rem] sm:w-auto" aria-label="Elegir fecha" />
        <button onClick={() => setDate(shiftDate(date, 1))} className="p-2 rounded-lg hover:bg-white/5 text-slate-300" aria-label="Día siguiente"><ChevronRight size={18} /></button>
      </div>

      {actionError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mb-4">{actionError}</p>}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />)}
        </div>
      ) : isError ? (
        <p className="text-slate-400 text-sm text-center py-16">No se pudo cargar tu agenda. Revisa tu conexión.</p>
      ) : appts.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <CalendarCheck size={40} className="mx-auto mb-3 opacity-30" />
          <p>No tienes citas este día</p>
        </div>
      ) : (
        <div className="space-y-3">
          {appts.map((a) => {
            const st = STATUS[a.status] || STATUS.confirmed;
            const open = a.status === 'pending' || a.status === 'confirmed';
            const busy = statusMutation.isPending && statusMutation.variables?.id === a.id;
            return (
              <div key={a.id} className={`bg-[#131929] border rounded-xl p-4 ${open ? 'border-violet-500/20' : 'border-slate-800 opacity-70'}`}>
                <div className="flex items-start gap-3">
                  <div className="text-center flex-shrink-0 w-16">
                    <p className="text-white font-semibold text-sm flex items-center justify-center gap-1"><Clock size={12} className="text-violet-400" />{to12h(timeFromISO(a.scheduled_at, business?.country))}</p>
                    {a.services?.duration_minutes && <p className="text-slate-500 text-[11px]">{a.services.duration_minutes} min</p>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-white text-sm font-medium truncate">{a.clients?.name || 'Cliente ocasional'}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                    </div>
                    <p className="text-slate-400 text-xs">{a.services?.name || 'Servicio'} · {formatCOP(a.price)}</p>
                    {a.clients?.phone && (
                      <a href={`tel:${a.clients.phone}`} className="text-slate-500 hover:text-violet-300 text-xs inline-flex items-center gap-1 mt-0.5"><Phone size={11} />{a.clients.phone}</a>
                    )}
                    {a.notes && <p className="text-slate-500 text-xs mt-1 italic">{a.notes}</p>}
                  </div>
                </div>
                {open && (
                  confirmCancel === a.id ? (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => setConfirmCancel(null)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white text-sm py-2 rounded-lg transition">No</button>
                      <button onClick={() => statusMutation.mutate({ id: a.id, action: 'cancel' })} disabled={busy}
                        className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm py-2 rounded-lg transition">
                        {busy ? 'Cancelando...' : 'Sí, cancelar cita'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => statusMutation.mutate({ id: a.id, action: 'complete' })} disabled={busy}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition">
                        <Check size={15} /> {busy ? 'Guardando...' : 'Marcar como hecha'}
                      </button>
                      <button onClick={() => setConfirmCancel(a.id)} disabled={busy}
                        className="px-3 text-slate-400 hover:text-red-400 hover:bg-red-500/10 text-sm rounded-lg transition">
                        Cancelar
                      </button>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {showNew && (
        <NewAppointmentModal
          date={date}
          canUseClients={(allowedModules || []).includes('clientes')}
          onClose={() => setShowNew(false)}
          onCreated={(d) => { setShowNew(false); setDate(d); qc.invalidateQueries({ queryKey: ['me', 'appointments'] }); }}
        />
      )}
    </div>
  );
}
