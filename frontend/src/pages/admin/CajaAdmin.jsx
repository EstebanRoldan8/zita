import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign, TrendingUp, TrendingDown, Wallet, Plus, Trash2,
  ArrowUpRight, ArrowDownRight, X
} from 'lucide-react';
import api from '../../lib/api';

const PLAN_LABELS = { lite: 'Lite', estandar: 'Estándar', pro: 'Pro' };

function formatCOP(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

function KPICard({ title, value, subtitle, icon: Icon, color = 'violet' }) {
  const colors = {
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };
  return (
    <div className="bg-[#131929] border border-white/10 rounded-2xl p-5">
      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-4 ${colors[color]}`}>
        <Icon size={18} />
      </div>
      <p className="text-2xl font-bold text-white mb-1">{value}</p>
      <p className="text-slate-400 text-sm font-medium">{title}</p>
      {subtitle && <p className="text-slate-500 text-xs mt-1">{subtitle}</p>}
    </div>
  );
}

const CATEGORIAS = ['Railway', 'Supabase', 'Anthropic API', 'Resend', 'WhatsApp/Meta', 'Wompi', 'Dominio', 'Otro'];

export default function CajaAdmin() {
  const queryClient = useQueryClient();
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [form, setForm] = useState({ category: 'Railway', description: '', amount: '', currency: 'USD', recurring: true, date: new Date().toISOString().slice(0,10) });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-caja'],
    queryFn: () => api.get('/api/admin/caja').then(r => r.data.data),
  });

  const createExpense = useMutation({
    mutationFn: (payload) => api.post('/api/admin/caja/expenses', payload),
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-caja']);
      setShowExpenseModal(false);
      setForm({ category: 'Railway', description: '', amount: '', currency: 'USD', recurring: true, date: new Date().toISOString().slice(0,10) });
    }
  });

  const deleteExpense = useMutation({
    mutationFn: (id) => api.delete(`/api/admin/caja/expenses/${id}`),
    onSuccess: () => queryClient.invalidateQueries(['admin-caja']),
  });

  if (isLoading) return (
    <div className="p-6 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-24 bg-[#131929] rounded-2xl animate-pulse" />)}
    </div>
  );

  const d = data || {};
  const maxIngresos = Math.max(...(d.trend || []).map(t => t.ingresos), 1);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Caja ZITA</h1>
          <p className="text-slate-400 text-sm mt-1">Ingresos por suscripciones y costos operativos</p>
        </div>
        <button
          onClick={() => setShowExpenseModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all"
        >
          <Plus size={16} />
          Registrar egreso
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard title="MRR" value={formatCOP(d.mrr || 0)} subtitle={`${d.negocios_activos || 0} negocios activos`} icon={Wallet} color="violet" />
        <KPICard title="Ingresos del mes" value={formatCOP(d.ingresos_mes || 0)} subtitle="Pagos aprobados" icon={ArrowUpRight} color="emerald" />
        <KPICard title="Egresos del mes" value={formatCOP(d.egresos_mes || 0)} subtitle="Costos operativos" icon={ArrowDownRight} color="red" />
        <KPICard
          title="Utilidad del mes"
          value={formatCOP(d.utilidad_mes || 0)}
          subtitle={d.utilidad_mes >= 0 ? '🟢 Positivo' : '🔴 Negativo'}
          icon={d.utilidad_mes >= 0 ? TrendingUp : TrendingDown}
          color={d.utilidad_mes >= 0 ? 'emerald' : 'red'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Tendencia */}
        <div className="lg:col-span-2 bg-[#131929] border border-white/10 rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-5">Ingresos últimos 6 meses</h2>
          <div className="flex items-end gap-2 h-40">
            {(d.trend || []).map(t => (
              <div key={t.month} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full bg-violet-500/20 hover:bg-violet-500/30 rounded-t-lg transition-all relative group"
                     style={{ height: `${(t.ingresos / maxIngresos) * 100}%`, minHeight: '4px' }}>
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {formatCOP(t.ingresos)}
                  </div>
                </div>
                <span className="text-slate-500 text-xs">{t.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pagos recientes */}
        <div className="bg-[#131929] border border-white/10 rounded-2xl p-6">
          <h2 className="text-white font-semibold mb-4">Pagos recientes</h2>
          {!d.pagos_recientes?.length ? (
            <p className="text-slate-500 text-sm text-center py-6">Sin pagos registrados</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {d.pagos_recientes.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <div className="min-w-0">
                    <p className="text-slate-200 text-sm truncate">{p.business_name}</p>
                    <p className="text-slate-500 text-xs">{PLAN_LABELS[p.plan] || p.plan}</p>
                  </div>
                  <p className="text-emerald-400 text-sm font-medium shrink-0">{formatCOP(p.amount)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Egresos */}
      <div className="mt-6 bg-[#131929] border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">Egresos operativos</h2>
          <p className="text-slate-500 text-xs">Recurrentes mensuales: {formatCOP(d.egresos_recurrentes_mes || 0)}</p>
        </div>
        {!d.egresos?.length ? (
          <p className="text-slate-500 text-sm text-center py-6">Sin egresos registrados</p>
        ) : (
          <div className="space-y-2">
            {d.egresos.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <DollarSign size={14} className="text-red-400" />
                  </div>
                  <div>
                    <p className="text-slate-200 text-sm">{e.category}</p>
                    <p className="text-slate-500 text-xs">{e.description || '—'} · {new Date(e.date).toLocaleDateString('es-CO')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-slate-200 text-sm font-medium">{formatCOP(e.amount_cop)}</p>
                    {e.recurring && <span className="text-xs text-violet-400">Recurrente</span>}
                  </div>
                  <button
                    onClick={() => deleteExpense.mutate(e.id)}
                    className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/10 hover:text-red-400 flex items-center justify-center text-slate-500 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal nuevo egreso */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#131929] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Registrar egreso</h3>
              <button onClick={() => setShowExpenseModal(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-slate-400 text-xs mb-1.5 block">Categoría</label>
                <select
                  value={form.category}
                  onChange={e => setForm({...form, category: e.target.value})}
                  className="w-full px-3 py-2.5 bg-[#0a0a0f] border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-violet-500/50"
                >
                  {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="text-slate-400 text-xs mb-1.5 block">Descripción (opcional)</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={e => setForm({...form, description: e.target.value})}
                  placeholder="Ej: Plan Pro mensual"
                  className="w-full px-3 py-2.5 bg-[#0a0a0f] border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 text-xs mb-1.5 block">Monto</label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={e => setForm({...form, amount: e.target.value})}
                    placeholder="0"
                    className="w-full px-3 py-2.5 bg-[#0a0a0f] border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-xs mb-1.5 block">Moneda</label>
                  <select
                    value={form.currency}
                    onChange={e => setForm({...form, currency: e.target.value})}
                    className="w-full px-3 py-2.5 bg-[#0a0a0f] border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="USD">USD</option>
                    <option value="COP">COP</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 text-xs mb-1.5 block">Fecha</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm({...form, date: e.target.value})}
                  className="w-full px-3 py-2.5 bg-[#0a0a0f] border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-violet-500/50"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.recurring}
                  onChange={e => setForm({...form, recurring: e.target.checked})}
                  className="w-4 h-4 rounded accent-violet-600"
                />
                <span className="text-slate-300 text-sm">Es un gasto recurrente mensual</span>
              </label>
            </div>

            <button
              onClick={() => createExpense.mutate({ ...form, amount: Number(form.amount) })}
              disabled={!form.amount || createExpense.isPending}
              className="w-full mt-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium transition-all"
            >
              Guardar egreso
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
