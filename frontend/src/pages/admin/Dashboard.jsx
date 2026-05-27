import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarCheck, TrendingUp, AlertTriangle, Zap, AlertCircle } from 'lucide-react';
import api from '../../lib/api';

function MetricCard({ label, value, sub, icon: Icon, accent = 'violet' }) {
  const colors = {
    violet: 'text-violet-400 bg-violet-500/10',
    emerald: 'text-emerald-400 bg-emerald-500/10',
    blue:    'text-blue-400 bg-blue-500/10',
    red:     'text-red-400 bg-red-500/10',
  };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-400 text-sm">{label}</p>
        <div className={`p-2 rounded-lg ${colors[accent]}`}>
          <Icon size={18} className={colors[accent].split(' ')[0]} />
        </div>
      </div>
      <p className="text-white text-3xl font-bold">{value ?? '—'}</p>
      {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function SkeletonCard() {
  return <div className="h-28 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />;
}

export default function AdminDashboard() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => api.get('/api/admin/metrics').then((r) => r.data.data),
  });

  const { data: assistantFailures } = useQuery({
    queryKey: ['admin-assistant-failures'],
    queryFn: () => api.get('/api/admin/notifications?type=assistant_fail').then((r) => r.data.data),
    refetchInterval: 30000,
  });

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-white text-xl sm:text-2xl font-bold">Dashboard</h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-1">Visión global de la plataforma ZITA</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Total negocios"
            value={metrics?.total_businesses}
            sub={`${metrics?.trial ?? 0} en trial`}
            icon={Building2}
            accent="violet"
          />
          <MetricCard
            label="Citas hoy (plataforma)"
            value={metrics?.today_appointments}
            sub="En todos los negocios"
            icon={CalendarCheck}
            accent="blue"
          />
          <MetricCard
            label="Negocios activos"
            value={metrics?.active}
            sub="Estado: active"
            icon={TrendingUp}
            accent="emerald"
          />
          <MetricCard
            label="Suspendidos"
            value={metrics?.suspended}
            sub="Requieren atención"
            icon={AlertTriangle}
            accent="red"
          />
        </div>
      )}

      {!isLoading && metrics && (
        <div className="mt-6 sm:mt-8 bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6">
          <h2 className="text-white font-semibold text-sm sm:text-base mb-4">Distribución por estado</h2>
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
            {[
              { label: 'Trial', value: metrics.trial, color: 'bg-yellow-500' },
              { label: 'Activo', value: metrics.active, color: 'bg-emerald-500' },
              { label: 'Suspendido', value: metrics.suspended, color: 'bg-red-500' },
            ].map(({ label, value, color }) => {
              const total = metrics.total_businesses || 1;
              const pct = Math.round((value / total) * 100);
              return (
                <div key={label} className="flex-1">
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-white font-medium">{value}</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {assistantFailures && assistantFailures.length > 0 && (
        <div className="mt-6 sm:mt-8 bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle size={18} className="text-orange-400" />
            <h2 className="text-white font-semibold text-sm sm:text-base">Limitaciones del asistente</h2>
          </div>
          <div className="space-y-3">
            {assistantFailures.slice(0, 5).map((failure) => (
              <div key={failure.id} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                <div className="flex justify-between items-start gap-2 mb-1">
                  <span className="text-slate-300 text-xs sm:text-sm font-medium">{failure.business_name}</span>
                  <span className="text-slate-500 text-xs">{new Date(failure.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-slate-400 text-xs sm:text-sm">{failure.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
