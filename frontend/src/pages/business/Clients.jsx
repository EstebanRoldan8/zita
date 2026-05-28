import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, ChevronRight, X, Pencil, Search, Phone, Mail, Trophy, Plus, Check } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_COLOR = {
  pending:   'text-yellow-400 bg-yellow-500/10',
  confirmed: 'text-blue-400 bg-blue-500/10',
  completed: 'text-emerald-400 bg-emerald-500/10',
  cancelled: 'text-slate-500 bg-slate-800',
};
const STATUS_LABEL = { pending: 'Pendiente', confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada' };

const MEDALS = ['🥇', '🥈', '🥉'];

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditModal({ client, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: client.name || '', phone: client.phone || '', email: client.email || '', notes: client.notes || '' });
  const [error, setError] = useState('');

  const updateMutation = useMutation({
    mutationFn: (body) => api.put(`/api/clients/${client.id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); qc.invalidateQueries({ queryKey: ['client-detail', client.id] }); onClose(); },
    onError: (err) => setError(err.response?.data?.error || 'Error al guardar.'),
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('El nombre es obligatorio.');
    updateMutation.mutate(form);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl border border-violet-500/25 shadow-2xl shadow-black/50">
        <h3 className="text-white font-semibold text-lg mb-5">Editar cliente</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}
          {[
            { name: 'name',  label: 'Nombre *',    placeholder: 'María García',    type: 'text' },
            { name: 'phone', label: 'Teléfono',     placeholder: '3001234567',      type: 'text' },
            { name: 'email', label: 'Email',         placeholder: 'maria@email.com', type: 'email' },
          ].map(({ name, label, placeholder, type }) => (
            <div key={name}>
              <label className="block text-slate-400 text-sm mb-1.5">{label}</label>
              <input type={type} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} placeholder={placeholder}
                className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all duration-150" />
            </div>
          ))}
          <div>
            <label className="block text-slate-400 text-sm mb-1.5">Notas</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Preferencias, alergias, etc." rows={3}
              className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition hover:bg-white/10 hover:text-white transition-colors duration-150">Cancelar</button>
            <button type="submit" disabled={updateMutation.isPending}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
              {updateMutation.isPending ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Create Modal ──────────────────────────────────────────────────────────────
function CreateModal({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: (body) => api.post('/api/clients', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); onClose(); },
    onError: (err) => setError(err.response?.data?.error || 'Error al crear cliente.'),
  });

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('El nombre es obligatorio.');
    if (!form.phone.trim()) return setError('El teléfono es obligatorio.');
    createMutation.mutate(form);
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl border border-violet-500/25 shadow-2xl shadow-black/50">
        <h3 className="text-white font-semibold text-lg mb-5">Nuevo cliente</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{error}</p>}
          {[
            { name: 'name',  label: 'Nombre *',    placeholder: 'María García',    type: 'text' },
            { name: 'phone', label: 'Teléfono *',   placeholder: '3001234567',      type: 'text' },
            { name: 'email', label: 'Email',        placeholder: 'maria@email.com', type: 'email' },
          ].map(({ name, label, placeholder, type }) => (
            <div key={name}>
              <label className="block text-slate-400 text-sm mb-1.5">{label}</label>
              <input type={type} value={form[name]} onChange={(e) => setForm({ ...form, [name]: e.target.value })} placeholder={placeholder}
                className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all duration-150" />
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition hover:bg-white/10 hover:text-white transition-colors duration-150">Cancelar</button>
            <button type="submit" disabled={createMutation.isPending}
              className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
              {createMutation.isPending ? 'Creando...' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Tab Fidelización ──────────────────────────────────────────────────────────
function LoyaltyTab({ clients, loyaltyConfig, services, onCardClick }) {
  const ranking = [...clients].sort((a, b) => (b.total_visits || 0) - (a.total_visits || 0));
  const top5 = ranking.slice(0, 5);

  if (ranking.length === 0) {
    return (
      <div className="text-center py-20 text-slate-500">
        <Trophy size={40} className="mx-auto mb-3 opacity-30" />
        <p>Aún no tienes clientes con visitas</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top 5 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={15} className="text-yellow-400" />
          <h2 className="text-slate-300 text-sm font-semibold">Top clientes más fieles</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 justify-center">
          {top5.map((c, i) => {
            const borderClass = i === 0 ? 'border border-yellow-500/30 bg-yellow-500/5' : i === 1 ? 'border border-slate-400/30 bg-slate-400/5' : i === 2 ? 'border border-orange-500/30 bg-orange-500/5' : 'border border-violet-500/15 bg-violet-500/5';
            return (
              <button key={c.id} onClick={() => onCardClick(c.id)}
                className={`bg-[#131929] ${borderClass} rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:scale-[1.02] transition-all duration-200 text-left`}>
                <span className="text-2xl flex-shrink-0">{MEDALS[i] || '🏅'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-semibold">{c.name}</p>
                  <p className="text-xs sm:text-sm text-white/50 line-clamp-1">{formatCOP(c.total_spent)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-violet-400 font-bold">{c.total_visits}</p>
                  <p className="text-slate-600 text-[10px]">visitas</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'clientes',      label: 'Clientes' },
  { id: 'fidelizacion', label: 'Fidelización' },
];

function normalizeText(text) {
  return (text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export default function Clients() {
  const [tab, setTab]         = useState('clientes');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedFidelizationClientId, setSelectedFidelizationClientId] = useState(null);
  const [search, setSearch]   = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showRedeemConfirm, setShowRedeemConfirm] = useState(false);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [recallStatus, setRecallStatus] = useState({});

  const { data: sub, isLoading: subLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get('/api/subscription').then(r => r.data.data),
    staleTime: 5 * 60 * 1000
  });

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get('/api/clients').then((r) => {
      const data = r.data.data;
      if (data.length > 0) {
        console.log('[Clients.jsx] First client from API:', data[0]);
        console.log('[Clients.jsx] Has total_visits:', 'total_visits' in data[0]);
        console.log('[Clients.jsx] Has loyalty_visits:', 'loyalty_visits' in data[0]);
      }
      return data;
    }),
  });

  const { data: detail } = useQuery({
    queryKey: ['client-detail', selectedId],
    queryFn: () => api.get(`/api/clients/${selectedId}`).then((r) => r.data.data),
    enabled: !!selectedId,
  });

  const { data: fidelityDetail } = useQuery({
    queryKey: ['client-detail', selectedFidelizationClientId],
    queryFn: () => api.get(`/api/clients/${selectedFidelizationClientId}`).then((r) => r.data.data),
    enabled: !!selectedFidelizationClientId,
  });

  const { data: loyaltyConfig } = useQuery({
    queryKey: ['loyalty-config'],
    queryFn: () => api.get('/api/loyalty/config').then((r) => r.data.data),
  });

  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get('/api/services').then((r) => r.data.data),
  });

  const qc = useQueryClient();
  const redeemMutation = useMutation({
    mutationFn: ({ clientId }) => api.post(`/api/loyalty/${clientId}/redeem`),
    onSuccess: (_, { clientId }) => {
      qc.invalidateQueries({ queryKey: ['client-detail', clientId] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      setShowRedeemConfirm(false);
      setIsRedeeming(false);
    },
    onError: (err) => {
      setIsRedeeming(false);
      console.error('Error al canjear:', err);
    },
  });

  const handleRecall = async (e, clientId) => {
    e.stopPropagation();
    setRecallStatus(prev => ({ ...prev, [clientId]: 'loading' }));
    try {
      await api.post(`/api/clients/${clientId}/recall`);
      setRecallStatus(prev => ({ ...prev, [clientId]: 'sent' }));
      setTimeout(() => setRecallStatus(prev => ({ ...prev, [clientId]: 'idle' })), 3000);
    } catch (err) {
      setRecallStatus(prev => ({ ...prev, [clientId]: 'error' }));
      setTimeout(() => setRecallStatus(prev => ({ ...prev, [clientId]: 'idle' })), 3000);
    }
  };

  const plan = sub?.plan || 'estandar';

  const visibleTabs = TABS.filter(({ id }) => {
    if (plan === 'lite') return id !== 'fidelizacion';
    return true;
  });

  if (subLoading) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-8 w-48 bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-32 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />
        <div className="h-64 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  const selected  = detail || clients.find((c) => c.id === selectedId);
  const searchNorm = normalizeText(search);
  const filtered  = clients.filter((c) =>
    !search || normalizeText(c.name).includes(searchNorm) || c.phone?.includes(search)
  );
  const lastVisit = detail?.appointments?.find((a) => a.status === 'completed')?.scheduled_at;

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

      {/* Header + tabs */}
      <div className="border-b border-white/6 pb-4 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-white">
          Clientes
          <span className="text-xs sm:text-sm font-normal text-white/40 ml-2">{clients.length} registrados</span>
        </h1>
      </div>

      <div className="flex gap-1 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-1 w-fit mb-6">
        {visibleTabs.map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'fidelizacion' ? (
        <div className="flex gap-6">
          <div className="flex-1">
            <LoyaltyTab clients={clients} loyaltyConfig={loyaltyConfig} services={services} onCardClick={setSelectedFidelizationClientId} />
          </div>

          {/* Side panel para fidelización */}
          {selectedFidelizationClientId && (
            <>
              <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setSelectedFidelizationClientId(null)} />
              <div className="fixed right-0 top-0 h-full w-[480px] z-50 bg-[#131929] border-l border-slate-800 shadow-2xl shadow-black/50 transform transition-transform duration-300 overflow-y-auto custom-scroll">
                <div className="p-6 pb-8 sticky top-0 bg-gradient-to-br from-violet-600/20 to-indigo-600/5 border-b border-white/6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500/30 to-blue-500/30 border border-slate-700 flex items-center justify-center text-sm text-violet-400 font-bold flex-shrink-0">
                        {fidelityDetail?.name?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <h2 className="text-white font-semibold">{fidelityDetail?.name}</h2>
                        {fidelityDetail?.phone && <p className="text-slate-500 text-xs flex items-center gap-1"><Phone size={11} /> {fidelityDetail.phone}</p>}
                      </div>
                    </div>
                    <button onClick={() => setSelectedFidelizationClientId(null)} className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition"><X size={14} /></button>
                  </div>
                </div>

                <div className="p-6 space-y-5">
                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-3 items-stretch">
                    <div className="flex flex-col items-center justify-center bg-white/5 rounded-2xl p-4 text-center border border-white/5 min-h-[100px]">
                      <p className="text-4xl font-black text-violet-400 leading-none">{fidelityDetail?.total_visits ?? 0}</p>
                      <p className="text-xs text-white/40 uppercase tracking-wider mt-2">Visitas totales</p>
                    </div>
                    <div className="flex flex-col items-center justify-center bg-white/5 rounded-2xl p-4 text-center border border-white/5 min-h-[100px]">
                      <p className="text-2xl font-bold text-emerald-400 leading-none">{formatCOP(fidelityDetail?.total_spent)}</p>
                      <p className="text-xs text-white/40 uppercase tracking-wider mt-2">Gastado</p>
                    </div>
                  </div>

                  {/* Barra de fidelización */}
                  {loyaltyConfig && loyaltyConfig.reward_service_id && (
                    (() => {
                      const visits = fidelityDetail?.loyalty_visits ?? 0;
                      const target = loyaltyConfig.visits_for_reward || 1;
                      const rewardService = services.find((s) => s.id === loyaltyConfig.reward_service_id);
                      const achieved = visits >= target;
                      const progress = Math.min((visits / target) * 100, 100);
                      const remaining = Math.max(target - visits, 0);

                      return (
                        <div className="p-3 bg-slate-800/50 rounded-xl">
                          {achieved ? (
                            <>
                              <div className="flex items-center gap-2 mb-3">
                                <span className="text-lg">🎉</span>
                                <p className="text-emerald-400 text-sm font-semibold">¡Recompensa disponible!</p>
                              </div>
                              <button
                                onClick={() => { setShowRedeemConfirm(true); setSelectedId(selectedFidelizationClientId); }}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium py-2 rounded-lg transition"
                              >
                                Canjear recompensa 🎉
                              </button>
                            </>
                          ) : (
                            <>
                              <p className="text-slate-400 text-xs mb-2">Progreso de fidelización</p>
                              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
                                <div className="h-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all" style={{ width: `${progress}%` }} />
                              </div>
                              <p className="text-slate-500 text-xs">Le faltan {remaining} {remaining === 1 ? 'visita' : 'visitas'} para {rewardService?.name || 'la recompensa'}</p>
                            </>
                          )}
                        </div>
                      );
                    })()
                  )}

                  {/* Historial de citas */}
                  <div>
                    <p className="text-white/60 text-xs uppercase tracking-widest font-semibold mb-4">Historial de citas</p>
                    {!fidelityDetail?.appointments?.length ? (
                      <p className="text-slate-500 text-sm">Sin citas registradas</p>
                    ) : (
                      <div className="max-h-[400px] overflow-y-auto pr-2 custom-scroll">
                        {fidelityDetail.appointments.map((a) => (
                          <div key={a.id} className="flex flex-col gap-1 py-3 border-b border-white/5 last:border-0">
                            <p className="text-sm font-semibold text-white">{a.services?.name || 'Sin servicio'}</p>
                            <div className="text-xs text-white/40 space-y-0.5">
                              <p>{fmtDate(a.scheduled_at)}</p>
                              {a.employees?.name && <p>Con {a.employees.name}</p>}
                            </div>
                            {a.price > 0 && <p className="text-sm font-medium text-violet-400">{formatCOP(a.price)}</p>}
                            <div className="flex gap-1 pt-1">
                              {a.is_reward && <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap bg-yellow-500/15 text-yellow-400">Recompensa</span>}
                              <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${a.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' : a.status === 'cancelled' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{STATUS_LABEL[a.status]}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex gap-6 min-h-0">

          {/* Lista */}
          <div className="flex-1 min-w-0">
            <div className="flex gap-3 mb-5">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre o teléfono..."
                  className="w-full bg-[#131929] border border-white/10 text-white rounded-xl pl-10 pr-4 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus-within:border-violet-500/50 transition-all duration-200" />
              </div>
              <button onClick={() => setShowCreate(true)}
                className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition whitespace-nowrap">
                <Plus size={16} /> Nuevo cliente
              </button>
            </div>

            {isLoading ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 text-slate-500">
                <Users size={40} className="mx-auto mb-3 opacity-30" />
                <p>{search ? 'Sin resultados para esa búsqueda' : 'Aún no tienes clientes'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map((c) => {
                  const initial = c.name?.[0]?.toUpperCase() || '?';
                  const avatarColors = {
                    'A': 'bg-violet-600/30 text-violet-300',
                    'C': 'bg-indigo-600/30 text-indigo-300',
                    'M': 'bg-blue-600/30 text-blue-300',
                    'J': 'bg-emerald-600/30 text-emerald-300',
                    'S': 'bg-pink-600/30 text-pink-300',
                  };
                  const avatarClass = avatarColors[initial] || 'bg-slate-600/30 text-slate-300';
                  return (
                    <button key={c.id} onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                      className={`w-full text-left bg-[#131929] border border-violet-500/15 hover:border-violet-500/35 hover:bg-[#1a2235] transition-all duration-200 rounded-xl px-5 py-4 flex items-center justify-between ${c.id === selectedId ? 'border-violet-500/50 bg-violet-500/5' : ''}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-semibold flex-shrink-0 ${avatarClass}`}>
                          {initial}
                        </div>
                        <div>
                          <p className="text-white font-medium">{c.name}</p>
                          <p className="text-slate-500 text-sm">{c.phone}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm text-white/60">{c.total_visits} visitas</p>
                          <p className="text-xs text-white/40">{formatCOP(c.total_spent)}</p>
                        </div>
                        <button onClick={(e) => handleRecall(e, c.id)} disabled={recallStatus[c.id] === 'loading'}
                          className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                            recallStatus[c.id] === 'loading' ? 'bg-slate-700 text-slate-400' :
                            recallStatus[c.id] === 'sent' ? 'bg-emerald-600/30 text-emerald-300' :
                            recallStatus[c.id] === 'error' ? 'bg-red-600/30 text-red-300' :
                            'bg-violet-600 text-white hover:bg-violet-500'
                          }`}>
                          {recallStatus[c.id] === 'loading' ? 'Enviando...' :
                           recallStatus[c.id] === 'sent' ? '✓ Enviado' :
                           recallStatus[c.id] === 'error' ? 'Error' :
                           'Recordar'}
                        </button>
                        <ChevronRight size={16} className={`text-slate-600 transition-transform ${c.id === selectedId ? 'rotate-90' : ''}`} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Panel de detalle */}
          {selectedId && (
            <div className="w-[480px] flex-shrink-0 max-h-screen overflow-y-auto custom-scroll">
              <div className="bg-gradient-to-br from-violet-600/20 to-indigo-600/5 border-b border-white/6 p-6 pb-8">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500/30 to-blue-500/30 border border-slate-700 flex items-center justify-center text-sm text-violet-400 font-bold flex-shrink-0">
                      {selected?.name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-white font-semibold leading-tight">{selected?.name}</h2>
                      {selected?.phone && <p className="text-slate-500 text-xs flex items-center gap-1 mt-0.5"><Phone size={11} /> {selected.phone}</p>}
                      {selected?.email && <p className="text-slate-500 text-xs flex items-center gap-1"><Mail size={11} /> {selected.email}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowEdit(true)} className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition"><Pencil size={14} /></button>
                    <button onClick={() => setSelectedId(null)} className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition"><X size={14} /></button>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 items-stretch">
                  <div className="flex flex-col items-center justify-center bg-white/5 rounded-2xl p-4 text-center border border-white/5 min-h-[100px]">
                    <p className="text-4xl font-black text-violet-400 leading-none">{selected?.total_visits ?? 0}</p>
                    <p className="text-xs text-white/40 uppercase tracking-wider mt-2">Visitas totales</p>
                  </div>
                  <div className="flex flex-col items-center justify-center bg-white/5 rounded-2xl p-4 text-center border border-white/5 min-h-[100px]">
                    <p className="text-2xl font-bold text-emerald-400 leading-none">{formatCOP(selected?.total_spent)}</p>
                    <p className="text-xs text-white/40 uppercase tracking-wider mt-2">Gastado</p>
                  </div>
                </div>

                {/* Barra de fidelización */}
                {loyaltyConfig && loyaltyConfig.reward_service_id && (
                  (() => {
                    const visits = selected?.loyalty_visits ?? 0;
                    const target = loyaltyConfig.visits_for_reward || 1;
                    const rewardService = services.find((s) => s.id === loyaltyConfig.reward_service_id);
                    const achieved = visits >= target;
                    const progress = Math.min((visits / target) * 100, 100);
                    const remaining = Math.max(target - visits, 0);

                    return (
                      <div className="mb-5 p-3 bg-slate-800 rounded-xl shadow-lg shadow-black/30">
                        {achieved ? (
                          <>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-lg">🎉</span>
                              <p className="text-emerald-400 text-sm font-semibold">¡Recompensa disponible!</p>
                            </div>
                            <button
                              onClick={() => setShowRedeemConfirm(true)}
                              disabled={isRedeeming}
                              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition"
                            >
                              {isRedeeming ? 'Canjeando...' : 'Canjear recompensa 🎉'}
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="text-slate-400 text-xs mb-2">Progreso de fidelización</p>
                            <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
                              <div className="h-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all" style={{ width: `${progress}%` }} />
                            </div>
                            <p className="text-slate-500 text-xs">Le faltan {remaining} {remaining === 1 ? 'visita' : 'visitas'} para {rewardService?.name || 'la recompensa'}</p>
                          </>
                        )}
                      </div>
                    );
                  })()
                )}

                {lastVisit && (
                  <p className="text-white/50 text-xs">Última visita: <span className="text-white/40">{fmtDate(lastVisit)}</span></p>
                )}

                {selected?.notes && (
                  <div>
                    <p className="text-white/60 text-xs uppercase tracking-widest font-semibold mb-2">Notas</p>
                    <p className="text-white/50 text-sm bg-white/3 rounded-lg px-3 py-2">{selected.notes}</p>
                  </div>
                )}

                {/* Historial de citas */}
                <div>
                  <p className="text-white/60 text-xs uppercase tracking-widest font-semibold mb-4">Historial de citas</p>
                  {!detail?.appointments?.length ? (
                    <p className="text-slate-500 text-sm">Sin citas registradas</p>
                  ) : (
                    <div className="max-h-[400px] overflow-y-auto pr-2 custom-scroll">
                      {detail.appointments.map((a) => (
                        <div key={a.id} className="flex flex-col gap-1 py-3 border-b border-white/5 last:border-0">
                          <p className="text-sm font-semibold text-white">{a.services?.name || 'Sin servicio'}</p>
                          <div className="text-xs text-white/40 space-y-0.5">
                            <p>{fmtDate(a.scheduled_at)}</p>
                            {a.employees?.name && <p>Con {a.employees.name}</p>}
                          </div>
                          {a.price > 0 && <p className="text-sm font-medium text-violet-400">{formatCOP(a.price)}</p>}
                          <div className="flex gap-1 pt-1">
                            {a.is_reward && <span className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap bg-yellow-500/15 text-yellow-400">Recompensa</span>}
                            <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${a.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' : a.status === 'cancelled' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{STATUS_LABEL[a.status]}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {showEdit && selected && <EditModal client={selected} onClose={() => setShowEdit(false)} />}
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}

      {/* Modal de confirmación de canje */}
      {showRedeemConfirm && selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl">
            <h3 className="text-white font-semibold text-lg mb-4">Confirmar canje</h3>
            <p className="text-slate-300 text-sm mb-6">¿Confirmas que se canjeó la recompensa para <span className="font-semibold">{selected.name}</span>?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRedeemConfirm(false)}
                disabled={isRedeeming}
                className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setIsRedeeming(true);
                  redeemMutation.mutate({ clientId: selectedId });
                }}
                disabled={isRedeeming}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition"
              >
                {isRedeeming ? 'Canjeando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
