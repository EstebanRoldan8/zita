import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, Phone, Mail, MapPin, MessageSquare, Building2,
  Clock, CheckCircle2, XCircle, PhoneCall, Filter
} from 'lucide-react';
import api from '../../lib/api';

const SERVICIO_LABELS = {
  general: 'Contacto general',
  enterprise: 'Enterprise',
  demo: 'Demo',
  partners: 'Partners',
  partner_registro: 'Registro Partner',
  lite: 'Demo (Lite)',
  estandar: 'Demo (Estándar)',
  pro: 'Demo (Pro)',
};

const STATUS_CONFIG = {
  pending: { label: 'Nuevo', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Clock },
  contacted: { label: 'Contactado', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: PhoneCall },
  closed: { label: 'Cerrado', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
  lost: { label: 'Perdido', color: 'bg-red-500/10 text-red-400 border-red-500/20', icon: XCircle },
};

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `hace ${days}d`;
  return new Date(date).toLocaleDateString('es-CO');
}

function StatCard({ label, value, color, icon: Icon, delay = 0 }) {
  const colors = {
    yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  };
  return (
    <div className="bg-[#131929] border border-white/10 rounded-2xl p-4 transition-all duration-300 hover:border-violet-500/30 hover:-translate-y-1 animate-fade-slide-up" style={{ animationDelay: `${delay}ms` }}>
      <div className={`w-9 h-9 rounded-xl border flex items-center justify-center mb-3 ${colors[color]}`}>
        <Icon size={16} />
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
      <p className="text-slate-500 text-xs mt-0.5">{label}</p>
    </div>
  );
}

export default function LeadsAdmin() {
  const queryClient = useQueryClient();
  const [filterServicio, setFilterServicio] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-leads'],
    queryFn: () => api.get('/api/admin/leads').then(r => r.data.data),
    refetchInterval: 30000,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/api/admin/leads/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries(['admin-leads']),
  });

  const leads = (data?.leads || []).filter(l => {
    const matchServicio = filterServicio === 'all' || l.servicio === filterServicio;
    const matchStatus = filterStatus === 'all' || l.status === filterStatus;
    return matchServicio && matchStatus;
  });

  const stats = data?.stats || {};

  if (isLoading) return (
    <div className="p-6 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-20 bg-[#131929] rounded-2xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Leads</h1>
        <p className="text-slate-400 text-sm mt-1">{stats.total || 0} solicitudes recibidas</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Nuevos" value={stats.pending || 0} color="yellow" icon={Clock} delay={0} />
        <StatCard label="Contactados" value={stats.contacted || 0} color="blue" icon={PhoneCall} delay={50} />
        <StatCard label="Cerrados" value={stats.closed || 0} color="emerald" icon={CheckCircle2} delay={100} />
        <StatCard label="Perdidos" value={stats.lost || 0} color="red" icon={XCircle} delay={150} />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="flex items-center gap-1.5 text-slate-500 text-xs mr-1">
          <Filter size={13} />
          Servicio:
        </div>
        {['all', 'general', 'enterprise', 'demo', 'partners', 'partner_registro'].map(s => (
          <button
            key={s}
            onClick={() => setFilterServicio(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
              filterServicio === s
                ? 'bg-violet-600 text-white border-violet-500'
                : 'bg-[#131929] text-slate-400 border-white/10 hover:border-white/20'
            }`}
          >
            {s === 'all' ? 'Todos' : SERVICIO_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <div className="flex items-center gap-1.5 text-slate-500 text-xs mr-1">
          <Filter size={13} />
          Estado:
        </div>
        {['all', 'pending', 'contacted', 'closed', 'lost'].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
              filterStatus === s
                ? 'bg-violet-600 text-white border-violet-500'
                : 'bg-[#131929] text-slate-400 border-white/10 hover:border-white/20'
            }`}
          >
            {s === 'all' ? 'Todos' : STATUS_CONFIG[s]?.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <TrendingUp size={40} className="text-slate-600 mb-3" />
          <p className="text-slate-400">No hay leads que coincidan</p>
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map((l, idx) => {
            const cfg = STATUS_CONFIG[l.status] || STATUS_CONFIG.pending;
            const StatusIcon = cfg.icon;
            return (
              <div
                key={l.id}
                className="bg-[#131929] border border-white/10 rounded-2xl p-4 animate-fade-slide-up"
                style={{ animationDelay: `${idx * 30}ms` }}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-white font-semibold">{l.nombre}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                        {SERVICIO_LABELS[l.servicio] || l.servicio}
                      </span>
                    </div>
                    <p className="text-slate-500 text-xs">{timeAgo(l.created_at)}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border shrink-0 ${cfg.color}`}>
                    <StatusIcon size={11} />
                    {cfg.label}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3 text-sm">
                  {l.tipo_negocio && (
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Building2 size={13} className="text-slate-500" />
                      {l.tipo_negocio}
                    </div>
                  )}
                  {l.ciudad && (
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <MapPin size={13} className="text-slate-500" />
                      {l.ciudad}
                    </div>
                  )}
                  {l.whatsapp && (
                    <a href={`https://wa.me/${l.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300">
                      <Phone size={13} />
                      {l.whatsapp}
                    </a>
                  )}
                  {l.email && (
                    <a href={`mailto:${l.email}`} className="flex items-center gap-1.5 text-slate-400 hover:text-white">
                      <Mail size={13} className="text-slate-500" />
                      {l.email}
                    </a>
                  )}
                </div>

                {l.mensaje && (
                  <div className="flex items-start gap-2 bg-white/5 rounded-xl p-3 mb-3">
                    <MessageSquare size={14} className="text-slate-500 mt-0.5 shrink-0" />
                    <p className="text-slate-300 text-sm">{l.mensaje}</p>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <p className="text-slate-600 text-xs">
                    {new Date(l.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 text-xs">Cambiar estado:</span>
                    <select
                      value={l.status}
                      onChange={e => updateStatus.mutate({ id: l.id, status: e.target.value })}
                      disabled={updateStatus.isPending}
                      className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500/50 cursor-pointer"
                    >
                      {Object.entries(STATUS_CONFIG).map(([key, cfg2]) => (
                        <option key={key} value={key} className="bg-[#131929]">{cfg2.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
