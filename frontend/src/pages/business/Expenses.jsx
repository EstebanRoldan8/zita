import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, TrendingDown } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import es from 'date-fns/locale/es';
import 'react-datepicker/dist/react-datepicker.css';
import api from '../../lib/api';
import MonthSelector from '../../components/ui/MonthSelector';

registerLocale('es', es);

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function currentMonth() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7);
}

function dateStringToDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-');
  return new Date(y, m - 1, d);
}

const CATEGORIES = [
  { value: 'nomina',          label: 'Nómina' },
  { value: 'materias_primas', label: 'Materias primas' },
  { value: 'servicios',       label: 'Servicios' },
  { value: 'arriendo',        label: 'Arriendo' },
  { value: 'otro',            label: 'Otro' },
];

const CAT_COLOR = {
  nomina:          'text-blue-400 bg-blue-500/10 border-blue-500/20',
  materias_primas: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  servicios:       'text-violet-400 bg-violet-500/10 border-violet-500/20',
  arriendo:        'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  otro:            'text-slate-400 bg-slate-500/10 border-slate-500/20',
};

const emptyForm = { amount: '', category: 'otro', description: '', date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) };

export default function Expenses() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(currentMonth());
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', month],
    queryFn: () => api.get(`/api/expenses?month=${month}`).then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: (body) => api.post('/api/expenses', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['expenses-month'] }); closeModal(); },
    onError: (err) => setFormError(err.response?.data?.error || 'Error al guardar.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }) => api.put(`/api/expenses/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['expenses-month'] }); closeModal(); },
    onError: (err) => setFormError(err.response?.data?.error || 'Error al guardar.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/api/expenses/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['expenses-month'] }); },
  });

  const openCreate = () => { setForm(emptyForm); setFormError(''); setEditing(null); setModal(true); };
  const openEdit = (exp) => {
    setForm({ amount: exp.amount, category: exp.category, description: exp.description || '', date: exp.date });
    setEditing(exp); setFormError(''); setModal(true);
  };
  const closeModal = () => { setModal(false); setEditing(null); };

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.amount || isNaN(form.amount) || Number(form.amount) <= 0) return setFormError('El monto debe ser un número positivo.');
    if (!form.date) return setFormError('La fecha es obligatoria.');
    const body = { amount: parseFloat(form.amount), category: form.category, description: form.description, date: form.date };
    if (editing) updateMutation.mutate({ id: editing.id, body });
    else createMutation.mutate(body);
  };

  const handleDelete = (exp) => {
    if (!window.confirm(`¿Eliminar egreso de ${formatCOP(exp.amount)}?`)) return;
    deleteMutation.mutate(exp.id);
  };

  // Totales y breakdown
  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const byCategory = CATEGORIES.map(({ value, label }) => {
    const subtotal = expenses.filter((e) => e.category === value).reduce((s, e) => s + Number(e.amount), 0);
    return { value, label, subtotal, pct: total > 0 ? Math.round((subtotal / total) * 100) : 0 };
  }).filter((c) => c.subtotal > 0);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Egresos</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Total: {formatCOP(total)}</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center justify-center sm:justify-start gap-2 w-full sm:w-auto bg-violet-600 hover:bg-violet-500 text-white text-xs sm:text-sm font-medium px-4 py-2 rounded-lg transition whitespace-nowrap">
          <Plus size={16} /> Nuevo egreso
        </button>
      </div>

      {/* Filtro de mes */}
      <div className="mb-6">
        <MonthSelector value={month} onChange={setMonth} />
      </div>

      <div className="flex gap-6">
        {/* Tabla */}
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-14 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <TrendingDown size={40} className="mx-auto mb-3 opacity-30" />
              <p>Sin egresos registrados este mes</p>
            </div>
          ) : (
            <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    {['Fecha', 'Categoría', 'Descripción', 'Monto', ''].map((h) => (
                      <th key={h} className="text-left text-slate-500 font-medium px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp) => (
                    <tr key={exp.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                        {new Date(exp.date + 'T12:00:00').toLocaleDateString('es-CO')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium border px-2.5 py-0.5 rounded-full ${CAT_COLOR[exp.category] || CAT_COLOR.otro}`}>
                          {CATEGORIES.find((c) => c.value === exp.category)?.label || exp.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{exp.description || <span className="text-slate-600">—</span>}</td>
                      <td className="px-4 py-3 text-red-400 font-medium whitespace-nowrap">{formatCOP(exp.amount)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => openEdit(exp)}
                            className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => handleDelete(exp)} disabled={deleteMutation.isPending}
                            className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700">
                    <td colSpan={3} className="px-4 py-3 text-slate-400 text-sm font-medium">Total del mes</td>
                    <td className="px-4 py-3 text-red-400 font-bold">{formatCOP(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Breakdown por categoría */}
        {byCategory.length > 0 && (
          <div className="w-64 flex-shrink-0">
            <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 sticky top-8">
              <h3 className="text-white font-semibold text-sm mb-4">Por categoría</h3>
              <div className="space-y-3">
                {byCategory.map(({ value, label, subtotal, pct }) => (
                  <div key={value}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">{label}</span>
                      <span className="text-slate-300 font-medium">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-1">
                      <div
                        className="h-full bg-violet-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-slate-500 text-xs">{formatCOP(subtotal)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-800">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Total</span>
                  <span className="text-red-400 font-bold">{formatCOP(total)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      {modal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl">
            <h3 className="text-white font-semibold text-lg mb-5">{editing ? 'Editar egreso' : 'Nuevo egreso'}</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{formError}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">Monto (COP) *</label>
                  <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="50000" min={1}
                    className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition" />
                </div>
                <div>
                  <label className="block text-slate-400 text-sm mb-1.5">Fecha *</label>
                  <DatePicker
                    selected={form.date ? dateStringToDate(form.date) : null}
                    onChange={(d) => setForm({ ...form, date: d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }) })}
                    dateFormat="dd/MM/yyyy"
                    locale="es"
                    placeholderText="Seleccionar"
                    className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1.5">Categoría *</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500 transition">
                  {CATEGORIES.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1.5">Descripción (opcional)</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Ej: Pago nómina semana 1"
                  className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeModal}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition">
                  Cancelar
                </button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition">
                  {createMutation.isPending || updateMutation.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
