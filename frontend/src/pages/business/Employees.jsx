import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, UserX, Pencil, Users, BarChart2, TrendingUp, UserCheck, Trash2 } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import api from '../../lib/api';
import MonthSelector from '../../components/ui/MonthSelector';

registerLocale('es', es);

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl border border-violet-500/25 shadow-2xl shadow-black/50">
        <h3 className="text-white font-semibold text-lg mb-5">{title}</h3>
        {children}
      </div>
    </div>
  );
}

const emptyForm = { name: '', email: '', phone: '', commission_percent: 0 };

// ─── PESTAÑA EQUIPO ───────────────────────────────────────────────────────────
function TeamTab({ triggerAdd, onTriggerReset, showInactive, onShowInactiveChange }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [limitError, setLimitError] = useState(null);

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees', showInactive],
    queryFn: () => api.get(`/api/employees?includeInactive=${showInactive}`).then((r) => r.data.data),
  });

  const createMutation = useMutation({
    mutationFn: (body) => api.post('/api/employees', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); closeModal(); },
    onError: (err) => {
      if (err.response?.data?.code === 'EMPLOYEES_LIMIT_REACHED') {
        setLimitError(err.response.data.error);
        closeModal();
      } else {
        setFormError(err.response?.data?.error || 'Error al guardar.');
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }) => api.put(`/api/employees/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); closeModal(); },
    onError: (err) => setFormError(err.response?.data?.error || 'Error al guardar.'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id) => api.put(`/api/employees/${id}`, { is_active: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id) => api.put(`/api/employees/${id}`, { is_active: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/api/employees/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setDeleteConfirm(null); },
  });

  const openCreate = () => { setForm(emptyForm); setFormError(''); setModal('create'); };

  useEffect(() => {
    if (triggerAdd) { openCreate(); onTriggerReset(); }
  }, [triggerAdd]);
  const openEdit = (emp) => {
    setEditing(emp);
    setForm({ name: emp.name, email: emp.email || '', phone: emp.phone || '', commission_percent: emp.commission_percent || 0 });
    setFormError('');
    setModal('edit');
  };
  const closeModal = () => { setModal(null); setEditing(null); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError('El nombre es obligatorio.');
    if (modal === 'create') createMutation.mutate(form);
    else updateMutation.mutate({ id: editing.id, body: form });
  };

  const active   = employees.filter((e) => e.is_active);
  const inactive = employees.filter((e) => !e.is_active);

  return (
    <div>
      {/* Toggle mostrar inactivos */}
      <div className="mb-5 flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => onShowInactiveChange(e.target.checked)}
            className="w-4 h-4 rounded bg-[#131929] border border-slate-700 cursor-pointer accent-violet-600"
          />
          <span className="text-slate-400 text-sm">Mostrar empleados inactivos</span>
        </label>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {active.map((emp) => {
            const initial = emp.name?.[0]?.toUpperCase() || '?';
            const avatarColors = {
              'A': 'bg-violet-600/30 text-violet-300',
              'C': 'bg-indigo-600/30 text-indigo-300',
              'M': 'bg-blue-600/30 text-blue-300',
            };
            const avatarClass = avatarColors[initial] || 'bg-slate-600/30 text-slate-300';
            return (
              <div key={emp.id} className="bg-[#131929] border border-violet-500/15 hover:border-violet-500/35 hover:bg-[#1a2235] transition-all duration-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold flex-shrink-0 ${avatarClass}`}>
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-white font-medium text-sm truncate">{emp.name}</p>
                    <p className="text-slate-500 text-xs truncate max-w-[180px]">{emp.email || emp.phone || 'Sin contacto'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:flex-shrink-0">
                  {emp.commission_percent > 0 && (
                    <span className="bg-violet-500/10 text-violet-400 border border-violet-500/20 text-xs px-2 py-0.5 rounded-full flex-shrink-0">
                      {emp.commission_percent}% comisión
                    </span>
                  )}
                  <button onClick={() => openEdit(emp)} className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-700/50 transition flex-shrink-0">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => deactivateMutation.mutate(emp.id)} className="text-slate-400 hover:text-red-400 p-2 rounded-lg hover:bg-red-500/10 transition flex-shrink-0">
                    <UserX size={15} />
                  </button>
                </div>
              </div>
            );
          })}

          {showInactive && inactive.length > 0 && (
            <div className="bg-[#0d1420] rounded-xl p-4 mt-4">
              <p className="text-xs text-white/30 uppercase tracking-widest mb-3">Inactivos</p>
              {inactive.map((emp) => (
                <div key={emp.id} className="bg-[#131929]/50 border border-slate-800/50 rounded-xl px-5 py-4 opacity-60 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-slate-400 font-medium">{emp.name}</p>
                      <span className="text-xs text-slate-500 bg-slate-700/50 border border-slate-600 px-2 py-0.5 rounded-full">Inactivo</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => reactivateMutation.mutate(emp.id)}
                      disabled={reactivateMutation.isPending}
                      className="text-slate-400 hover:text-emerald-400 p-2 rounded-lg hover:bg-emerald-500/10 transition disabled:opacity-50"
                    >
                      <UserCheck size={15} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(emp)}
                      className="text-slate-400 hover:text-red-400 p-2 rounded-lg hover:bg-red-500/10 transition"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {active.length === 0 && !isLoading && (
            <div className="text-center py-16 text-slate-500">
              <UserPlus size={40} className="mx-auto mb-3 opacity-30" />
              <p>Aún no tienes empleados registrados</p>
            </div>
          )}
        </div>
      )}

      {modal && (
        <Modal title={modal === 'create' ? 'Nuevo empleado' : 'Editar empleado'} onClose={closeModal}>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{formError}</p>
            )}
            {[
              { name: 'name',               label: 'Nombre *',    placeholder: 'Juan Pérez',     type: 'text' },
              { name: 'email',              label: 'Email',        placeholder: 'juan@email.com', type: 'email' },
              { name: 'phone',              label: 'Teléfono',     placeholder: '3001234567',     type: 'text' },
              { name: 'commission_percent', label: 'Comisión (%)', placeholder: '0',              type: 'number' },
            ].map(({ name, label, placeholder, type }) => (
              <div key={name}>
                <label className="block text-slate-400 text-sm mb-1.5">{label}</label>
                <input
                  type={type}
                  value={form[name]}
                  onChange={(e) => setForm({ ...form, [name]: e.target.value })}
                  placeholder={placeholder}
                  min={type === 'number' ? 0 : undefined}
                  max={type === 'number' ? 100 : undefined}
                  className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-4 py-2.5 text-sm placeholder-slate-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all duration-150"
                />
              </div>
            ))}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={closeModal} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition hover:bg-white/10 hover:text-white transition-colors duration-150">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition"
              >
                {createMutation.isPending || updateMutation.isPending ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteConfirm && (
        <Modal title="Eliminar empleado" onClose={() => setDeleteConfirm(null)}>
          <p className="text-slate-300 text-sm mb-6">
            ¿Estás seguro que deseas eliminar a <span className="font-semibold">{deleteConfirm.name}</span>? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setDeleteConfirm(null)}
              disabled={deleteMutation.isPending}
              className="flex-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm font-medium py-2.5 rounded-lg transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => deleteMutation.mutate(deleteConfirm.id)}
              disabled={deleteMutation.isPending}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition"
            >
              {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}

      {limitError && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-xl">
            <h3 className="text-white font-semibold text-lg mb-3">Límite alcanzado</h3>
            <p className="text-slate-400 text-sm mb-6">{limitError}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setLimitError(null)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg text-sm font-medium transition"
              >
                Cerrar
              </button>
              <a
                href="/dashboard/suscripcion"
                className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-2.5 rounded-lg text-sm font-medium transition text-center"
              >
                Ver planes
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PESTAÑA RENDIMIENTO ──────────────────────────────────────────────────────
function PerformanceTab() {
  const defaultMonth = new Date().toISOString().slice(0, 7);
  const defaultDate = new Date().toISOString().slice(0, 10);
  const [viewType, setViewType] = useState('day');
  const [month, setMonth] = useState(defaultMonth);
  const [date, setDate] = useState(defaultDate);

  const queryParam = viewType === 'day' ? `date=${date}` : `month=${month}`;

  const { data: metrics = [], isLoading } = useQuery({
    queryKey: ['metrics-employees', viewType, viewType === 'day' ? date : month],
    queryFn: () => api.get(`/api/metrics/employees?${queryParam}`).then((r) => r.data.data),
  });

  const label = viewType === 'day'
    ? new Date(date).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
    : new Date(`${month}-15`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 space-y-4">
        <p className="text-slate-400 text-sm capitalize">
          Rendimiento del equipo — <span className="text-slate-300">{label}</span>
        </p>

        <div className="flex items-center gap-3">
          <div className="bg-[#131929] rounded-lg p-1 inline-flex gap-1">
            <button
              onClick={() => setViewType('day')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition ${viewType === 'day' ? 'bg-violet-600 text-white' : 'text-white/50 hover:text-white'}`}
            >
              Por día
            </button>
            <button
              onClick={() => setViewType('month')}
              className={`px-3 py-1 rounded-md text-sm font-medium transition ${viewType === 'month' ? 'bg-violet-600 text-white' : 'text-white/50 hover:text-white'}`}
            >
              Por mes
            </button>
          </div>

          {viewType === 'month' ? (
            <MonthSelector value={month} onChange={setMonth} />
          ) : (
            <DatePicker
              selected={date ? new Date(date) : null}
              onChange={(d) => setDate(d.toISOString().slice(0, 10))}
              dateFormat="dd/MM/yyyy"
              locale="es"
              placeholderText="Seleccionar"
              className="bg-[#131929] border border-slate-800 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-violet-500 transition"
            />
          )}
        </div>
      </div>

      {metrics.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <TrendingUp size={40} className="mx-auto mb-3 opacity-30" />
          <p>Sin datos de rendimiento para este {viewType === 'day' ? 'día' : 'mes'}</p>
          <p className="text-sm mt-1 text-slate-600">Las citas completadas aparecerán aquí</p>
        </div>
      )}

      {metrics.length > 0 && (
      <div>
        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto w-full rounded-xl">
          <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
            <table className="table-fixed w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="w-[30%] text-left text-slate-500 font-medium px-5 py-3">Empleado</th>
                <th className="w-[10%] text-right text-slate-500 font-medium px-4 py-3">Citas</th>
                <th className="w-[18%] text-right text-slate-500 font-medium px-4 py-3">Ingresos</th>
                <th className="w-[16%] text-right text-slate-500 font-medium px-4 py-3">Comisión hoy</th>
                <th className="w-[14%] text-right text-slate-500 font-medium px-4 py-3">Promedio/cita</th>
                <th className="w-[12%] text-right text-slate-500 font-medium px-5 py-3">% del total</th>
              </tr>
            </thead>
            <tbody>
              {[...metrics]
                .sort((a, b) => b.income - a.income)
                .map((emp, i) => (
                  <tr key={emp.id} className={`border-b border-slate-800/60 last:border-0 hover:bg-white/3 transition-colors ${i === 0 && emp.income > 0 ? 'bg-violet-500/5' : ''}`}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 border border-slate-700 flex items-center justify-center text-xs text-violet-400 font-semibold flex-shrink-0">
                          {emp.name[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="text-white font-medium">{emp.name}</p>
                          {emp.commission_percent > 0 && (
                            <p className="text-slate-600 text-xs">{emp.commission_percent}% comisión</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="text-slate-300 font-medium">{emp.count}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="text-emerald-400 font-medium">{formatCOP(emp.income)}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="text-white/40 font-medium">{formatCOP(emp.commission_today)}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="text-slate-300">{formatCOP(emp.avg_per_appt)}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-slate-800 rounded-full h-1.5">
                          <div
                            className="bg-violet-500/60 h-1.5 rounded-full transition-all"
                            style={{ width: `${Math.min(emp.pct_of_total, 100)}%` }}
                          />
                        </div>
                        <span className="text-slate-400 text-xs w-10 text-right">
                          {emp.pct_of_total.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
            </table>
          </div>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden space-y-3">
          {[...metrics]
            .sort((a, b) => b.income - a.income)
            .map((emp) => (
              <div key={emp.id} className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 border border-slate-700 flex items-center justify-center text-sm text-violet-400 font-semibold flex-shrink-0">
                    {emp.name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white font-semibold">{emp.name}</p>
                    {emp.commission_percent > 0 && (
                      <p className="text-slate-500 text-xs">{emp.commission_percent}% comisión</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-slate-500 text-xs mb-1">Citas</p>
                    <p className="text-white text-2xl font-bold">{emp.count}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs mb-1">Ingresos</p>
                    <p className="text-emerald-400 text-lg font-semibold">{formatCOP(emp.income)}</p>
                  </div>
                </div>

                <div>
                  <p className="text-slate-500 text-xs mb-1">Promedio por cita</p>
                  <p className="text-slate-300 font-medium">{formatCOP(emp.avg_per_appt)}</p>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                  <p className="text-amber-400 text-xs font-semibold mb-1">Comisión del día</p>
                  <p className="text-amber-300 text-xl font-bold">{formatCOP(emp.commission_today)}</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-slate-500 text-xs">% del total</p>
                    <p className="text-slate-400 text-xs font-semibold">{emp.pct_of_total.toFixed(1)}%</p>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2">
                    <div
                      className="bg-violet-500 h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(emp.pct_of_total, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
      )}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'team',        label: 'Equipo',      icon: Users },
  { id: 'performance', label: 'Rendimiento', icon: BarChart2 },
];

export default function Employees() {
  const [tab, setTab] = useState('team');
  const [triggerAdd, setTriggerAdd] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data: sub, isLoading: subLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get('/api/subscription').then(r => r.data.data),
    staleTime: 5 * 60 * 1000
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees', showInactive],
    queryFn: () => api.get(`/api/employees?includeInactive=${showInactive}`).then((r) => r.data.data),
  });

  const plan = sub?.plan || 'estandar';
  const visibleTabs = plan === 'lite' ? TABS.filter(t => t.id === 'team') : TABS;
  const activeCount = employees.filter((e) => e.is_active).length;

  if (subLoading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-4">
        <div className="h-8 w-48 bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-32 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />
        <div className="h-64 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="border-b border-white/6 pb-4 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-white">
          Empleados
          <span className="text-xs sm:text-sm font-normal text-white/40 ml-2">{activeCount} activos</span>
        </h1>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="flex gap-1 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-1 w-fit overflow-x-auto">
          {visibleTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition whitespace-nowrap ${tab === id ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setTriggerAdd(true)}
          className="flex items-center justify-center sm:justify-start gap-2 w-full sm:w-auto bg-violet-600 hover:bg-violet-500 text-white text-xs sm:text-sm font-medium px-4 py-2 rounded-lg transition whitespace-nowrap"
        >
          <UserPlus size={16} /> <span>Agregar empleado</span>
        </button>
      </div>

      {tab === 'team'        && <TeamTab triggerAdd={triggerAdd} onTriggerReset={() => setTriggerAdd(false)} showInactive={showInactive} onShowInactiveChange={setShowInactive} />}
      {tab === 'performance' && <PerformanceTab />}
    </div>
  );
}
