import { useQuery } from '@tanstack/react-query';
import {
  Building2, TrendingUp, DollarSign, Users,
  AlertTriangle, CheckCircle2, Clock, Zap,
  ArrowUp, ArrowDown, Activity
} from 'lucide-react';
import api from '../../lib/api';

function KPICard({ title, value, subtitle, icon: Icon, color = 'violet', trend }) {
  const colors = {
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };

  return (
    <div className="bg-[#131929] border border-white/10 rounded-2xl p-5 transition-all duration-300 hover:border-violet-500/30 hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-500/10 animate-fade-slide-up">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${colors[color]}`}>
          <Icon size={18} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend >= 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-white mb-1">{value}</p>
      <p className="text-slate-400 text-sm font-medium">{title}</p>
      {subtitle && <p className="text-slate-500 text-xs mt-1">{subtitle}</p>}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    trial: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    expired: 'bg-red-500/10 text-red-400 border-red-500/20',
    suspended: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  const labels = { trial: 'Trial', active: 'Activo', expired: 'Vencido', suspended: 'Suspendido' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] || map.trial}`}>
      {labels[status] || status}
    </span>
  );
}

export default function AdminDashboard() {
  const { data: metricsData, isLoading } = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => api.get('/api/admin/metrics').then(r => r.data.data),
    refetchInterval: 30000
  });

  const { data: notifData } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: () => api.get('/api/admin/notifications').then(r => r.data.data),
  });

  const m = metricsData || {};
  const total = m.total_businesses || 0;
  const activos = m.active || 0;
  const trial = m.trial || 0;
  const suspendidos = m.suspended || 0;
  const citasHoy = m.today_appointments || 0;
  const fallos = notifData?.filter(n => n.type === 'assistant_fail') || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">Visión global de la plataforma ZITA</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div style={{ animationDelay: '0ms' }}>
          <KPICard
            title="Total negocios"
            value={total}
            subtitle={`${trial} en período de prueba`}
            icon={Building2}
            color="violet"
          />
        </div>
        <div style={{ animationDelay: '50ms' }}>
          <KPICard
            title="Negocios activos"
            value={activos}
            subtitle="Con plan pagado"
            icon={CheckCircle2}
            color="emerald"
          />
        </div>
        <div style={{ animationDelay: '100ms' }}>
          <KPICard
            title="Citas hoy"
            value={citasHoy}
            subtitle="En toda la plataforma"
            icon={Activity}
            color="blue"
          />
        </div>
        <div style={{ animationDelay: '150ms' }}>
          <KPICard
            title="Suspendidos"
            value={suspendidos}
            subtitle="Requieren atención"
            icon={AlertTriangle}
            color={suspendidos > 0 ? 'red' : 'violet'}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Distribución por estado */}
        <div className="lg:col-span-2 bg-[#131929] border border-white/10 rounded-2xl p-6 animate-fade-slide-up" style={{ animationDelay: '200ms' }}>
          <h2 className="text-white font-semibold mb-5">Distribución por estado</h2>
          <div className="space-y-4">
            {[
              { label: 'Período de prueba', value: trial, total, color: 'bg-yellow-400' },
              { label: 'Activos', value: activos, total, color: 'bg-emerald-400' },
              { label: 'Suspendidos', value: suspendidos, total, color: 'bg-red-400' },
            ].map(({ label, value, total, color }) => (
              <div key={label}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-slate-300">{label}</span>
                  <span className="text-slate-400">{value} / {total}</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${color} rounded-full transition-all`}
                    style={{ width: total > 0 ? `${(value/total)*100}%` : '0%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Fallos del asistente */}
        <div className="bg-[#131929] border border-white/10 rounded-2xl p-6 animate-fade-slide-up" style={{ animationDelay: '200ms' }}>
          <h2 className="text-white font-semibold mb-5">Fallos del asistente</h2>
          {fallos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <CheckCircle2 size={32} className="text-emerald-400 mb-2" />
              <p className="text-slate-400 text-sm">Sin fallos recientes</p>
            </div>
          ) : (
            <div className="space-y-3">
              {fallos.slice(0, 4).map((n, i) => (
                <div key={i} className="bg-red-500/5 border border-red-500/10 rounded-xl p-3">
                  <p className="text-slate-300 text-xs line-clamp-2">{n.message}</p>
                  <p className="text-slate-500 text-xs mt-1">
                    {new Date(n.created_at).toLocaleDateString('es-CO')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
