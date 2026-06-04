import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Wallet, Plus, Pencil, Trash2,
  Download, Target, X, ChevronDown, Users, Tag,
} from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import api from '../../lib/api';

registerLocale('es', es);
import { useAuth } from '../../context/AuthContext';
import MonthSelector from '../../components/ui/MonthSelector';

// ── Utilities ──────────────────────────────────────────────

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(v ?? 0);
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

const MONTH_ABBR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const fmtMonthKey = (k) => MONTH_ABBR[parseInt(k.slice(5, 7)) - 1];

const INCOME_CATS = [
  { value: 'servicios', label: 'Servicios' },
  { value: 'productos', label: 'Productos' },
  { value: 'otro',      label: 'Otro' },
];

const EXPENSE_CATS = [
  { value: 'nomina',          label: 'Nómina' },
  { value: 'materias_primas', label: 'Materias primas' },
  { value: 'servicios',       label: 'Servicios' },
  { value: 'arriendo',        label: 'Arriendo' },
  { value: 'otro',            label: 'Otro' },
];

const SOURCE_LABEL = {
  manual:       'Presencial',
  presencial:   'Presencial',
  product_sale: 'Presencial',
  appointment:  'Cita',
  cita:         'Cita',
  whatsapp:     'WhatsApp',
};
const SOURCE_COLOR = {
  manual:       'text-indigo-400 bg-indigo-500/20 border-indigo-500/30',
  presencial:   'text-indigo-400 bg-indigo-500/20 border-indigo-500/30',
  product_sale: 'text-indigo-400 bg-indigo-500/20 border-indigo-500/30',
  appointment:  'text-violet-400 bg-violet-500/20 border-violet-500/30',
  cita:         'text-violet-400 bg-violet-500/20 border-violet-500/30',
  whatsapp:     'text-green-400 bg-green-500/20 border-green-500/30',
};
const SOURCE_COLOR_DEFAULT = 'text-slate-400 bg-slate-500/20 border-slate-500/30';
const fmtSource = (s) => SOURCE_LABEL[s] ?? 'Presencial';

const CAT_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500',
  'bg-yellow-500', 'bg-orange-500',
];

const EXPENSE_ICONS = {
  nomina: '👥',
  materias_primas: '📦',
  servicios: '⚙️',
  arriendo: '🏠',
  otro: '📝',
};


// ── Recharts custom tooltip ────────────────────────────────

function CashTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#131929] border border-slate-700 rounded-lg p-3 text-xs shadow-xl">
      <p className="text-slate-400 mb-2">{fmtMonthKey(label)} {label?.slice(0, 4)}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.fill }} className="font-medium">
          {p.name}: {formatCOP(p.value)}
        </p>
      ))}
    </div>
  );
}

// ── Summary Tab ────────────────────────────────────────────

function SummaryTab({ month, period, onPeriodChange, dayDate, onDayDateChange }) {
  const { business } = useAuth();
  const goalKey = `zita_goal_${business?.id}`;
  const [goal, setGoal] = useState(() => parseInt(localStorage.getItem(goalKey) || '0'));
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');

  const { data: monthData } = useQuery({
    queryKey: ['cash-summary-month', month],
    queryFn: () => api.get(`/api/cash/summary?month=${month}`).then((r) => r.data.data),
  });

  const { data: periodData, isLoading } = useQuery({
    queryKey: ['cash-summary-period', month, period, dayDate],
    queryFn: () => {
      let url = '/api/cash/summary';
      if (period === 'mes') {
        url += `?month=${month}`;
      } else if (period === 'día') {
        url += `?period=day&date=${dayDate.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}`;
      } else {
        url += `?period=week`;
      }
      return api.get(url).then((r) => r.data.data);
    },
  });

  const handleSaveGoal = () => {
    const v = parseInt(goalInput) || 0;
    localStorage.setItem(goalKey, String(v));
    setGoal(v);
    setEditingGoal(false);
  };

  const goalPct = goal > 0 ? Math.min(Math.round(((monthData?.income_total || 0) / goal) * 100), 100) : 0;
  const net = periodData?.net ?? 0;

  const handleExportPdf = async () => {
    try {
      const res = await api.get(`/api/cash/report/monthly?month=${month}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `reporte-${month}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  const handleExportXlsx = async () => {
    try {
      const res = await api.get(`/api/cash/report/excel?month=${month}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `caja-${month}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  };

  if (isLoading) return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-28 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Período selector - móvil: grid-cols-3 completo */}
      <div className="space-y-3 md:flex md:items-center md:gap-3">
        <div className="grid grid-cols-3 gap-2 md:flex md:gap-2 md:bg-[#131929] md:border md:border-slate-800 md:rounded-lg md:p-1">
          {['día', 'semana', 'mes'].map((p) => (
            <button key={p} onClick={() => onPeriodChange(p)}
              className={`px-3 py-2 md:py-1.5 text-sm md:text-xs font-medium rounded transition ${
                period === p
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-400 hover:text-white bg-[#131929]/50 md:bg-transparent md:border md:border-transparent'
              }`}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        {period === 'día' && (
          <DatePicker
            selected={dayDate}
            onChange={onDayDateChange}
            dateFormat="dd/MM/yyyy"
            locale="es"
            placeholderText="Seleccionar fecha"
            className="w-full md:w-auto bg-[#131929] border border-slate-800 text-white rounded-lg px-4 py-2 md:py-1.5 text-sm focus:outline-none focus:border-violet-500 transition"
          />
        )}
      </div>

      {/* Cards - móvil: apiladas, text grande */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
        <div className="min-w-0 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 border border-violet-500/15 hover:border-violet-500/35 transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <p className="whitespace-nowrap text-sm text-slate-400">Ingresos</p>
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <TrendingUp size={15} className="text-white" />
            </div>
          </div>
          <p className="text-lg sm:text-xl font-bold text-white">{formatCOP(periodData?.income_total)}</p>
        </div>
        <div className="min-w-0 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 border border-violet-500/15 hover:border-violet-500/35 transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <p className="whitespace-nowrap text-sm text-slate-400">Egresos</p>
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <TrendingDown size={15} className="text-white" />
            </div>
          </div>
          <p className="text-lg sm:text-xl font-bold text-white">{formatCOP(periodData?.expense_total)}</p>
        </div>
        <div className="min-w-0 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 border border-violet-500/15 hover:border-violet-500/35 transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <p className="whitespace-nowrap text-sm text-slate-400">Ganancia neta</p>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${net >= 0 ? 'bg-emerald-600' : 'bg-red-600'}`}>
              {net >= 0 ? <TrendingUp size={15} className="text-white" /> : <TrendingDown size={15} className="text-white" />}
            </div>
          </div>
          <p className={`text-lg sm:text-xl font-bold ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCOP(net)}</p>
        </div>
      </div>

      {/* Margen / Costo de ventas — solo si hay datos de costo */}
      {(periodData?.costo_ventas > 0 || periodData?.margen_bruto != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
          <div className="min-w-0 bg-[#131929] border border-violet-500/15 hover:border-violet-500/35 rounded-xl shadow-lg shadow-black/30 p-5 transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
              <p className="whitespace-nowrap text-sm text-slate-400">Margen Bruto</p>
              <div className="w-8 h-8 bg-emerald-700 rounded-lg flex items-center justify-center flex-shrink-0">
                <TrendingUp size={15} className="text-white" />
              </div>
            </div>
            <p className={`text-lg sm:text-xl font-bold ${(periodData?.margen_bruto ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCOP(periodData?.margen_bruto)}
            </p>
            <p className="text-slate-600 text-xs mt-1">Ingresos − costo de ventas</p>
          </div>
          <div className="min-w-0 bg-[#131929] border border-violet-500/15 hover:border-violet-500/35 rounded-xl shadow-lg shadow-black/30 p-5 transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
              <p className="whitespace-nowrap text-sm text-slate-400">Costo de Ventas</p>
              <div className="w-8 h-8 bg-orange-700 rounded-lg flex items-center justify-center flex-shrink-0">
                <TrendingDown size={15} className="text-white" />
              </div>
            </div>
            <p className="text-lg sm:text-xl font-bold text-orange-400">{formatCOP(periodData?.costo_ventas)}</p>
            <p className="text-slate-600 text-xs mt-1">Egreso automático por productos vendidos</p>
          </div>
          <div className="min-w-0 bg-[#131929] border border-violet-500/15 hover:border-violet-500/35 rounded-xl shadow-lg shadow-black/30 p-5 transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
              <p className="whitespace-nowrap text-sm text-slate-400">Utilidad Neta</p>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${(periodData?.utilidad_neta ?? 0) >= 0 ? 'bg-emerald-600' : 'bg-red-600'}`}>
                {(periodData?.utilidad_neta ?? 0) >= 0 ? <TrendingUp size={15} className="text-white" /> : <TrendingDown size={15} className="text-white" />}
              </div>
            </div>
            <p className={`text-lg sm:text-xl font-bold ${(periodData?.utilidad_neta ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCOP(periodData?.utilidad_neta)}
            </p>
            <p className="text-slate-600 text-xs mt-1">Margen bruto − egresos operativos</p>
          </div>
        </div>
      )}

      {/* Chart + Goal - móvil: apilados verticalmente */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar chart */}
        <div className="lg:col-span-2 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5">
          <p className="text-white font-semibold text-sm mb-4">Últimos 6 meses</p>
          {monthData?.chart_data?.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthData.chart_data} barGap={4} barCategoryGap="30%">
                <XAxis dataKey="month" tickFormatter={fmtMonthKey}
                  tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={48} />
                <Tooltip content={<CashTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Legend formatter={(v) => <span style={{ color: '#94a3b8', fontSize: 11 }}>{v}</span>} />
                <Bar dataKey="income"   name="Ingresos" fill="#10b981" radius={[4,4,0,0]} />
                <Bar dataKey="expenses" name="Egresos"  fill="#ef4444" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-slate-500 text-sm text-center py-12">Sin datos aún</p>
          )}
        </div>

        {/* Goal */}
        <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target size={15} className="text-violet-400" />
              <p className="text-white font-semibold text-sm">Meta mensual</p>
            </div>
            <button onClick={() => { setGoalInput(String(goal || '')); setEditingGoal(true); }}
              className="text-slate-500 hover:text-white p-1 rounded transition">
              <Pencil size={13} />
            </button>
          </div>

          {editingGoal ? (
            <div className="space-y-2">
              <input type="number" value={goalInput} onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Ej: 3000000" min={0}
                className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500 transition" />
              <div className="flex gap-2">
                <button onClick={handleSaveGoal}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium py-1.5 rounded-lg transition">
                  Guardar
                </button>
                <button onClick={() => setEditingGoal(false)}
                  className="flex-1 bg-slate-700 text-slate-300 text-xs font-medium py-1.5 rounded-lg transition">
                  Cancelar
                </button>
              </div>
            </div>
          ) : goal > 0 ? (
            <>
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-400">{goalPct}% alcanzado</span>
                  <span className={goalPct >= 100 ? 'text-emerald-400 font-medium' : 'text-slate-400'}>{goalPct >= 100 ? '¡Meta!' : formatCOP(goal)}</span>
                </div>
                <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${goalPct >= 100 ? 'bg-emerald-500' : 'bg-violet-500'}`}
                    style={{ width: `${goalPct}%` }} />
                </div>
                <p className="text-slate-500 text-xs mt-1.5">{formatCOP(monthData?.income_total)} de {formatCOP(goal)}</p>
              </div>
            </>
          ) : (
            <p className="text-slate-500 text-sm">Sin meta configurada. Haz clic en <Pencil size={11} className="inline" /> para definirla.</p>
          )}

          {/* Botones exportar - móvil: full width apilados */}
          <div className="mt-auto pt-3 border-t border-slate-800 space-y-2">
            <button onClick={handleExportPdf}
              className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 border border-violet-500/30 text-white text-xs font-medium px-3 py-2 rounded-lg transition">
              <Download size={13} /> Exportar PDF
            </button>
            <button onClick={handleExportXlsx}
              className="flex items-center justify-center gap-2 w-full bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-500/40 text-emerald-400 text-xs font-medium px-3 py-2 rounded-lg transition">
              <Download size={13} /> Exportar Excel
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

// ── Income Tab ─────────────────────────────────────────────

const emptyIncome = { amount: '', category: 'servicios', description: '', custom_category: '', client_id: '', services_detail: '', date: today() };

function IncomeTab({ month, period, onPeriodChange, dayDate, onDayDateChange }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyIncome);
  const [formError, setFormError] = useState('');
  const [clientSearch, setClientSearch] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['cash-income', month, period, dayDate],
    queryFn: () => {
      let url = '/api/cash/income';
      if (period === 'mes') {
        url += `?month=${month}`;
      } else if (period === 'día') {
        url += `?period=day&date=${dayDate.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}`;
      } else {
        url += `?period=week`;
      }
      return api.get(url).then((r) => r.data.data);
    },
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get('/api/clients').then((r) => r.data.data),
  });

  const filteredClients = clients.filter((c) =>
    clientSearch ? c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.phone.includes(clientSearch) : true
  ).slice(0, 6);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cash-income'] });
    qc.invalidateQueries({ queryKey: ['cash-summary'] });
  };

  const createMut = useMutation({
    mutationFn: (body) => api.post('/api/cash/income', body),
    onSuccess: () => { invalidate(); closeModal(); },
    onError: (e) => setFormError(e.response?.data?.error || 'Error al guardar.'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/api/cash/income/${id}`, body),
    onSuccess: () => { invalidate(); closeModal(); },
    onError: (e) => setFormError(e.response?.data?.error || 'Error al guardar.'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/api/cash/income/${id}`),
    onSuccess: invalidate,
  });

  const openCreate = () => { setForm(emptyIncome); setFormError(''); setClientSearch(''); setEditing(null); setModal(true); };
  const openEdit = (r) => {
    setForm({ amount: r.amount, category: r.category, description: r.description || '', custom_category: r.custom_category || '', client_id: r.client_id || '', services_detail: r.services_detail || '', date: r.date });
    setClientSearch(r.clients?.name || '');
    setFormError(''); setEditing(r); setModal(true);
  };
  const closeModal = () => { setModal(false); setEditing(null); };

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.amount || isNaN(form.amount) || Number(form.amount) <= 0) return setFormError('El monto debe ser un número positivo.');
    if (!form.date) return setFormError('La fecha es obligatoria.');
    const body = { ...form, amount: parseFloat(form.amount) };
    if (editing) updateMut.mutate({ id: editing.id, body });
    else createMut.mutate(body);
  };

  const total = rows.filter((r) => r.source !== 'appointment' || true).reduce((s, r) => s + Number(r.amount), 0);
  const manualOnly = rows.filter((r) => r.source !== 'appointment');

  return (
    <div className="space-y-4">
      {/* Período selector - móvil: grid-cols-3 completo */}
      <div className="space-y-3 md:flex md:items-center md:gap-3">
        <div className="grid grid-cols-3 gap-2 md:flex md:gap-2 md:bg-[#131929] md:border md:border-slate-800 md:rounded-lg md:p-1">
          {['día', 'semana', 'mes'].map((p) => (
            <button key={p} onClick={() => onPeriodChange(p)}
              className={`px-3 py-2 md:py-1.5 text-sm md:text-xs font-medium rounded transition ${
                period === p
                  ? 'bg-violet-600 text-white'
                  : 'text-slate-400 hover:text-white bg-[#131929]/50 md:bg-transparent md:border md:border-transparent'
              }`}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        {period === 'día' && (
          <DatePicker
            selected={dayDate}
            onChange={onDayDateChange}
            dateFormat="dd/MM/yyyy"
            locale="es"
            placeholderText="Seleccionar fecha"
            className="bg-[#131929] border border-slate-800 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-violet-500 transition"
          />
        )}
      </div>

      {/* Botones móvil y desktop */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <button onClick={openCreate}
          className="md:hidden w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition">
          <Plus size={15} /> Agregar ingreso
        </button>
        <p className="hidden md:block text-slate-400 text-sm">{rows.length} registros · Total: <span className="text-emerald-400 font-medium">{formatCOP(total)}</span></p>
        <button onClick={openCreate}
          className="hidden md:flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          <Plus size={15} /> Agregar ingreso
        </button>
      </div>

      {/* Total destacado - móvil primero */}
      <div className="md:flex md:items-center md:justify-between">
        <div className="block md:hidden bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-4 mb-4">
          <p className="text-slate-400 text-xs mb-1">Total del período</p>
          <p className="text-emerald-400 text-2xl font-bold">{formatCOP(total)}</p>
          <p className="text-slate-500 text-xs mt-1">{rows.length} registros</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3 md:space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 md:h-12 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <TrendingUp size={36} className="mx-auto mb-2 opacity-30" />
          <p>Sin ingresos para este período</p>
        </div>
      ) : (
        <>
          {/* Cards móvil - block md:hidden */}
          <div className="space-y-3 block md:hidden">
            {rows.map((r) => (
              <div key={`${r.source}-${r.id}`} className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-4">
                <div className="flex items-start justify-between mb-3">
                  <p className="text-slate-500 text-xs">{new Date(r.date + 'T12:00:00').toLocaleDateString('es-CO')}</p>
                  {r.source === 'manual' && (
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-white p-1 rounded transition"><Pencil size={12} /></button>
                      <button onClick={() => { if (window.confirm('¿Eliminar ingreso?')) deleteMut.mutate(r.id); }}
                        className="text-slate-500 hover:text-red-400 p-1 rounded transition"><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>
                <p className="text-white font-semibold mb-1">{r.custom_category || r.description || r.category}</p>
                <div className="flex items-end justify-between">
                  <div className="space-y-2">
                    {r.clients?.name && (
                      <div className="flex items-center gap-1 text-slate-400 text-xs">
                        <Users size={12} />
                        <span>{r.clients.name}</span>
                      </div>
                    )}
                    <span className={`text-xs font-medium border px-2 py-0.5 rounded-full inline-block ${SOURCE_COLOR[r.source] || SOURCE_COLOR_DEFAULT}`}>
                      {fmtSource(r.source)}
                    </span>
                  </div>
                  <p className="text-emerald-400 text-lg font-bold">{formatCOP(r.amount)}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Tabla desktop - hidden md:block */}
          <div className="hidden md:block overflow-x-auto">
            <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
              <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-800">
                {['Fecha','Descripción','Cliente','Fuente','Monto',''].map((h) => (
                  <th key={h} className="text-left text-slate-500 font-medium px-4 py-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.source}-${r.id}`} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {new Date(r.date + 'T12:00:00').toLocaleDateString('es-CO')}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {r.custom_category || r.description || r.category}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{r.clients?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium border px-2 py-0.5 rounded-full ${SOURCE_COLOR[r.source] || SOURCE_COLOR_DEFAULT}`}>
                        {fmtSource(r.source)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-emerald-400 font-medium whitespace-nowrap">{formatCOP(r.amount)}</td>
                    <td className="px-4 py-3">
                      {r.source === 'manual' && (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition"><Pencil size={13} /></button>
                          <button onClick={() => { if (window.confirm('¿Eliminar ingreso?')) deleteMut.mutate(r.id); }}
                            className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-slate-700">
                <td colSpan={4} className="px-4 py-3 text-slate-400 text-sm font-medium">Total del período</td>
                <td className="px-4 py-3 text-emerald-400 font-bold">{formatCOP(total)}</td>
                <td />
              </tr></tfoot>
              </table>
            </div>
          </div>
        </>
      )}


      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl border border-violet-500/25 shadow-2xl shadow-black/50 max-h-[90vh] overflow-y-auto">
            <h3 className="text-white font-semibold text-lg mb-5">{editing ? 'Editar ingreso' : 'Nuevo ingreso'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{formError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">Monto (COP) *</label>
                  <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="50000" min={1}
                    className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all duration-150" />
                </div>
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">Fecha *</label>
                  <DatePicker
                    selected={form.date ? new Date(form.date) : null}
                    onChange={(d) => setForm({ ...form, date: d.toISOString().slice(0, 10) })}
                    dateFormat="dd/MM/yyyy"
                    locale="es"
                    placeholderText="Seleccionar"
                    className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1.5">Categoría *</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full bg-[#0f172a] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition [&>option]:bg-[#0f172a] [&>option]:text-white">
                  {INCOME_CATS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              {form.category === 'otro' && (
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">Nombre del ingreso *</label>
                  <input type="text" value={form.custom_category} onChange={(e) => setForm({ ...form, custom_category: e.target.value })}
                    placeholder="Ej: Venta de producto especial"
                    className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all duration-150" />
                </div>
              )}
              <div>
                <label className="block text-slate-400 text-sm mb-1.5">Descripción (opcional)</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Detalles adicionales..."
                  className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition" />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1.5">Cliente (opcional)</label>
                <div className="relative">
                  <input type="text" value={clientSearch} onChange={(e) => { setClientSearch(e.target.value); setForm({ ...form, client_id: '' }); }}
                    placeholder="Buscar cliente..."
                    className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all duration-150" />
                  {clientSearch && !form.client_id && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-[#131929] border border-slate-700 rounded-lg overflow-hidden z-10 max-h-36 overflow-y-auto shadow-xl">
                      {filteredClients.length === 0
                        ? <p className="text-slate-500 text-xs px-3 py-2">Sin resultados</p>
                        : filteredClients.map((c) => (
                          <button key={c.id} type="button"
                            onClick={() => { setForm({ ...form, client_id: c.id }); setClientSearch(`${c.name} — ${c.phone}`); }}
                            className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition">
                            {c.name} <span className="text-slate-500 text-xs">{c.phone}</span>
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
              </div>
              {form.client_id && (
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">Servicios realizados (opcional)</label>
                  <input type="text" value={form.services_detail} onChange={(e) => setForm({ ...form, services_detail: e.target.value })}
                    placeholder="Ej: Corte + tinte raíz"
                    className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all duration-150" />
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeModal} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition hover:bg-white/10 hover:text-white transition-colors duration-150">Cancelar</button>
                <button type="submit" disabled={createMut.isPending || updateMut.isPending}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
                  {createMut.isPending || updateMut.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Expenses Tab ───────────────────────────────────────────

const emptyExpense = { amount: '', category: 'otro', description: '', date: today() };

function ExpensesTab({ month, period, onPeriodChange, dayDate, onDayDateChange }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyExpense);
  const [formError, setFormError] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['cash-expenses', month, period, dayDate],
    queryFn: () => {
      let url = '/api/cash/expenses';
      if (period === 'mes') {
        url += `?month=${month}`;
      } else if (period === 'día') {
        url += `?period=day&date=${dayDate.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}`;
      } else {
        url += `?period=week`;
      }
      return api.get(url).then((r) => r.data.data);
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cash-expenses'] });
    qc.invalidateQueries({ queryKey: ['cash-summary'] });
  };

  const createMut = useMutation({
    mutationFn: (body) => api.post('/api/cash/expenses', body),
    onSuccess: () => { invalidate(); closeModal(); },
    onError: (e) => setFormError(e.response?.data?.error || 'Error al guardar.'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => api.put(`/api/cash/expenses/${id}`, body),
    onSuccess: () => { invalidate(); closeModal(); },
    onError: (e) => setFormError(e.response?.data?.error || 'Error al guardar.'),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/api/cash/expenses/${id}`),
    onSuccess: invalidate,
  });

  const openCreate = () => { setForm(emptyExpense); setFormError(''); setEditing(null); setModal(true); };
  const openEdit = (r) => { setForm({ amount: r.amount, category: r.category, description: r.description || '', date: r.date }); setFormError(''); setEditing(r); setModal(true); };
  const closeModal = () => { setModal(false); setEditing(null); };

  const handleSubmit = (e) => {
    e.preventDefault(); setFormError('');
    if (!form.amount || isNaN(form.amount) || Number(form.amount) <= 0) return setFormError('El monto debe ser un número positivo.');
    if (!form.date) return setFormError('La fecha es obligatoria.');
    const body = { ...form, amount: parseFloat(form.amount) };
    if (editing) updateMut.mutate({ id: editing.id, body });
    else createMut.mutate(body);
  };

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const byCategory = EXPENSE_CATS.map(({ value, label }, idx) => {
    const sub = rows.filter((r) => r.category === value).reduce((s, r) => s + Number(r.amount), 0);
    return { value, label, sub, pct: total > 0 ? Math.round((sub / total) * 100) : 0, color: CAT_COLORS[idx] };
  }).filter((c) => c.sub > 0);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="flex-1 min-w-0 space-y-4">
        {/* Período selector - móvil: grid-cols-3 completo */}
        <div className="space-y-3 md:flex md:items-center md:gap-3">
          <div className="grid grid-cols-3 gap-2 md:flex md:gap-2 md:bg-[#131929] md:border md:border-slate-800 md:rounded-lg md:p-1">
            {['día', 'semana', 'mes'].map((p) => (
              <button key={p} onClick={() => onPeriodChange(p)}
                className={`px-3 py-2 md:py-1.5 text-sm md:text-xs font-medium rounded transition ${
                  period === p
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-white bg-[#131929]/50 md:bg-transparent md:border md:border-transparent'
                }`}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          {period === 'día' && (
            <DatePicker
              selected={dayDate}
              onChange={onDayDateChange}
              dateFormat="dd/MM/yyyy"
              locale="es"
              placeholderText="Seleccionar fecha"
              className="bg-[#131929] border border-slate-800 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-violet-500 transition"
            />
          )}
        </div>

        {/* Botones móvil y desktop */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <button onClick={openCreate}
            className="lg:hidden w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition">
            <Plus size={15} /> Agregar egreso
          </button>
          <p className="hidden md:block text-slate-400 text-sm">{rows.length} registros · Total: <span className="text-red-400 font-medium">{formatCOP(total)}</span></p>
          <button onClick={openCreate}
            className="hidden md:flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
            <Plus size={15} /> Agregar egreso
          </button>
        </div>

        {/* Total destacado - móvil primero */}
        <div className="md:flex md:items-center md:justify-between">
          <div className="block md:hidden bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-4 mb-4">
            <p className="text-slate-400 text-xs mb-1">Total del período</p>
            <p className="text-red-400 text-2xl font-bold">{formatCOP(total)}</p>
            <p className="text-slate-500 text-xs mt-1">{rows.length} registros</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3 md:space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 md:h-12 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <TrendingDown size={36} className="mx-auto mb-2 opacity-30" />
            <p>Sin egresos para este período</p>
          </div>
        ) : (
          <>
            {/* Cards móvil - block md:hidden */}
            <div className="space-y-3 block md:hidden">
              {rows.map((r) => (
                <div key={r.id} className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-slate-500 text-xs">{new Date(r.date + 'T12:00:00').toLocaleDateString('es-CO')}</p>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-white p-1 rounded transition"><Pencil size={12} /></button>
                      <button onClick={() => { if (window.confirm('¿Eliminar egreso?')) deleteMut.mutate(r.id); }}
                        className="text-slate-500 hover:text-red-400 p-1 rounded transition"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-xl">{EXPENSE_ICONS[r.category] || EXPENSE_ICONS.otro}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-400 text-xs">{EXPENSE_CATS.find((c) => c.value === r.category)?.label || r.category}</p>
                      <p className="text-white text-sm font-medium truncate">{r.description || <span className="text-slate-500">—</span>}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-red-400 text-lg font-bold">{formatCOP(r.amount)}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Tabla desktop - hidden md:block */}
            <div className="hidden md:block overflow-x-auto">
              <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
                <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-800">
                  {['Fecha','Categoría','Descripción','Monto',''].map((h) => (
                    <th key={h} className="text-left text-slate-500 font-medium px-4 py-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        {new Date(r.date + 'T12:00:00').toLocaleDateString('es-CO')}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{EXPENSE_CATS.find((c) => c.value === r.category)?.label || r.category}</td>
                      <td className="px-4 py-3 text-slate-400">{r.description || <span className="text-slate-600">—</span>}</td>
                      <td className="px-4 py-3 text-red-400 font-medium whitespace-nowrap">{formatCOP(r.amount)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => openEdit(r)} className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition"><Pencil size={13} /></button>
                          <button onClick={() => { if (window.confirm('¿Eliminar egreso?')) deleteMut.mutate(r.id); }}
                            className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-slate-700">
                  <td colSpan={3} className="px-4 py-3 text-slate-400 text-sm font-medium">Total del período</td>
                  <td className="px-4 py-3 text-red-400 font-bold">{formatCOP(total)}</td>
                  <td />
                </tr></tfoot>
              </table>
              </div>
            </div>
          </>
        )}

      </div>

      {/* Breakdown - móvil: aparece debajo, desktop: sidebar */}
      {byCategory.length > 0 && (
        <div className="w-full lg:w-60 flex-shrink-0">
          <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 lg:sticky lg:top-8">
            <p className="text-white font-semibold text-sm mb-4">Por categoría</p>
            <div className="space-y-3">
              {byCategory.map(({ label, sub, pct, color }) => (
                <div key={label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-slate-300 font-medium">{pct}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-1">
                    <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-slate-500 text-xs">{formatCOP(sub)}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-slate-800 flex justify-between text-sm">
              <span className="text-slate-400">Total</span>
              <span className="text-red-400 font-bold">{formatCOP(total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="zita-modal w-full max-w-md p-6">
            <h3 className="text-white font-semibold text-lg mb-5">{editing ? 'Editar egreso' : 'Nuevo egreso'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{formError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">Monto (COP) *</label>
                  <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="50000" min={1}
                    className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all duration-150" />
                </div>
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">Fecha *</label>
                  <DatePicker
                    selected={form.date ? new Date(form.date) : null}
                    onChange={(d) => setForm({ ...form, date: d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) })}
                    dateFormat="dd/MM/yyyy"
                    locale="es"
                    placeholderText="Seleccionar"
                    className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1.5">Categoría *</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full bg-[#0f172a] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition [&>option]:bg-[#0f172a] [&>option]:text-white">
                  {EXPENSE_CATS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1.5">Descripción (opcional)</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Ej: Pago semana 1"
                  className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeModal} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition hover:bg-white/10 hover:text-white transition-colors duration-150">Cancelar</button>
                <button type="submit" disabled={createMut.isPending || updateMut.isPending}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
                  {createMut.isPending || updateMut.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────

const TABS = [
  { id: 'summary',  label: 'Resumen' },
  { id: 'income',   label: 'Ingresos' },
  { id: 'expenses', label: 'Egresos' },
];

export default function Cash() {
  const [tab, setTab] = useState('summary');
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7));
  const [period, setPeriod] = useState('mes');
  const [dayDate, setDayDate] = useState(new Date());
  const { business } = useAuth();
  const goalKey = `zita_goal_${business?.id}`;
  const [goal, setGoal] = useState(() => parseInt(localStorage.getItem(goalKey) || '0'));
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');

  const { data: sub, isLoading: subLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get('/api/subscription').then(r => r.data.data),
    staleTime: 5 * 60 * 1000
  });

  const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const { data: dayData } = useQuery({
    queryKey: ['cash-summary-day', todayDate],
    queryFn: () => api.get(`/api/cash/summary?period=day&date=${todayDate}`).then((r) => r.data.data),
  });

  const { data: monthData } = useQuery({
    queryKey: ['cash-summary-month', month],
    queryFn: () => api.get(`/api/cash/summary?month=${month}`).then((r) => r.data.data),
  });

  const { data: overview } = useQuery({
    queryKey: ['metrics-overview'],
    queryFn: () => api.get('/api/metrics/overview').then((r) => r.data.data),
  });

  const plan = sub?.plan || 'estandar';

  if (subLoading) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-8 w-48 bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-32 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />
        <div className="h-64 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  const handleSaveGoal = () => {
    const v = parseInt(goalInput) || 0;
    localStorage.setItem(goalKey, String(v));
    setGoal(v);
    setEditingGoal(false);
  };

  const rawPct = goal > 0 ? ((monthData?.income_total || 0) / goal) * 100 : 0;
  const goalPct = rawPct >= 100
    ? 100
    : Math.min(Math.floor(rawPct), 99);
  const citasMes = overview?.completed_appointments ?? overview?.total_appointments ?? 0;
  const promedioPorCita = citasMes > 0 ? (monthData?.income_total || 0) / citasMes : 0;

  if (plan === 'lite') {
    const ingresoHoy = dayData?.income_total ?? 0;
    const ingresoMes = monthData?.income_total ?? 0;

    return (
      <div className="p-4 sm:p-8">
        <div className="page-header border-b border-white/6 pb-4 mb-6">
          <h1 className="text-white text-2xl font-bold">Caja</h1>
          <p className="text-slate-400 text-sm mt-1">Tu control financiero</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Ingresos hoy */}
          <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 border border-violet-500/15 hover:border-violet-500/35 transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
              <p className="text-slate-400 text-sm">Ingresos de hoy</p>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${ingresoHoy >= 0 ? 'bg-emerald-600' : 'bg-red-600'}`}>
                {ingresoHoy >= 0 ? <TrendingUp size={15} className="text-white" /> : <TrendingDown size={15} className="text-white" />}
              </div>
            </div>
            <p className={`text-2xl font-bold ${ingresoHoy >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCOP(ingresoHoy)}</p>
          </div>

          {/* Ingresos del mes */}
          <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 border border-violet-500/15 hover:border-violet-500/35 transition-all duration-200">
            <div className="flex items-center justify-between mb-3">
              <p className="text-slate-400 text-sm">Ingresos del mes</p>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${ingresoMes >= 0 ? 'bg-emerald-600' : 'bg-red-600'}`}>
                {ingresoMes >= 0 ? <TrendingUp size={15} className="text-white" /> : <TrendingDown size={15} className="text-white" />}
              </div>
            </div>
            <p className={`text-2xl font-bold ${ingresoMes >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCOP(ingresoMes)}</p>
          </div>
        </div>

        {/* Meta mensual - Full width */}
        <div className="w-full bg-[#131929] border border-slate-800 rounded-xl p-6">
          {editingGoal ? (
            <div className="space-y-4">
              <input type="number" value={goalInput} onChange={(e) => setGoalInput(e.target.value)}
                placeholder="Ej: 3000000" min={0}
                className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500 transition" />
              <div className="flex gap-2">
                <button onClick={handleSaveGoal}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium py-2 rounded-lg transition">
                  Guardar
                </button>
                <button onClick={() => setEditingGoal(false)}
                  className="flex-1 bg-slate-700 text-slate-300 text-sm font-medium py-2 rounded-lg transition">
                  Cancelar
                </button>
              </div>
            </div>
          ) : goal > 0 ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-white font-semibold text-lg">Meta mensual</h3>
                  <p className="text-slate-400 text-sm">{formatCOP(monthData?.income_total || 0)} de {formatCOP(goal)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-black text-violet-400">{goalPct}%</span>
                  <button onClick={() => { setGoalInput(String(goal || '')); setEditingGoal(true); }}
                    className="text-slate-500 hover:text-white p-2 rounded transition">
                    <Pencil size={16} />
                  </button>
                </div>
              </div>

              <div className="w-full bg-slate-700 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-violet-600 to-violet-400 h-4 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(goalPct, 100)}%` }}
                />
              </div>

              {goalPct >= 100 && (
                <p className="text-emerald-400 text-sm font-medium mt-3">
                  🎉 ¡Meta cumplida este mes!
                </p>
              )}
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-400 text-sm mb-3">Sin meta configurada</p>
              <button onClick={() => { setGoalInput(''); setEditingGoal(true); }}
                className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                <Pencil size={14} />
                Definir meta
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="page-header border-b border-white/6 pb-4 mb-6">
        <div>
          <h1 className="text-white text-2xl font-bold">Caja</h1>
          <p className="text-slate-400 text-sm mt-1">Control de ingresos y egresos</p>
        </div>
        {period === 'mes' && (
          <div className="mt-4 flex gap-2">
            <MonthSelector value={month} onChange={setMonth} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800 mb-6">
        {TABS.map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px ${
              tab === id ? 'border-violet-500 text-white' : 'border-transparent text-slate-400 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary'  && <SummaryTab  month={month} period={period} onPeriodChange={setPeriod} dayDate={dayDate} onDayDateChange={setDayDate} />}
      {tab === 'income'   && <IncomeTab   month={month} period={period} onPeriodChange={setPeriod} dayDate={dayDate} onDayDateChange={setDayDate} />}
      {tab === 'expenses' && <ExpensesTab month={month} period={period} onPeriodChange={setPeriod} dayDate={dayDate} onDayDateChange={setDayDate} />}
    </div>
  );
}
