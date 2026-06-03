import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Users, UserCheck, UserX, Bell } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '../../lib/api';

const MONTH_NAMES  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function formatMonth(ym) {
  const [, m] = ym.split('-');
  return MONTH_NAMES[Number(m) - 1];
}

// ─── RETENTION ────────────────────────────────────────────────────────────────

function RetentionSection({ data }) {
  const [recallStates, setRecallStates] = useState({});
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    function updateSize() {
      setIsMobile(window.innerWidth < 768);
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const {
    retention_rate, new_clients, returned_clients,
    last_month_total, at_risk_clients, monthly_trend,
  } = data;

  const lost = Math.max(0, (last_month_total || 0) - (returned_clients || 0));

  const allTrendData = (monthly_trend || []).map((m) => ({
    name: formatMonth(m.month),
    Nuevos: m.new_clients,
    Recurrentes: m.returning,
  }));

  const trendData = isMobile ? allTrendData.slice(-4) : allTrendData;

  return (
    <div>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4 mb-6">
        <div className="bg-[#131929] border border-violet-500/15 hover:border-violet-500/35 rounded-xl shadow-lg shadow-black/30 p-3 transition-all duration-200">
          <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center mb-2">
            <TrendingUp size={16} className="text-violet-400" />
          </div>
          <p className="text-lg sm:text-2xl font-bold text-violet-400 mb-1">{retention_rate ?? 0}%</p>
          <p className="text-white text-xs font-medium">Tasa de retención</p>
        </div>

        <div className="bg-[#131929] border border-emerald-500/15 hover:border-emerald-500/35 rounded-xl shadow-lg shadow-black/30 p-3 transition-all duration-200">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center mb-2">
            <Users size={16} className="text-emerald-400" />
          </div>
          <p className="text-lg sm:text-2xl font-bold text-emerald-400 mb-1">{new_clients ?? 0}</p>
          <p className="text-white text-xs font-medium">Clientes nuevos</p>
        </div>

        <div className="bg-[#131929] border border-blue-500/15 hover:border-blue-500/35 rounded-xl shadow-lg shadow-black/30 p-3 transition-all duration-200">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center mb-2">
            <UserCheck size={16} className="text-blue-400" />
          </div>
          <p className="text-lg sm:text-2xl font-bold text-blue-400 mb-1">{returned_clients ?? 0}</p>
          <p className="text-white text-xs font-medium leading-tight">Clientes que volvieron</p>
        </div>

        <div className="bg-[#131929] border border-red-500/15 hover:border-red-500/35 rounded-xl shadow-lg shadow-black/30 p-3 transition-all duration-200">
          <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center mb-2">
            <UserX size={16} className="text-red-400" />
          </div>
          <p className="text-lg sm:text-2xl font-bold text-red-400 mb-1">{lost}</p>
          <p className="text-white text-xs font-medium">Clientes perdidos</p>
        </div>
      </div>

      <div className="border-t border-white/6 my-6" />

      {/* Monthly trend bar chart */}
      <div className="bg-[#131929] border border-violet-500/15 rounded-xl p-6 transition-all duration-200">
        <h3 className="text-base font-semibold text-white mb-1">
          Clientes nuevos vs recurrentes
        </h3>
        <p className="text-xs text-white/40 mb-4">Últimos 6 meses</p>
        {trendData.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-slate-600 text-sm">
            Sin datos suficientes aún
          </div>
        ) : (
          <>
            {/* Mobile */}
            <div className="block md:hidden">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trendData} barGap={8}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid rgba(124,58,237,0.3)',
                      borderRadius: '8px',
                      color: 'white',
                      fontSize: '12px'
                    }}
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '16px', fontSize: '12px', color: 'rgba(255,255,255,0.6)' }} />
                  <Bar dataKey="Nuevos"      fill="#7c3aed" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar dataKey="Recurrentes" fill="#06b6d4" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Desktop */}
            <div className="hidden md:block">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trendData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid rgba(124,58,237,0.3)',
                      borderRadius: '8px',
                      color: 'white',
                      fontSize: '12px'
                    }}
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '16px', fontSize: '12px', color: 'rgba(255,255,255,0.6)' }} />
                  <Bar dataKey="Nuevos"      fill="#7c3aed" radius={[4, 4, 0, 0]} barSize={30} />
                  <Bar dataKey="Recurrentes" fill="#06b6d4" radius={[4, 4, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-white/6 my-6" />

      {/* At-risk clients */}
      {(at_risk_clients || []).length > 0 && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-amber-400">⚠</span>
            <h2 className="text-base font-semibold text-white whitespace-nowrap">Clientes en riesgo</h2>
            <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">
              sin visita 30-90 días
            </span>
          </div>
          <div className="space-y-2 mb-8">
            {(at_risk_clients || []).map((client) => {
              const state = recallStates[client.id] || 'idle';
              const handleRecall = async () => {
                setRecallStates((prev) => ({ ...prev, [client.id]: 'loading' }));
                try {
                  await api.post(`/api/clients/${client.id}/recall`);
                  setRecallStates((prev) => ({ ...prev, [client.id]: 'sent' }));
                  setTimeout(() => {
                    setRecallStates((prev) => ({ ...prev, [client.id]: 'idle' }));
                  }, 3000);
                } catch (err) {
                  setRecallStates((prev) => ({ ...prev, [client.id]: 'error' }));
                  setTimeout(() => {
                    setRecallStates((prev) => ({ ...prev, [client.id]: 'idle' }));
                  }, 3000);
                }
              };
              return (
                <div
                  key={client.id}
                  className="border border-white/5 hover:border-amber-500/20 hover:bg-amber-500/5 transition-all duration-200 rounded-xl px-4 py-3 flex items-center gap-3"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 text-sm font-semibold flex items-center justify-center flex-shrink-0">
                    {client.name?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{client.name}</p>
                    <p className="text-xs text-white/40">{client.phone || '—'}</p>
                  </div>
                  <button
                    onClick={handleRecall}
                    disabled={state === 'loading'}
                    className={`ml-auto text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all duration-150 font-medium flex-shrink-0 ${
                      state === 'loading'
                        ? 'bg-white/5 text-white/30 cursor-not-allowed'
                        : state === 'sent'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : state === 'error'
                        ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                        : 'bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/25 hover:border-violet-500/40'
                    }`}
                  >
                    {state === 'loading'
                      ? 'Enviando...'
                      : state === 'sent'
                      ? '✓ Enviado'
                      : state === 'error'
                      ? 'Error'
                      : 'Recordar'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function Analytics() {
  const retentionQ = useQuery({
    queryKey: ['metrics-retention'],
    queryFn: () => api.get('/api/metrics/retention').then((r) => r.data.data),
  });

  return (
    <div className="p-8">
      <div className="page-header border-b border-white/6 pb-4 mb-6">
        <h1 className="text-white text-2xl font-bold">Analíticas</h1>
        <p className="text-slate-400 text-sm mt-1">
          Comportamiento y retención de tus clientes
        </p>
      </div>

      {/* Retention */}
      {retentionQ.isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
            ))}
          </div>
          <div className="h-64 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
        </div>
      ) : retentionQ.data ? (
        <RetentionSection data={retentionQ.data} />
      ) : null}
    </div>
  );
}
