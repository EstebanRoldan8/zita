import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, Search, Filter, CheckCircle2, AlertTriangle, Clock, XCircle } from 'lucide-react';
import api from '../../lib/api';

const BUSINESS_TYPE_LABELS = {
  barberia: 'Barbería', spa: 'Spa', veterinaria: 'Veterinaria',
  salud: 'Salud', tienda: 'Tienda', gym: 'Gym', dentista: 'Dentista'
};

const STATUS_CONFIG = {
  trial: { label: 'Período de prueba', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Clock },
  active: { label: 'Activo', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
  suspended: { label: 'Suspendido', color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: XCircle },
  expired: { label: 'Vencido', color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: AlertTriangle },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.trial;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.color}`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

export default function Businesses() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPlan, setFilterPlan] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-businesses'],
    queryFn: () => api.get('/api/admin/businesses').then(r => r.data.data),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/api/admin/businesses/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries(['admin-businesses']),
  });

  const planCounts = {
    lite: (data || []).filter(b => b.plan === 'lite').length,
    estandar: (data || []).filter(b => b.plan === 'estandar').length,
    pro: (data || []).filter(b => b.plan === 'pro').length,
  };

  const businesses = (data || []).filter(b => {
    const matchSearch = !search ||
      b.name?.toLowerCase().includes(search.toLowerCase()) ||
      b.owner_email?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || b.status === filterStatus;
    const matchPlan = filterPlan === 'all' || b.plan === filterPlan;
    return matchSearch && matchStatus && matchPlan;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Negocios</h1>
        <p className="text-slate-400 text-sm mt-1">{data?.length || 0} negocios registrados</p>

        {/* Plan distribution badges */}
        <div className="flex gap-2 mt-3">
          {['lite', 'estandar', 'pro'].map(plan => (
            <button
              key={plan}
              onClick={() => setFilterPlan(filterPlan === plan ? 'all' : plan)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                plan === 'lite'
                  ? filterPlan === 'lite'
                    ? 'text-slate-300 bg-slate-500/10 border-slate-500/20'
                    : 'text-slate-300 bg-slate-500/10 border-slate-500/20 opacity-40 hover:opacity-60'
                  : plan === 'estandar'
                  ? filterPlan === 'estandar'
                    ? 'text-violet-400 bg-violet-500/10 border-violet-500/20'
                    : 'text-violet-400 bg-violet-500/10 border-violet-500/20 opacity-40 hover:opacity-60'
                  : filterPlan === 'pro'
                  ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
                  : 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20 opacity-40 hover:opacity-60'
              }`}
            >
              {plan === 'lite' ? 'Lite' : plan === 'estandar' ? 'Estándar' : 'Pro'}: {
                plan === 'lite' ? planCounts.lite : plan === 'estandar' ? planCounts.estandar : planCounts.pro
              }
            </button>
          ))}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar por nombre o email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-[#131929] border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <div className="flex gap-2">
          {['all', 'trial', 'active', 'suspended'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                filterStatus === s
                  ? 'bg-violet-600 text-white border-violet-500'
                  : 'bg-[#131929] text-slate-400 border-white/10 hover:border-white/20'
              }`}
            >
              {s === 'all' ? 'Todos' : STATUS_CONFIG[s]?.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-20 bg-[#131929] rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : businesses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 size={40} className="text-slate-600 mb-3" />
          <p className="text-slate-400">No hay negocios que coincidan</p>
        </div>
      ) : (
        <div className="space-y-3">
          {businesses.map((b, idx) => (
            <div
              key={b.id}
              onClick={() => navigate(`/admin/negocios/${b.id}`)}
              style={{ animationDelay: `${idx * 40}ms` }}
              className="bg-[#131929] border border-white/10 hover:border-violet-500/30 rounded-2xl p-4 cursor-pointer transition-all group animate-fade-slide-up"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                  <Building2 size={18} className="text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-white font-semibold truncate">{b.name}</p>
                    <span className="text-slate-600 text-xs hidden sm:block">
                      {BUSINESS_TYPE_LABELS[b.business_type] || b.business_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-slate-500 text-xs truncate">{b.owner_email}</p>
                    {b.phone && <p className="text-slate-600 text-xs hidden md:block">{b.phone}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={b.status} />
                  <span className="text-xs text-slate-600 hidden md:block">
                    {new Date(b.created_at).toLocaleDateString('es-CO')}
                  </span>
                  <ChevronRight size={16} className="text-slate-600 group-hover:text-violet-400 transition-colors" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
