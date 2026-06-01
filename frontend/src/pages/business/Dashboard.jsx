import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Calendar, Users, DollarSign, MessageCircle, TrendingUp, TrendingDown, Wallet, UserX, Plus, ChevronDown, Scissors, User, CheckCircle, XCircle, Pencil } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import DatePicker, { registerLocale } from 'react-datepicker';
import { es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import api from '../../lib/api';
import { supabase } from '../../lib/supabase';
import AppointmentModal from '../../components/appointments/AppointmentModal';

registerLocale('es', es);

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

const todayLocal = () => {
  const now = new Date();
  const colombiaStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const [y, m, d] = colombiaStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
};

const STATUS_CYCLE = { pending: 'confirmed', confirmed: 'completed', completed: 'cancelled', cancelled: 'pending' };
const STATUS_LABEL = { pending: 'Pendiente', confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada' };
const STATUS_COLOR = {
  pending:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  confirmed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  cancelled: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

const STATUS_BORDER = {
  pending:   'border-l-4 border-yellow-500/50',
  confirmed: 'border-l-4 border-emerald-500/50',
  completed: 'border-l-4 border-slate-500/50',
  cancelled: 'border-l-4 border-slate-500/50',
};

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getTimeFromISO(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 18) return 'Buenas tardes';
  return 'Buenas noches';
}

const emptyForm = { client_id: '', service_id: '', employee_id: '', date: today(), time: '09:00', notes: '', is_reward: false };

function MetricCard({ icon: Icon, label, value, sub, color }) {
  const isKpiCard = ['bg-blue-600', 'bg-violet-600', 'bg-emerald-600', 'bg-green-600'].includes(color);
  const iconColor = isKpiCard ? 'bg-violet-600/20 text-violet-400' : color === 'bg-emerald-600' ? 'bg-emerald-500/20 text-emerald-400' : color === 'bg-red-600' ? 'bg-red-500/20 text-red-400' : 'bg-violet-600/20 text-violet-400';

  return (
    <div className={`min-w-0 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-3 ${isKpiCard ? 'sm:p-3' : 'sm:p-3'} flex flex-col gap-1.5 sm:gap-3 ${isKpiCard ? 'border border-violet-500/15 hover:border-violet-500/40 hover:bg-slate-700/60 transition-all duration-200' : 'border border-white/5 hover:border-violet-500/40 hover:bg-slate-700/60 transition-all duration-200'}`}>
      <div className="flex items-center justify-between">
        <span className="text-slate-400 text-[10px] leading-tight font-medium">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconColor}`}>
          <Icon size={18} className="text-inherit sm:w-4 sm:h-4" />
        </div>
      </div>
      <div>
        <p className={`${isKpiCard ? 'text-lg sm:text-lg font-bold text-white' : 'text-white text-lg sm:text-base font-bold'}`}>{value}</p>
        {sub && <p className={`${isKpiCard ? 'text-xs text-white/40 mt-1' : 'text-slate-500 text-xs mt-0.5 sm:mt-1'}`}>{sub}</p>}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 animate-pulse">
      <div className="flex justify-between mb-4">
        <div className="h-4 w-24 bg-slate-800 rounded" />
        <div className="w-9 h-9 bg-slate-800 rounded-lg" />
      </div>
      <div className="h-8 w-20 bg-slate-800 rounded" />
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [date, setDate] = useState(today());
  const [pickerDate, setPickerDate] = useState(todayLocal());
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [limitError, setLimitError] = useState(null);
  const [editingAppt, setEditingAppt] = useState(null);
  const [editForm, setEditForm] = useState({ time: '', employee_id: '', service_id: '' });
  const [editError, setEditError] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDrop, setShowClientDrop] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', phone: '' });
  const [apptProducts, setApptProducts] = useState([]);
  const [productPickId, setProductPickId] = useState('');
  const [productPickQty, setProductPickQty] = useState('1');

  const { data: sub } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get('/api/subscription').then(r => r.data.data),
    staleTime: 5 * 60 * 1000
  });

  const { data: overview, isLoading, isError, error: overviewError } = useQuery({
    queryKey: ['metrics-overview'],
    queryFn: () => api.get('/api/metrics/overview').then((r) => r.data.data),
  });

  useEffect(() => {
    if (isError && overviewError) {
      console.log('[Dashboard] /api/metrics/overview error:', overviewError?.response?.status, overviewError?.response?.data, overviewError?.message);
    }
  }, [isError, overviewError]);

  const { data: todayAppts } = useQuery({
    queryKey: ['appointments-today'],
    queryFn: () => {
      const today = new Date().toISOString().slice(0, 10);
      return api.get(`/api/appointments?date=${today}`).then((r) => r.data.data);
    },
  });

  const { data: daySummary } = useQuery({
    queryKey: ['cash-summary', 'day'],
    queryFn: () => api.get('/api/cash/summary?period=day').then((r) => r.data.data),
  });

  const { data: clientMetrics } = useQuery({
    queryKey: ['metrics-clients'],
    queryFn: () => api.get('/api/metrics/clients').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: appointments = [] } = useQuery({
    queryKey: ['appointments-lite', date],
    queryFn: () => api.get(`/api/appointments?date=${date}`).then((r) => r.data.data),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get('/api/clients').then((r) => r.data.data),
  });

  const { data: services = [] } = useQuery({
    queryKey: ['services-list'],
    queryFn: () => api.get('/api/services').then((r) => r.data.data.filter((s) => s.active !== false)),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list'],
    queryFn: () => api.get('/api/employees').then((r) => r.data.data.filter((e) => e.is_active)),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.get('/api/products').then((r) => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: loyaltyConfig } = useQuery({
    queryKey: ['loyalty-config'],
    queryFn: () => api.get('/api/loyalty/config').then((r) => r.data.data),
  });

  const inactiveClients = (clientMetrics?.inactive_clients ?? []).slice(0, 3);

  const selectedService = services.find((s) => s.id === form.service_id);
  const filteredClients = (clients || []).filter((c) => {
    try {
      return !clientSearch || (c?.name ?? '').toLowerCase().includes(clientSearch.toLowerCase()) || (c?.phone ?? '').includes(clientSearch);
    } catch (err) {
      return false;
    }
  }).slice(0, 8);
  const selectedClient = (clients || []).find((c) => c?.id === form.client_id);

  const createMutation = useMutation({
    mutationFn: async (body) => {
      let employeeId = body.employee_id || null;
      if (!employeeId && employees.length > 0) {
        const { data } = await supabase.rpc('get_available_employee', {
          p_business_id: null,
          p_date: body.date,
          p_time: body.time + ':00',
        });
        employeeId = data || null;
      }
      const apptRes = await api.post('/api/appointments', {
        client_id: body.client_id,
        service_id: body.service_id,
        employee_id: employeeId,
        scheduled_at: `${body.date}T${body.time}:00`,
        price: selectedService?.price ?? 0,
        notes: body.notes,
        is_reward: body.is_reward ?? false,
      });
      const apptId = apptRes.data.data?.id;
      if (apptProducts.length > 0 && apptId) {
        await Promise.allSettled(
          apptProducts.map((p) =>
            api.post(`/api/products/${p.product_id}/sell`, {
              quantity: p.quantity,
              client_id: body.client_id || null,
              appointment_id: apptId,
              sold_via: 'presencial',
            })
          )
        );
      }
      return apptRes;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments-lite'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product-sales'] });
      setModal(false);
      setForm(emptyForm);
      setApptProducts([]);
      setProductPickId('');
      setProductPickQty('1');
      resetClientState();
    },
    onError: (err) => {
      if (err.response?.data?.code === 'APPOINTMENTS_LIMIT_REACHED') {
        setLimitError(err.response.data.error);
      } else {
        setFormError(err.response?.data?.error || 'Error al crear la cita.');
      }
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/api/appointments/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });

  const resetClientState = () => {
    setClientSearch(''); setShowClientDrop(false);
    setShowNewClient(false); setIsWalkIn(false); setNewClient({ name: '', phone: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.service_id) return setFormError('Selecciona un servicio.');

    let clientId = form.client_id || null;

    if (showNewClient) {
      if (!newClient.name.trim()) return setFormError('El nombre del cliente es obligatorio.');
      try {
        const res = await api.post('/api/clients', {
          name: newClient.name.trim(),
          phone: newClient.phone.trim() || null
        });
        clientId = res.data.data.id;
        qc.invalidateQueries({ queryKey: ['clients-list'] });
        qc.invalidateQueries({ queryKey: ['clients'] });
      } catch (err) {
        return setFormError(err.response?.data?.error || 'Error al crear el cliente.');
      }
    }

    createMutation.mutate({
      ...form,
      client_id: clientId,
      notes: showNewClient && !newClient.phone.trim() && newClient.name.trim()
        ? `${newClient.name.trim()}${form.notes ? ` — ${form.notes}` : ''}`
        : form.notes,
    });
  };

  const waPercent =
    overview?.total_appointments > 0
      ? Math.round((overview.whatsapp_appointments / overview.total_appointments) * 100)
      : 0;

  const isLoadingSub = sub === undefined;
  const plan = isLoadingSub ? null : (sub?.plan || 'estandar');
  const appointmentsUsed = overview?.total_appointments ?? 0;
  const appointmentsLimit = sub?.limites?.max_appointments_month ?? 100;

  if (isLoadingSub) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-white text-xl sm:text-2xl font-bold">Dashboard</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Cargando...</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 sm:mb-8">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (plan === 'lite') {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-white text-xl sm:text-2xl font-bold">Dashboard</h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">Resumen de tu negocio</p>
        </div>

        {/* 3 métricas en fila */}
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 md:gap-4 mb-6 sm:mb-8">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <MetricCard
                icon={Calendar}
                label="Citas hoy"
                value={todayAppts?.length ?? 0}
                sub={`${appointmentsUsed} este mes`}
                color="bg-blue-600"
              />
              <MetricCard
                icon={Calendar}
                label="Límite mensual"
                value={`${appointmentsUsed} / ${appointmentsLimit}`}
                sub="Citas agendadas"
                color="bg-violet-600"
              />
              <MetricCard
                icon={MessageCircle}
                label="Por WhatsApp"
                value={`${waPercent}%`}
                sub={`${overview?.whatsapp_appointments ?? 0} de ${appointmentsUsed}`}
                color="bg-green-600"
              />
            </>
          )}
        </div>

        {/* Citas - Módulo completo */}
        <div>
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:gap-3">
            <DatePicker
              selected={pickerDate}
              onChange={(d) => {
                setPickerDate(d);
                setDate(d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }));
              }}
              locale="es"
              dateFormat="dd/MM/yyyy"
              placeholderText="Seleccionar fecha"
              className="w-full sm:w-auto bg-[#131929] border border-slate-800 text-white rounded-lg px-4 py-2.5 text-xs sm:text-sm focus:outline-none focus:border-violet-500 transition"
            />
            <button onClick={() => { setForm({ ...emptyForm, date, is_reward: false }); setFormError(''); resetClientState(); setApptProducts([]); setProductPickId(''); setProductPickQty('1'); setModal(true); }}
              className="flex items-center justify-center sm:justify-start gap-2 bg-violet-600 hover:bg-violet-500 text-white text-xs sm:text-sm font-medium px-4 py-2.5 sm:py-2 rounded-lg transition w-full sm:w-auto">
              <Plus size={16} /> Nueva cita
            </button>
          </div>

          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />)}</div>
          ) : appointments.length === 0 ? (
            <div className="text-center py-20 text-slate-500">
              <Calendar size={40} className="mx-auto mb-3 opacity-30" />
              <p>No hay citas para este día</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Próximas citas */}
              {appointments.filter((a) => ['pending', 'confirmed'].includes(a.status)).length > 0 && (
                <div>
                  <h2 className="text-slate-300 text-xs sm:text-sm font-semibold mb-4">Próximas citas</h2>
                  <div className="space-y-3">
                    {appointments.filter((a) => ['pending', 'confirmed'].includes(a.status)).map((appt) => {
                      const timeStr = formatTime(appt.scheduled_at);
                      return (
                        <div key={appt.id} className={`${STATUS_BORDER[appt.status]} bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden hover:border-slate-700 transition`}>
                          <div className="flex flex-col md:flex-row">
                            <div className="min-w-[90px] md:w-24 md:flex-shrink-0 bg-gradient-to-b from-violet-600 to-violet-700 flex items-center justify-center py-4 md:py-6">
                              <p className="text-white text-lg md:text-base font-bold text-center">{timeStr}</p>
                            </div>
                            <div className="flex-1 px-4 md:px-5 py-4 md:py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                              <div className="flex-1">
                                <p className="text-white font-bold text-lg md:text-base">{appt.clients?.name || '—'}</p>
                                <div className="flex flex-col md:flex-row md:gap-4 gap-2 mt-2 md:mt-1 text-xs md:text-sm text-slate-400">
                                  <div className="flex items-center gap-1.5">
                                    <Scissors size={16} className="text-violet-400 flex-shrink-0" />
                                    <span>{appt.services?.name || '—'}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <User size={16} className="text-violet-400 flex-shrink-0" />
                                    <span>{appt.employees?.name || 'Sin asignar'}</span>
                                  </div>
                                </div>
                                <div className="mt-2.5 md:mt-2">
                                  <span className={`inline-flex items-center gap-1 text-xs border px-2.5 py-1 rounded-full font-medium ${STATUS_COLOR[appt.status]}`}>
                                    {STATUS_LABEL[appt.status]}
                                  </span>
                                </div>
                              </div>
                              <div className="flex gap-2 flex-wrap md:gap-1">
                                <button
                                  onClick={() => {
                                    setEditingAppt(appt.id);
                                    setEditError('');
                                  }}
                                  className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 md:py-1 text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg transition"
                                  title="Editar"
                                >
                                  <Pencil size={14} />
                                  <span className="md:hidden">Editar</span>
                                </button>
                                <button
                                  onClick={() => updateStatusMutation.mutate({ id: appt.id, status: appt.status === 'pending' ? 'confirmed' : 'completed' })}
                                  className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 md:py-1 text-xs font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg transition"
                                  title={appt.status === 'pending' ? 'Confirmar' : 'Completar'}
                                >
                                  <CheckCircle size={14} />
                                  <span className="md:hidden">{appt.status === 'pending' ? 'Confirmar' : 'Completar'}</span>
                                </button>
                                <button
                                  onClick={() => updateStatusMutation.mutate({ id: appt.id, status: 'cancelled' })}
                                  className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 md:py-1 text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg transition"
                                  title="Cancelar"
                                >
                                  <XCircle size={14} />
                                  <span className="md:hidden">Cancelar</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Citas completadas */}
              {appointments.filter((a) => ['completed', 'cancelled'].includes(a.status)).length > 0 && (
                <div>
                  <h2 className="text-slate-300 text-xs sm:text-sm font-semibold mb-3">Citas completadas</h2>
                  <div className="hidden md:block bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-800">
                          {['Hora', 'Cliente', 'Servicio', 'Empleado', 'Precio', 'Estado'].map((h) => (
                            <th key={h} className="text-left text-slate-500 font-medium px-4 py-3">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {appointments.filter((a) => ['completed', 'cancelled'].includes(a.status)).map((appt) => (
                          <tr key={appt.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                            <td className="px-4 py-3 text-white font-medium">{formatTime(appt.scheduled_at)}</td>
                            <td className="px-4 py-3 text-slate-300">{appt.clients?.name || '—'}</td>
                            <td className="px-4 py-3 text-slate-300">{appt.services?.name || '—'}</td>
                            <td className="px-4 py-3 text-slate-400">{appt.employees?.name || 'Sin asignar'}</td>
                            <td className="px-4 py-3 text-slate-300">{formatCOP(appt.price)}</td>
                            <td className="px-4 py-3 flex gap-2">
                              <button
                                onClick={() => {
                                  setEditingAppt(appt.id);
                                  setEditError('');
                                }}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg transition"
                                title="Editar"
                              >
                                <Pencil size={12} />
                              </button>
                              <button onClick={() => updateStatusMutation.mutate({ id: appt.id, status: STATUS_CYCLE[appt.status] })}
                                className={`flex items-center gap-1 text-xs border px-2.5 py-1 rounded-full font-medium transition hover:opacity-80 ${STATUS_COLOR[appt.status]}`}>
                                {STATUS_LABEL[appt.status]} <ChevronDown size={12} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="md:hidden space-y-2">
                    {appointments.filter((a) => ['completed', 'cancelled'].includes(a.status)).map((appt) => (
                      <div key={appt.id} className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-white font-medium text-sm">{formatTime(appt.scheduled_at)}</p>
                          <div className="flex gap-1">
                            <button
                              onClick={() => {
                                setEditingAppt(appt.id);
                                setEditError('');
                              }}
                              className="flex items-center justify-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg transition"
                              title="Editar"
                            >
                              <Pencil size={12} />
                            </button>
                            <button onClick={() => updateStatusMutation.mutate({ id: appt.id, status: STATUS_CYCLE[appt.status] })}
                              className={`flex items-center gap-1 text-xs border px-2 py-0.5 rounded-full font-medium transition hover:opacity-80 ${STATUS_COLOR[appt.status]}`}>
                              {STATUS_LABEL[appt.status]} <ChevronDown size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-slate-500">Cliente</p>
                            <p className="text-slate-300 font-medium">{appt.clients?.name || '—'}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Servicio</p>
                            <p className="text-slate-300 font-medium">{appt.services?.name || '—'}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Empleado</p>
                            <p className="text-slate-300 font-medium">{appt.employees?.name || 'Sin asignar'}</p>
                          </div>
                          <div>
                            <p className="text-slate-500">Precio</p>
                            <p className="text-slate-300 font-medium">{formatCOP(appt.price)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal crear cita */}
        <AppointmentModal
          isOpen={modal}
          onClose={() => setModal(false)}
          form={form}
          setForm={setForm}
          formError={formError}
          setFormError={setFormError}
          handleSubmit={handleSubmit}
          clients={clients}
          services={services}
          employees={employees}
          products={products}
          loyaltyConfig={loyaltyConfig}
          createMutation={createMutation}
          clientSearch={clientSearch}
          setClientSearch={setClientSearch}
          showClientDrop={showClientDrop}
          setShowClientDrop={setShowClientDrop}
          showNewClient={showNewClient}
          setShowNewClient={setShowNewClient}
          isWalkIn={isWalkIn}
          setIsWalkIn={setIsWalkIn}
          newClient={newClient}
          setNewClient={setNewClient}
          apptProducts={apptProducts}
          setApptProducts={setApptProducts}
          productPickId={productPickId}
          setProductPickId={setProductPickId}
          productPickQty={productPickQty}
          setProductPickQty={setProductPickQty}
          resetClientState={resetClientState}
          limitError={limitError}
          setLimitError={setLimitError}
        />

        {/* Modal límite de citas */}
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
                <Link
                  to="/dashboard/suscripcion"
                  className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-2.5 rounded-lg text-sm font-medium transition text-center"
                >
                  Ver planes
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 overflow-x-hidden">

      {/* Header */}
      <div className="border-b border-white/6 pb-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">
              {getGreeting()}
            </h1>
            <p className="text-xs sm:text-sm text-white/40 mt-0.5">
              {new Date().toLocaleDateString('es-CO', {
                weekday: 'long', year: 'numeric',
                month: 'long', day: 'numeric'
              })}
            </p>
          </div>
        </div>
      </div>

      {isError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3 mb-6">
          No se pudieron cargar las métricas. Verifica tu conexión.
          {import.meta.env.DEV && overviewError && (
            <p className="text-xs mt-1 opacity-70 font-mono">
              {overviewError.response?.status} — {JSON.stringify(overviewError.response?.data ?? overviewError.message)}
            </p>
          )}
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              icon={Calendar}
              label="Citas hoy"
              value={`${(todayAppts || []).filter((a) => a.status === 'completed').length}/${todayAppts?.length ?? 0}`}
              sub="Completadas / Total"
              color="bg-blue-600"
            />
            <MetricCard
              icon={TrendingUp}
              label="Ingresos hoy"
              value={formatCOP(daySummary?.income_total ?? 0)}
              sub={daySummary?.income_total > 0 ? 'Caja del día' : 'Sin movimiento'}
              color={daySummary?.income_total > 0 ? 'bg-emerald-600' : 'bg-violet-600'}
            />
            <MetricCard
              icon={DollarSign}
              label="Ingresos del mes"
              value={formatCOP(overview?.total_income)}
              sub="Solo citas completadas"
              color="bg-violet-600"
            />
            <MetricCard
              icon={MessageCircle}
              label="Citas por WhatsApp"
              value={`${waPercent}%`}
              sub={`${overview?.whatsapp_appointments ?? 0} de ${overview?.total_appointments ?? 0} citas`}
              color="bg-green-600"
            />
          </>
        )}
      </div>

      {/* Caja del día */}
      <div className="mt-6 sm:mt-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2">
            <Wallet size={14} className="sm:w-4 sm:h-4 text-slate-400" />
            <h2 className="text-slate-400 text-xs sm:text-sm font-medium">Caja de hoy</h2>
          </div>
          <Link to="/dashboard/caja" className="text-violet-400 hover:text-violet-300 text-xs transition">
            Ver módulo completo →
          </Link>
        </div>
        {daySummary ? (
          <div className="grid grid-cols-3 gap-2 md:gap-4">
            <MetricCard icon={TrendingUp}   label="Ingresos de hoy"   value={formatCOP(daySummary.income_total)}  sub="Caja del día"        color="bg-emerald-600" />
            <MetricCard icon={TrendingDown} label="Egresos de hoy"    value={formatCOP(daySummary.expense_total)} sub="Gastos del día"       color="bg-red-600" />
            <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-3 sm:p-3 flex flex-col gap-1.5 sm:gap-3 border border-violet-500/15 hover:border-violet-500/40 hover:bg-slate-700/60 transition-all duration-200">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs sm:text-sm font-medium">Ganancia neta hoy</span>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${daySummary.net >= 0 ? 'bg-violet-600/20' : 'bg-violet-600/20'}`}>
                  {daySummary.net >= 0 ? <TrendingUp size={18} className="text-violet-400" /> : <TrendingDown size={18} className="text-violet-400" />}
                </div>
              </div>
              <div>
                <p className={`text-lg sm:text-2xl font-bold ${daySummary.net > 0 ? 'text-emerald-400' : daySummary.net === 0 ? 'text-white/60' : 'text-red-400'}`}>
                  {formatCOP(daySummary.net)}
                </p>
                <p className="text-slate-500 text-xs mt-0.5 sm:mt-1">Ingresos − egresos</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}
      </div>

      {/* Agenda de hoy */}
      <div className="mt-6 sm:mt-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-violet-400" />
            <h2 className="text-base font-semibold text-white">
              Agenda de hoy
            </h2>
            <span className="text-xs bg-violet-500/15 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full">
              {todayAppts?.length ?? 0} citas
            </span>
          </div>
          <button
            onClick={() => navigate('/dashboard/citas')}
            className="text-xs text-violet-400 hover:text-violet-300 transition-colors">
            Ver todas →
          </button>
        </div>

        {!todayAppts ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />)}</div>
        ) : todayAppts.length === 0 ? (
          <div className="text-center py-8">
            <Calendar size={32} className="text-white/20 mx-auto mb-3" />
            <p className="text-sm text-white/40">
              Sin citas para hoy
            </p>
            <button
              onClick={() => { setForm({ ...emptyForm, date: today(), is_reward: false }); setFormError(''); resetClientState(); setApptProducts([]); setProductPickId(''); setProductPickQty('1'); setModal(true); }}
              className="mt-3 text-xs text-violet-400 hover:text-violet-300 border border-violet-500/20 px-3 py-1.5 rounded-lg transition-colors">
              + Agregar cita
            </button>
          </div>
        ) : (
          <div>
            {(todayAppts || []).filter((a) => !['completed', 'cancelled'].includes(a.status)).length > 0 && (
              <div className="space-y-2 mb-4">
                {(todayAppts || []).filter((a) => !['completed', 'cancelled'].includes(a.status)).slice(0, 3).map((cita, idx) => {
                  const isNext = idx === 0 && cita.status !== 'completed';
                  return (
                    <div key={cita.id} className={`flex items-center gap-4 p-3 sm:py-2 rounded-xl border transition-all duration-200 ${cita.status === 'completed' ? 'border-white/5 bg-white/2 opacity-60' : isNext ? 'border-violet-500/40 bg-violet-500/5' : 'border-white/5 hover:border-violet-500/20'}`}>
                      <div className={`text-lg sm:text-sm font-bold min-w-[52px] sm:min-w-fit ${cita.status === 'completed' ? 'text-white/30 line-through' : 'text-violet-400'}`}>
                        {getTimeFromISO(cita.scheduled_at)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium truncate ${cita.status === 'completed' ? 'text-white/40 line-through' : 'text-white'}`}>
                          {cita.clients?.name || cita.client?.name || 'Cliente ocasional'}
                        </p>
                        <p className="text-xs sm:text-xs text-white/40 truncate">
                          {cita.services?.name || '—'} · {cita.employees?.name || 'Sin asignar'}
                        </p>
                      </div>
                      {cita.status === 'completed' && (
                        <span className="text-xs bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 flex-shrink-0">
                          ✓ Completada
                        </span>
                      )}
                      {cita.status === 'confirmed' && (
                        <span className="text-xs bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20 flex-shrink-0">
                          Confirmada
                        </span>
                      )}
                      {cita.status === 'pending' && (
                        <span className="text-xs bg-yellow-500/15 text-yellow-400 px-2 py-0.5 rounded-full border border-yellow-500/20 flex-shrink-0">
                          Pendiente
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {(todayAppts || []).filter((a) => ['completed', 'cancelled'].includes(a.status)).length > 0 && (
              <div className="text-center py-4 bg-emerald-500/5 border border-emerald-500/15 rounded-xl">
                <p className="text-sm text-emerald-400 font-medium">
                  🎉 ¡Día completado!
                </p>
                <p className="text-xs text-white/40 mt-1">
                  {(todayAppts || []).filter((a) => a.status === 'completed').length} citas atendidas hoy
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal crear cita - Standard/Pro */}
      <AppointmentModal
        isOpen={modal}
        onClose={() => setModal(false)}
        form={form}
        setForm={setForm}
        formError={formError}
        setFormError={setFormError}
        handleSubmit={handleSubmit}
        clients={clients}
        services={services}
        employees={employees}
        products={products}
        loyaltyConfig={loyaltyConfig}
        createMutation={createMutation}
        clientSearch={clientSearch}
        setClientSearch={setClientSearch}
        showClientDrop={showClientDrop}
        setShowClientDrop={setShowClientDrop}
        showNewClient={showNewClient}
        setShowNewClient={setShowNewClient}
        isWalkIn={isWalkIn}
        setIsWalkIn={setIsWalkIn}
        newClient={newClient}
        setNewClient={setNewClient}
        apptProducts={apptProducts}
        setApptProducts={setApptProducts}
        productPickId={productPickId}
        setProductPickId={setProductPickId}
        productPickQty={productPickQty}
        setProductPickQty={setProductPickQty}
        resetClientState={resetClientState}
        limitError={limitError}
        setLimitError={setLimitError}
      />

      {/* Modal límite de citas - Standard/Pro */}
      {limitError && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[#1e293b] border border-white/15 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-white font-semibold text-lg mb-3">Límite alcanzado</h3>
            <p className="text-slate-400 text-sm mb-6">{limitError}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setLimitError(null)}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg text-sm font-medium transition"
              >
                Cerrar
              </button>
              <Link
                to="/dashboard/suscripcion"
                className="flex-1 bg-violet-600 hover:bg-violet-500 text-white py-2.5 rounded-lg text-sm font-medium transition text-center"
              >
                Ver planes
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
