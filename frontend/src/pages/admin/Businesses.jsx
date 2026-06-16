import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, Search, CheckCircle2, AlertTriangle, Clock, XCircle } from 'lucide-react';
import api from '../../lib/api';

const BUSINESS_TYPE_LABELS = {
  barberia: 'Barbería', spa: 'Spa', veterinaria: 'Veterinaria',
  salud: 'Salud', tienda: 'Tienda', gym: 'Gym', dentista: 'Dentista'
};

const STATUS_CONFIG = {
  trial: { label: 'Período de prueba', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Clock },
  active: { label: 'Activo', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
  suspended: { label: 'Suspendido', color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: XCircle },
};

const PLAN_CONFIG = {
  lite: { label: 'Lite', color: 'text-slate-300 bg-slate-500/10 border-slate-500/20' },
  estandar: { label: 'Estándar', color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
  pro: { label: 'Pro', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
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

function PlanBadge({ plan }) {
  const cfg = PLAN_CONFIG[plan];
  if (!cfg) return null;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

export default function Businesses() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('todos');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-businesses'],
    queryFn: () => api.get('/api/admin/businesses').then(r => r.data.data),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/api/admin/businesses/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries(['admin-businesses']),
  });

  const getTabCount = (tab) => {
    const allData = data || [];
    switch(tab) {
      case 'todos':
        return allData.filter(b => b.status !== 'suspended').length;
      case 'lite':
        return allData.filter(b => b.plan === 'lite' && b.status !== 'suspended').length;
      case 'estandar':
        return allData.filter(b => b.plan === 'estandar' && b.status !== 'suspended').length;
      case 'pro':
        return allData.filter(b => b.plan === 'pro' && b.status !== 'suspended').length;
      case 'trial':
        return allData.filter(b => b.status === 'trial').length;
      case 'suspendidos':
        return allData.filter(b => b.status === 'suspended').length;
      default:
        return 0;
    }
  };

  const businesses = (data || []).filter(b => {
    const matchSearch = !search ||
      b.name?.toLowerCase().includes(search.toLowerCase()) ||
      b.owner_email?.toLowerCase().includes(search.toLowerCase());

    let matchTab = true;
    if (activeTab === 'todos') {
      matchTab = b.status !== 'suspended';
    } else if (activeTab === 'lite') {
      matchTab = b.plan === 'lite' && b.status !== 'suspended';
    } else if (activeTab === 'estandar') {
      matchTab = b.plan === 'estandar' && b.status !== 'suspended';
    } else if (activeTab === 'pro') {
      matchTab = b.plan === 'pro' && b.status !== 'suspended';
    } else if (activeTab === 'trial') {
      matchTab = b.status === 'trial';
    } else if (activeTab === 'suspendidos') {
      matchTab = b.status === 'suspended';
    }

    return matchSearch && matchTab;
  });

  const activeCount = (data || []).filter(b => b.status === 'active').length;
  const trialCount = (data || []).filter(b => b.status === 'trial').length;
  const suspendedCount = (data || []).filter(b => b.status === 'suspended').length;
  const registeredCount = (data || []).filter(b => b.status !== 'suspended').length;

  const tabs = [
    { id: 'todos', label: 'Todos' },
    { id: 'lite', label: 'Lite' },
    { id: 'estandar', label: 'Estándar' },
    { id: 'pro', label: 'Pro' },
    { id: 'trial', label: 'Trial' },
    { id: 'suspendidos', label: 'Suspendidos' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Negocios</h1>
        <p className="text-slate-400 text-sm mt-1">{registeredCount} negocios registrados</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-[#131929] border border-white/10 rounded-2xl p-4">
          <p className="text-slate-400 text-xs mb-2">Activos</p>
          <p className="text-3xl font-bold text-emerald-400">{activeCount}</p>
        </div>
        <div className="bg-[#131929] border border-white/10 rounded-2xl p-4">
          <p className="text-slate-400 text-xs mb-2">Trial</p>
          <p className="text-3xl font-bold text-yellow-400">{trialCount}</p>
        </div>
        <div className="bg-[#131929] border border-white/10 rounded-2xl p-4">
          <p className="text-slate-400 text-xs mb-2">Suspendidos</p>
          <p className="text-3xl font-bold text-red-400">{suspendedCount}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Buscar por nombre o email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-[#131929] border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/50'
                : 'bg-[#131929] text-slate-400 border border-white/10 hover:border-white/20'
            }`}
          >
            {tab.label} ({getTabCount(tab.id)})
          </button>
        ))}
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
                  <div className="flex flex-col gap-1">
                    {b.owner_name && <p className="text-slate-400 text-xs truncate">{b.owner_name}</p>}
                    <div className="flex items-center gap-3">
                      <p className="text-slate-500 text-xs truncate">{b.owner_email}</p>
                      {b.phone && <p className="text-slate-600 text-xs hidden md:block">{b.phone}</p>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={b.status} />
                    <PlanBadge plan={b.plan} />
                  </div>
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
