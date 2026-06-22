import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronDown, X, Scissors, User, CheckCircle, XCircle, Pencil } from 'lucide-react';
import DatePicker, { registerLocale } from 'react-datepicker';
import { es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import api from '../../lib/api';
import { supabase } from '../../lib/supabase';
import AppointmentModal from '../../components/appointments/AppointmentModal';
import { useAuth } from '../../context/AuthContext';
import { timeFromISO } from '../../lib/timezone';

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

const emptyForm = { client_id: '', service_id: '', employee_id: '', date: today(), time: '09:00', notes: '', is_reward: false };

export default function Appointments() {
  const qc = useQueryClient();
  const { business } = useAuth();

  const getTimeFromISO = (iso) => timeFromISO(iso, business?.country);
  const [date, setDate] = useState(today());
  const [pickerDate, setPickerDate] = useState(todayLocal());
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [limitError, setLimitError] = useState(null);
  // Edit modal
  const [editingAppt, setEditingAppt] = useState(null);
  const [editForm, setEditForm] = useState({ time: '', employee_id: '', service_id: '' });
  const [editError, setEditError] = useState('');
  // Client quick-select state
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDrop, setShowClientDrop] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', phone: '' });
  const clientSearchRef = useRef(null);
  // Product sales attached to appointment
  const [apptProducts, setApptProducts] = useState([]);  // [{product_id, name, price, quantity}]
  const [productPickId, setProductPickId] = useState('');
  const [productPickQty, setProductPickQty] = useState('1');

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointments', date],
    queryFn: () => api.get(`/api/appointments?date=${date}`).then((r) => r.data.data),
    refetchInterval: 15000,
    staleTime: 0,
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

  const { session } = useAuth();
  const { data: pausasData, refetch: refetchPausas } = useQuery({
    queryKey: ['bot-pausas', business?.id],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/whatsapp/pausadas`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      const json = await res.json();
      return json.data || [];
    },
    refetchInterval: 30000,
    enabled: !!business?.id
  });
  const pausasActivas = pausasData || [];

  const reactivarBot = async (clientPhone) => {
    try {
      await fetch(`${import.meta.env.VITE_API_URL}/api/whatsapp/reactivar-bot`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ client_phone: clientPhone })
      });
      refetchPausas();
    } catch (err) {
      console.error('Error reactivando bot:', err);
    }
  };

  useEffect(() => {
    if (editingAppt) {
      const appt = appointments.find((a) => a.id === editingAppt);
      if (appt) {
        const isCompleted = appt.status === 'completed';
        setEditForm({
          time: isCompleted ? getTimeFromISO(appt.scheduled_at) : getTimeFromISO(appt.scheduled_at),
          employee_id: appt.employee_id || '',
          service_id: appt.service_id || '',
          isCompleted,
        });
      }
    }
  }, [editingAppt, appointments]);

  const selectedService = services.find((s) => s.id === form.service_id);

  const filteredClients = (clients || []).filter((c) => {
    try {
      return !clientSearch || (c?.name ?? '').toLowerCase().includes(clientSearch.toLowerCase()) || (c?.phone ?? '').includes(clientSearch);
    } catch (err) {
      console.error('Error filtering client:', c, err);
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
      qc.invalidateQueries({ queryKey: ['appointments'] });
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
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['appointments', date] });
      const previousData = qc.getQueryData(['appointments', date]);
      qc.setQueryData(['appointments', date], (old) =>
        old?.map((appt) => appt.id === id ? { ...appt, status } : appt) || []
      );
      return { previousData };
    },
    onError: (_, __, context) => {
      if (context?.previousData) {
        qc.setQueryData(['appointments', date], context.previousData);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['appointments', date] }),
  });

  const editApptMutation = useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/api/appointments/${id}`, data),
    onMutate: async ({ id, ...data }) => {
      await qc.cancelQueries({ queryKey: ['appointments', date] });
      const previousData = qc.getQueryData(['appointments', date]);
      qc.setQueryData(['appointments', date], (old) =>
        old?.map((appt) => appt.id === id ? { ...appt, ...data } : appt) || []
      );
      return { previousData };
    },
    onError: (err, __, context) => {
      if (context?.previousData) {
        qc.setQueryData(['appointments', date], context.previousData);
      }
      setEditError(err.response?.data?.error || 'Error al actualizar la cita.');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['appointments', date] });
      setEditingAppt(null);
      setEditForm({ time: '', employee_id: '', service_id: '' });
      setEditError('');
    },
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

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <div className="page-header border-b border-white/6 pb-3 mb-4">
        <h1 className="text-white text-xl sm:text-2xl font-bold">Citas</h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-1">{appointments.length} citas para esta fecha</p>
      </div>

      {/* Filtro de fecha + botón */}
      <div className="mb-4 pr-14 flex flex-col sm:flex-row sm:items-center sm:gap-3">
        <DatePicker
          selected={pickerDate}
          onChange={(d) => {
            setPickerDate(d);
            const str = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
            setDate(str);
          }}
          dateFormat="dd/MM/yyyy"
          locale="es"
          placeholderText="Seleccionar fecha"
          className="w-full sm:w-auto bg-[#131929] border border-slate-800 text-white rounded-lg px-4 py-2.5 text-xs sm:text-sm focus:outline-none focus:border-violet-500 transition"
        />
        <button onClick={() => { setForm({ ...emptyForm, date, is_reward: false }); setFormError(''); resetClientState(); setApptProducts([]); setProductPickId(''); setProductPickQty('1'); setModal(true); }}
          className="flex items-center justify-center sm:justify-start gap-2 bg-violet-600 hover:bg-violet-500 text-white text-xs sm:text-sm font-medium px-4 py-2.5 sm:py-2 rounded-lg transition w-full sm:w-auto mt-3 sm:mt-0">
          <CalendarPlus size={16} /> Nueva cita
        </button>
      </div>

      {pausasActivas.length > 0 && (
        <div className="mb-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="text-sm font-semibold text-yellow-400 mb-2">
            ⚠️ Bot pausado para {pausasActivas.length} cliente{pausasActivas.length > 1 ? 's' : ''}
          </p>
          <div className="flex flex-col gap-2">
            {pausasActivas.map((p) => {
              const hasta = new Date(p.bot_paused_until).toLocaleTimeString('es-CO', {
                timeZone: 'America/Bogota',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              });
              return (
                <div key={p.client_phone} className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm text-slate-300">
                    📱 {p.client_phone} — pausado hasta las {hasta}
                  </span>
                  <button
                    onClick={() => reactivarBot(p.client_phone)}
                    className="text-xs px-3 py-1 rounded-lg bg-yellow-500/20 border border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/30 transition-colors whitespace-nowrap"
                  >
                    Reactivar bot
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />)}</div>
      ) : !appointments || !Array.isArray(appointments) ? (
        <div className="text-center py-20 text-slate-500">
          <p>Error cargando citas</p>
        </div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <CalendarPlus size={40} className="mx-auto mb-3 opacity-30" />
          <p>No hay citas para esta fecha</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Próximas citas */}
          {appointments.filter((a) => ['pending', 'confirmed'].includes(a.status)).length > 0 && (
            <div>
              <h2 className="text-slate-300 text-xs sm:text-sm font-semibold mb-3">Próximas citas</h2>
              <div className="space-y-3">
                {appointments.filter((a) => ['pending', 'confirmed'].includes(a.status)).map((appt) => {
                  const timeStr = formatTime(appt.scheduled_at);
                  return (
                    <div key={appt.id} className={`${STATUS_BORDER[appt.status]} bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden border border-violet-500/15 hover:border-violet-500/35 transition-all duration-200`}>
                      <div className="flex flex-col md:flex-row">
                        {/* Lado izquierdo: Hora */}
                        <div className="min-w-[90px] md:w-24 md:flex-shrink-0 bg-gradient-to-b from-violet-600 to-violet-700 flex items-center justify-center py-4 md:py-6">
                          <p className="text-white text-lg md:text-base font-bold text-center">{timeStr}</p>
                        </div>

                        {/* Lado derecho: Info */}
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

                          {/* Botones de acción */}
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
              {/* Desktop: Tabla */}
              <div className="hidden md:block overflow-x-auto">
                <div className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 overflow-hidden">
                  <table className="zita-table w-full text-sm">
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
              </div>
              {/* Mobile: Cards */}
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
                        <p className="text-slate-300 font-medium">{appt.clients?.name || <span className="text-emerald-400 italic">Ocasional</span>}</p>
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

      {/* Modal editar cita */}
      {editingAppt && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 py-4 sm:py-0">
          <div className="bg-[#131929] border border-slate-800 rounded-2xl w-full max-w-md p-4 sm:p-6 shadow-xl border border-violet-500/25 shadow-2xl shadow-black/50 max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
            <h3 className="text-white font-semibold text-base sm:text-lg mb-4 sm:mb-5">Editar cita</h3>
            {editForm.isCompleted && (
              <p className="text-amber-300 text-xs sm:text-sm bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg mb-4">
                Esta cita está completada. Solo puedes cambiar el empleado y servicio.
              </p>
            )}
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!editForm.isCompleted && !editForm.time) return setEditError('La hora es obligatoria.');
              if (!editForm.service_id) return setEditError('El servicio es obligatorio.');
              editApptMutation.mutate({
                id: editingAppt,
                time: editForm.isCompleted ? undefined : editForm.time,
                employee_id: editForm.employee_id || null,
                service_id: editForm.service_id,
              });
            }} className="space-y-3 sm:space-y-4">
              {editError && <p className="text-red-400 text-xs sm:text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg">{editError}</p>}

              {!editForm.isCompleted && (
                <div>
                  <label className="block text-slate-400 text-xs sm:text-sm mb-1.5">Hora</label>
                  <input type="time" value={editForm.time} onChange={(e) => setEditForm({ ...editForm, time: e.target.value })}
                    className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all duration-150" />
                </div>
              )}

              <div>
                <label className="block text-slate-400 text-xs sm:text-sm mb-1.5">Servicio</label>
                <select value={editForm.service_id} onChange={(e) => setEditForm({ ...editForm, service_id: e.target.value })}
                  className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm focus:outline-none focus:border-violet-500 transition">
                  <option value="">Seleccionar...</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {formatCOP(s.price)}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 text-xs sm:text-sm mb-1.5">Empleado (opcional)</label>
                <select value={editForm.employee_id} onChange={(e) => setEditForm({ ...editForm, employee_id: e.target.value })}
                  className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm focus:outline-none focus:border-violet-500 transition">
                  <option value="">Auto-asignar</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => { setEditingAppt(null); setEditForm({ time: '', employee_id: '', service_id: '' }); setEditError(''); }}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs sm:text-sm font-medium py-2 sm:py-2.5 rounded-lg transition hover:bg-white/10 hover:text-white transition-colors duration-150">
                  Cancelar
                </button>
                <button type="submit" disabled={editApptMutation.isPending}
                  className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs sm:text-sm font-medium py-2 sm:py-2.5 rounded-lg transition">
                  {editApptMutation.isPending ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {limitError && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="zita-modal w-full max-w-md p-6">
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
