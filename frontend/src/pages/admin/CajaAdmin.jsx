import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign, TrendingUp, TrendingDown, Wallet, Plus, Trash2,
  ArrowUpRight, ArrowDownRight, X, ChevronLeft, ChevronRight, Calendar
} from 'lucide-react';
import api from '../../lib/api';

const PLAN_LABELS = { lite: 'Lite', estandar: 'Estándar', pro: 'Pro' };
const CATEGORIAS = ['Railway', 'Supabase', 'Anthropic API', 'Resend', 'WhatsApp/Meta', 'Wompi', 'Dominio', 'Otro'];

function formatCOP(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

function KPICard({ title, value, subtitle, icon: Icon, color = 'violet', delay = 0 }) {
  const colors = {
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };
  return (
    <div className="bg-[#131929] border border-white/10 rounded-2xl p-5 transition-all duration-300 hover:border-violet-500/30 hover:-translate-y-1 hover:shadow-lg hover:shadow-violet-500/10 animate-fade-slide-up" style={{ animationDelay: `${delay}ms` }}>
      <div className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-4 ${colors[color]}`}>
        <Icon size={18} />
      </div>
      <p className="text-2xl font-bold text-white mb-1">{value}</p>
      <p className="text-slate-400 text-sm font-medium">{title}</p>
      {subtitle && <p className="text-slate-500 text-xs mt-1">{subtitle}</p>}
    </div>
  );
}

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function MonthPicker({ value, onChange }) {
  const [year, month] = value.split('-').map(Number);
  const goPrev = () => {
    const d = new Date(year, month - 2, 1);
    onChange(d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7));
  };
  const goNext = () => {
    const d = new Date(year, month, 1);
    onChange(d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7));
  };
  return (
    <div className="flex items-center gap-2 bg-[#0a0a0f] border border-white/10 rounded-xl px-3 py-2">
      <button onClick={goPrev} className="text-slate-400 hover:text-white"><ChevronLeft size={16} /></button>
      <div className="flex items-center gap-1.5 px-2 min-w-[120px] justify-center">
        <Calendar size={14} className="text-violet-400" />
        <span className="text-white text-sm font-medium">{MESES[month-1]} {year}</span>
      </div>
      <button onClick={goNext} className="text-slate-400 hover:text-white"><ChevronRight size={16} /></button>
    </div>
  );
}

export default function CajaAdmin() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('resumen');
  const [trendTab, setTrendTab] = useState('ingresos');
  const [month, setMonth] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0,7));
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [form, setForm] = useState({ category: 'Railway', description: '', amount: '', currency: 'USD', recurring: true, date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-caja', month],
    queryFn: () => api.get(`/api/admin/caja?month=${month}`).then(r => r.data.data),
  });

  const createExpense = useMutation({
    mutationFn: (payload) => api.post('/api/admin/caja/expenses', payload),
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-caja']);
      setShowExpenseModal(false);
      setForm({ category: 'Railway', description: '', amount: '', currency: 'USD', recurring: true, date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) });
    }
  });

  const deleteExpense = useMutation({
    mutationFn: (id) => api.delete(`/api/admin/caja/expenses/${id}`),
    onSuccess: () => queryClient.invalidateQueries(['admin-caja']),
  });

  const updateGoal = useMutation({
    mutationFn: (amount) => api.patch('/api/admin/caja/goal', { amount }),
    onSuccess: () => {
      queryClient.invalidateQueries(['admin-caja']);
      setEditingGoal(false);
    }
  });

  if (isLoading) return (
    <div className="p-6 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-24 bg-[#131929] rounded-2xl animate-pulse" />)}
    </div>
  );

  const d = data || {};

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
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

      {/* Tabs */}
      <div className="flex gap-2 mb-6 bg-[#131929] border border-white/10 rounded-2xl p-1.5 w-fit">
        {[
          { key: 'resumen', label: 'Resumen' },
          { key: 'ingresos', label: 'Ingresos' },
          { key: 'egresos', label: 'Egresos' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab.key ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB: RESUMEN */}
      {activeTab === 'resumen' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <KPICard title="MRR" value={formatCOP(d.mrr || 0)} subtitle={`${d.negocios_activos || 0} negocios activos`} icon={Wallet} color="violet" delay={0} />
            <KPICard title="Ingresos del mes" value={formatCOP(d.ingresos_mes || 0)} subtitle="Pagos aprobados" icon={ArrowUpRight} color="emerald" delay={50} />
            <KPICard title="Egresos del mes" value={formatCOP(d.egresos_mes || 0)} subtitle="Costos operativos" icon={ArrowDownRight} color="red" delay={100} />
            <KPICard
              title="Utilidad del mes"
              value={formatCOP(d.utilidad_mes || 0)}
              subtitle={d.utilidad_mes >= 0 ? '🟢 Positivo' : '🔴 Negativo'}
              icon={d.utilidad_mes >= 0 ? TrendingUp : TrendingDown}
              color={d.utilidad_mes >= 0 ? 'emerald' : 'red'}
              delay={150}
            />
          </div>

          {/* Meta mensual */}
          <div className="bg-[#131929] border border-white/10 rounded-2xl p-5 mb-6 animate-fade-slide-up" style={{ animationDelay: '180ms' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold">Meta mensual</h2>
              {editingGoal ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={goalInput}
                    onChange={e => setGoalInput(e.target.value)}
                    autoFocus
                    className="w-32 px-2 py-1 bg-[#0a0a0f] border border-violet-500/30 rounded-lg text-white text-sm focus:outline-none"
                  />
                  <button onClick={() => updateGoal.mutate(Number(goalInput))} className="text-emerald-400 text-xs font-medium">Guardar</button>
                  <button onClick={() => setEditingGoal(false)} className="text-slate-500 text-xs">Cancelar</button>
                </div>
              ) : (
                <button onClick={() => { setGoalInput(String(d.meta_mensual || 10000000)); setEditingGoal(true); }} className="text-violet-400 text-xs hover:text-violet-300">
                  Editar meta
                </button>
              )}
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-300">{formatCOP(d.ingresos_mes || 0)}</span>
              <span className="text-slate-500">de {formatCOP(d.meta_mensual || 10000000)}</span>
            </div>
            <div className="h-3 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 rounded-full transition-all duration-700"
                style={{ width: `${Math.min(((d.ingresos_mes || 0) / (d.meta_mensual || 10000000)) * 100, 100)}%` }}
              />
            </div>
            <p className="text-slate-500 text-xs mt-2">
              {Math.round(((d.ingresos_mes || 0) / (d.meta_mensual || 10000000)) * 100)}% de la meta ·
              {d.ingresos_mes >= (d.meta_mensual || 10000000) ? ' 🎉 ¡Meta alcanzada!' : ` faltan ${formatCOP((d.meta_mensual || 10000000) - (d.ingresos_mes || 0))}`}
            </p>
          </div>

          {/* Gráfico tendencia */}
          <div className="bg-[#131929] border border-white/10 rounded-2xl p-6 animate-fade-slide-up" style={{ animationDelay: '200ms' }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-semibold">Últimos 6 meses</h2>
              <div className="flex gap-1 bg-white/5 rounded-xl p-1">
                {[
                  { key: 'ingresos', label: 'Ingresos' },
                  { key: 'egresos', label: 'Egresos' },
                  { key: 'utilidad', label: 'Utilidad' },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setTrendTab(tab.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      trendTab === tab.key ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const values = (d.trend || []).map(t => t[trendTab] || 0);
              const maxVal = Math.max(...values.map(Math.abs), 1);
              const barColor = trendTab === 'ingresos' ? 'bg-emerald-500/30 hover:bg-emerald-500/40'
                : trendTab === 'egresos' ? 'bg-red-500/30 hover:bg-red-500/40'
                : 'bg-violet-500/30 hover:bg-violet-500/40';

              return (
                <div className="flex items-end gap-2 h-40">
                  {(d.trend || []).map(t => {
                    const val = t[trendTab] || 0;
                    const isNegative = val < 0;
                    return (
                      <div key={t.month} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                        <div
                          className={`w-full rounded-t-lg transition-all duration-700 relative group ${isNegative ? 'bg-red-500/30 hover:bg-red-500/40' : barColor}`}
                          style={{ height: `${(Math.abs(val) / maxVal) * 100}%`, minHeight: '4px' }}
                        >
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                            {formatCOP(val)}
                          </div>
                        </div>
                        <span className="text-slate-500 text-xs">{t.month.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* TAB: INGRESOS */}
      {activeTab === 'ingresos' && (
        <div className="animate-fade-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold text-lg">Ingresos de {MESES[parseInt(month.split('-')[1])-1]} {month.split('-')[0]}</h2>
            <MonthPicker value={month} onChange={setMonth} />
          </div>

          <div className="bg-[#131929] border border-white/10 rounded-2xl p-5 mb-4">
            <p className="text-slate-400 text-sm mb-1">Total del mes</p>
            <p className="text-3xl font-bold text-emerald-400">{formatCOP(d.ingresos_mes_consultado || 0)}</p>
          </div>

          <div className="bg-[#131929] border border-white/10 rounded-2xl p-5">
            {!d.pagos_mes_consultado?.length ? (
              <p className="text-slate-500 text-sm text-center py-8">Sin pagos este mes</p>
            ) : (
              <div className="space-y-2">
                {d.pagos_mes_consultado.map((p, i) => (
                  <div key={i} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                        <ArrowUpRight size={15} className="text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-slate-200 text-sm font-medium">{p.business_name}</p>
                        <p className="text-slate-500 text-xs">{PLAN_LABELS[p.plan] || p.plan} · {new Date(p.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </div>
                    <p className="text-emerald-400 text-sm font-semibold">{formatCOP(p.amount)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: EGRESOS */}
      {activeTab === 'egresos' && (
        <div className="animate-fade-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold text-lg">Egresos de {MESES[parseInt(month.split('-')[1])-1]} {month.split('-')[0]}</h2>
            <MonthPicker value={month} onChange={setMonth} />
          </div>

          <div className="bg-[#131929] border border-white/10 rounded-2xl p-5 mb-4">
            <p className="text-slate-400 text-sm mb-1">Total del mes</p>
            <p className="text-3xl font-bold text-red-400">{formatCOP(d.egresos_total_mes_consultado || 0)}</p>
            <p className="text-slate-500 text-xs mt-1">Recurrentes mensuales: {formatCOP(d.egresos_recurrentes_mes || 0)}</p>
          </div>

          <div className="bg-[#131929] border border-white/10 rounded-2xl p-5">
            {!d.egresos_mes_consultado?.length ? (
              <p className="text-slate-500 text-sm text-center py-8">Sin egresos este mes</p>
            ) : (
              <div className="space-y-2">
                {d.egresos_mes_consultado.map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                        <ArrowDownRight size={15} className="text-red-400" />
                      </div>
                      <div>
                        <p className="text-slate-200 text-sm font-medium">{e.category}</p>
                        <p className="text-slate-500 text-xs">{e.description || '—'} · {new Date(e.date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-red-400 text-sm font-semibold">{formatCOP(e.amount_cop)}</p>
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
        </div>
      )}

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
