import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Calendar, Building2, Bell, Trash2, Plus, Check, AlertCircle, Star, MessageCircle, Zap, Scissors, MessageSquare, Upload, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import DatePicker, { registerLocale } from 'react-datepicker';
import { es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import api from '../../lib/api';
import { supabase as supabaseClient } from '../../lib/supabase';

registerLocale('es', es);

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const BUSINESS_TYPES = [
  'Barbería', 'Salón de belleza', 'Peluquería', 'Spa', 'Estética',
  'Veterinaria', 'Consultorio dental', 'Clínica', 'Centro médico', 'Tienda', 'Otro',
];
const TABS = [
  { id: 'hours',     label: 'Horarios',           icon: Clock },
  { id: 'closed',    label: 'Días cerrados',      icon: Calendar },
  { id: 'profile',   label: 'Perfil',             icon: Building2 },
  { id: 'modules',   label: 'Módulos',            icon: Zap },
  { id: 'notif',     label: 'Notificaciones',     icon: Bell },
  { id: 'whatsapp',  label: 'Conexión WhatsApp',  icon: MessageCircle },
  { id: 'loyalty',   label: 'Fidelización',       icon: Star },
  { id: 'recall',    label: 'Recordatorio',       icon: MessageSquare },
];

function Toast({ message, type }) {
  return (
    <div className={`fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium z-50 animate-fade-in ${type === 'error' ? 'bg-red-600' : 'bg-emerald-600'} text-white`}>
      {type === 'error' ? <AlertCircle size={15} /> : <Check size={15} />}
      {message}
    </div>
  );
}

function useToast() {
  const [toast, setToast] = useState(null);
  const show = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3200);
  };
  return { toast, show };
}

// ─── PESTAÑA HORARIOS ─────────────────────────────────────────────────────────
function HoursTab() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const [hours, setHours] = useState(null);
  const synced = useRef(false);

  const { data: savedHours, isLoading } = useQuery({
    queryKey: ['settings-hours'],
    queryFn: () => api.get('/api/settings/hours').then((r) => r.data.data),
  });

  useEffect(() => {
    if (savedHours && !synced.current) {
      setHours(savedHours);
      synced.current = true;
    }
  }, [savedHours]);

  const saveMutation = useMutation({
    mutationFn: (days) => api.put('/api/settings/hours', { days }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-hours'] });
      show('Horarios guardados');
    },
    onError: (err) => show(err.response?.data?.error || 'Error al guardar.', 'error'),
  });

  function update(i, field, value) {
    setHours((prev) => prev.map((d, idx) => idx === i ? { ...d, [field]: value } : d));
  }

  if (isLoading || !hours) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-16 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {toast && <Toast {...toast} />}
      <p className="text-slate-400 text-sm mb-6">Define el horario de atención semanal de tu negocio.</p>

      <div className="space-y-2 sm:space-y-2 md:space-y-3 mb-8">
        {hours.map((day, i) => (
          <div
            key={day.day_of_week}
            className={`border border-white/5 rounded-xl transition-all hover:border-violet-500/20 ${
              day.is_open
                ? 'bg-[#0d1420]'
                : 'bg-[#0d1420]/50 opacity-60'
            }`}
          >
            {/* Mobile card layout */}
            <div className="sm:hidden px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-medium ${day.is_open ? 'text-white' : 'text-slate-500'}`}>
                  {DAYS[day.day_of_week]}
                </span>
                <button
                  onClick={() => update(i, 'is_open', !day.is_open)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                    day.is_open ? 'bg-violet-600' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                      day.is_open ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {day.is_open && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-slate-500 text-xs flex-shrink-0 w-12">Abre</label>
                    <input
                      type="time"
                      value={day.open_time?.slice(0, 5) || '08:00'}
                      onChange={(e) => update(i, 'open_time', e.target.value)}
                      className="flex-1 bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-violet-500 transition"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-slate-500 text-xs flex-shrink-0 w-12">Cierra</label>
                    <input
                      type="time"
                      value={day.close_time?.slice(0, 5) || '18:00'}
                      onChange={(e) => update(i, 'close_time', e.target.value)}
                      className="flex-1 bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-violet-500 transition"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Desktop layout */}
            <div className="hidden sm:block px-5 py-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-3 w-36 flex-shrink-0">
                  <button
                    onClick={() => update(i, 'is_open', !day.is_open)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                      day.is_open ? 'bg-violet-600' : 'bg-slate-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                        day.is_open ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                  <span className={`text-sm font-medium ${day.is_open ? 'text-white' : 'text-slate-500'}`}>
                    {DAYS[day.day_of_week]}
                  </span>
                </div>

                {day.is_open ? (
                  <div className="flex items-center gap-5 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-white/40 w-16">Apertura</label>
                      <input
                        type="time"
                        value={day.open_time?.slice(0, 5) || '08:00'}
                        onChange={(e) => update(i, 'open_time', e.target.value)}
                        className="bg-[#131929] border border-white/10 text-white/80 rounded-lg px-3 py-1.5 text-sm focus:border-violet-500/50 focus:outline-none transition"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-white/40 w-10">Cierre</label>
                      <input
                        type="time"
                        value={day.close_time?.slice(0, 5) || '18:00'}
                        onChange={(e) => update(i, 'close_time', e.target.value)}
                        className="bg-[#131929] border border-white/10 text-white/80 rounded-lg px-3 py-1.5 text-sm focus:border-violet-500/50 focus:outline-none transition"
                      />
                    </div>
                  </div>
                ) : (
                  <span className="text-slate-600 text-sm italic">Cerrado</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => saveMutation.mutate(hours)}
        disabled={saveMutation.isPending}
        className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl transition-colors mt-4"
      >
        <Check size={15} />
        {saveMutation.isPending ? 'Guardando...' : 'Guardar horarios'}
      </button>
    </div>
  );
}

// ─── PESTAÑA DÍAS CERRADOS ────────────────────────────────────────────────────
function ClosedDaysTab() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const [form, setForm] = useState({ date: '', reason: '', is_full_day: true });
  const [formError, setFormError] = useState('');

  const today = new Date().toISOString().slice(0, 10);

  const { data: closedDays = [], isLoading } = useQuery({
    queryKey: ['settings-closed-days'],
    queryFn: () => api.get('/api/settings/closed-days').then((r) => r.data.data),
  });

  const addMutation = useMutation({
    mutationFn: (body) => api.post('/api/settings/closed-days', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-closed-days'] });
      setForm({ date: '', reason: '', is_full_day: true });
      setFormError('');
      show('Día cerrado agregado');
    },
    onError: (err) => setFormError(err.response?.data?.error || 'Error al agregar.'),
  });

  const removeMutation = useMutation({
    mutationFn: (id) => api.delete(`/api/settings/closed-days/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-closed-days'] });
      show('Día eliminado');
    },
  });

  function handleAdd(e) {
    e.preventDefault();
    setFormError('');
    if (!form.date) return setFormError('La fecha es obligatoria.');
    addMutation.mutate(form);
  }

  function fmtDate(d) {
    return new Date(d + 'T12:00:00').toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  return (
    <div>
      {toast && <Toast {...toast} />}
      <p className="text-slate-400 text-sm mb-6">Marca días especiales en los que el negocio estará cerrado.</p>

      {/* Formulario */}
      <form onSubmit={handleAdd} className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 p-5 mb-6">
        <p className="text-white text-sm font-medium mb-4">Agregar día cerrado</p>
        {formError && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg mb-4">{formError}</p>
        )}
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-slate-400 text-xs mb-1.5">Fecha *</label>
            <DatePicker
              selected={form.date ? new Date(form.date) : null}
              onChange={(d) => setForm({ ...form, date: d.toISOString().slice(0, 10) })}
              minDate={new Date(today)}
              dateFormat="dd/MM/yyyy"
              locale="es"
              placeholderText="Seleccionar"
              className="bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500 transition"
            />
          </div>
          <div className="flex-1 min-w-48">
            <label className="block text-slate-400 text-xs mb-1.5">Razón (opcional)</label>
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Ej: Festivo nacional, Vacaciones..."
              className="w-full bg-[#131929] border border-slate-700 text-white rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500 transition"
            />
          </div>
          <label className="flex items-center gap-2 text-slate-400 text-sm cursor-pointer self-end pb-2">
            <input
              type="checkbox"
              checked={form.is_full_day}
              onChange={(e) => setForm({ ...form, is_full_day: e.target.checked })}
              className="accent-violet-600 w-4 h-4"
            />
            Día completo
          </label>
          <button
            type="submit"
            disabled={addMutation.isPending}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition self-end"
          >
            <Plus size={15} />
            {addMutation.isPending ? 'Agregando...' : 'Agregar'}
          </button>
        </div>
      </form>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2 sm:space-y-2 md:space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 sm:h-12 md:h-14 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
          ))}
        </div>
      ) : closedDays.length === 0 ? (
        <div className="text-center py-12 text-slate-600">
          <Calendar size={36} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Sin días cerrados programados</p>
        </div>
      ) : (
        <div className="space-y-2">
          {closedDays.map((d) => (
            <div key={d.id} className="bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 px-5 py-3.5 flex items-center justify-between">
              <div>
                <p className="text-white text-sm font-medium capitalize">{fmtDate(d.date)}</p>
                <div className="flex items-center gap-2 mt-1">
                  {d.reason && <span className="text-slate-400 text-xs">{d.reason}</span>}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${d.is_full_day ? 'text-slate-500 bg-slate-800' : 'text-yellow-500 bg-yellow-500/10'}`}>
                    {d.is_full_day ? 'Día completo' : 'Parcial'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => removeMutation.mutate(d.id)}
                disabled={removeMutation.isPending}
                className="text-slate-500 hover:text-red-400 p-2 rounded-lg hover:bg-red-500/10 transition"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PESTAÑA PERFIL ───────────────────────────────────────────────────────────
function ProfileTab() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const [form, setForm] = useState(null);
  const synced = useRef(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['settings-profile'],
    queryFn: () => api.get('/api/settings/profile').then((r) => r.data.data),
  });

  useEffect(() => {
    if (profile && !synced.current) {
      setForm({
        name:          profile.name          || '',
        phone:         profile.phone         || '',
        address:       profile.address       || '',
        business_type: profile.business_type || '',
      });
      synced.current = true;
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: (body) => api.put('/api/settings/profile', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-profile'] });
      show('Perfil actualizado');
    },
    onError: (err) => show(err.response?.data?.error || 'Error al guardar.', 'error'),
  });

  if (isLoading || !form) {
    return (
      <div className="space-y-4 max-w-lg">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {toast && <Toast {...toast} />}
      <p className="text-slate-400 text-sm mb-6">Información básica de tu negocio.</p>

      <div className="bg-[#131929] border border-violet-500/15 rounded-xl p-4 mb-3 max-w-lg space-y-3">
        {[
          { name: 'name',    label: 'Nombre del negocio *', placeholder: 'Mi negocio' },
          { name: 'phone',   label: 'Teléfono',             placeholder: '3001234567' },
          { name: 'address', label: 'Dirección',            placeholder: 'Calle 45 #12-34, Cali' },
        ].map(({ name, label, placeholder }) => (
          <div key={name}>
            <label className="block text-slate-400 text-sm mb-2">{label}</label>
            <input
              type="text"
              value={form[name]}
              onChange={(e) => setForm({ ...form, [name]: e.target.value })}
              placeholder={placeholder}
              className="w-full bg-[#0d1420] border border-white/10 text-white rounded-xl px-3 py-3 text-sm placeholder-slate-500 focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/15 focus:outline-none transition-all"
            />
          </div>
        ))}

        <div>
          <label className="block text-slate-400 text-sm mb-2">Tipo de negocio</label>
          <select
            value={form.business_type}
            onChange={(e) => setForm({ ...form, business_type: e.target.value })}
            className="w-full bg-[#0d1420] border border-white/10 text-white rounded-xl px-3 py-3 text-sm focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/15 focus:outline-none transition-all"
          >
            <option value="">Selecciona un tipo</option>
            {BUSINESS_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {profile?.owner_email && (
          <div className="pt-1">
            <label className="block text-slate-500 text-xs mb-1">Correo electrónico</label>
            <p className="text-slate-400 text-sm">{profile.owner_email}</p>
            <p className="text-slate-600 text-xs mt-0.5">El email no se puede modificar aquí.</p>
          </div>
        )}

        <button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
        >
          <Check size={15} />
          {saveMutation.isPending ? 'Guardando...' : 'Guardar perfil'}
        </button>
      </div>
    </div>
  );
}

// ─── PESTAÑA NOTIFICACIONES ───────────────────────────────────────────────────
function NotificationsTab() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const [form, setForm] = useState(null);
  const synced = useRef(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['settings-profile'],
    queryFn: () => api.get('/api/settings/profile').then((r) => r.data.data),
  });

  useEffect(() => {
    if (profile && !synced.current) {
      setForm({
        whatsapp_notify: profile.whatsapp_notify ?? true,
        owner_whatsapp:  profile.owner_whatsapp  || '',
      });
      synced.current = true;
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: (body) => api.put('/api/settings/whatsapp-notify', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-profile'] });
      show('Notificaciones actualizadas');
    },
    onError: (err) => show(err.response?.data?.error || 'Error al guardar.', 'error'),
  });

  if (isLoading || !form) {
    return <div className="h-48 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse max-w-lg" />;
  }

  // Strip country code for display; save full number
  const displayNumber = form.owner_whatsapp?.startsWith('+57')
    ? form.owner_whatsapp.slice(3)
    : form.owner_whatsapp || '';

  function handleNumberChange(e) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    setForm({ ...form, owner_whatsapp: digits ? `+57${digits}` : '' });
  }

  return (
    <div>
      {toast && <Toast {...toast} />}
      <p className="text-slate-400 text-sm mb-6">Recibe alertas en WhatsApp cuando llegue una nueva cita.</p>

      <div className="bg-[#131929] border border-violet-500/15 rounded-xl p-4 mb-3 max-w-lg space-y-4">
        {/* Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Notificaciones por WhatsApp</p>
            <p className="text-xs text-white/40">Recibe confirmaciones y nuevas citas en tiempo real</p>
          </div>
          <div
            onClick={() => setForm({ ...form, whatsapp_notify: !form.whatsapp_notify })}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 cursor-pointer ${form.whatsapp_notify ? 'bg-violet-600' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${form.whatsapp_notify ? 'translate-x-6' : 'translate-x-1'}`} />
          </div>
        </div>

        {/* Número */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1">Número personal del dueño</label>
          <div className="flex items-center gap-0">
            <span className="text-white/70 text-sm bg-[#0d1420] border border-white/10 rounded-l-xl px-3 py-3 select-none">+57</span>
            <input
              type="text"
              value={displayNumber}
              onChange={handleNumberChange}
              placeholder="3001234567"
              disabled={!form.whatsapp_notify}
              className="flex-1 bg-[#0d1420] border border-white/10 border-l-0 text-white rounded-r-xl px-3 py-3 text-sm placeholder-slate-500 focus:outline-none focus:border-violet-500/60 transition disabled:opacity-40"
            />
          </div>
          <p className="text-slate-600 text-xs mt-1.5">Ingresa los 10 dígitos sin el indicativo del país</p>
        </div>

        <button
          onClick={() => saveMutation.mutate({ whatsapp_notify: form.whatsapp_notify, owner_whatsapp: form.owner_whatsapp || null })}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
        >
          <Check size={15} />
          {saveMutation.isPending ? 'Guardando...' : 'Guardar notificaciones'}
        </button>
      </div>
    </div>
  );
}

// ─── PESTAÑA CONEXIÓN WHATSAPP ────────────────────────────────────────────────
function WhatsappTab() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const [form, setForm] = useState(null);
  const synced = useRef(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['settings-profile'],
    queryFn: () => api.get('/api/settings/profile').then((r) => r.data.data),
  });

  useEffect(() => {
    if (profile && !synced.current) {
      setForm({
        whatsapp_phone_number_id: profile.whatsapp_phone_number_id || '',
        whatsapp_access_token:    profile.whatsapp_access_token    || '',
      });
      synced.current = true;
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: (body) => api.put('/api/settings/whatsapp', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings-profile'] });
      show('Configuración WhatsApp guardada');
    },
    onError: (err) => show(err.response?.data?.error || 'Error al guardar.', 'error'),
  });

  if (isLoading || !form) {
    return (
      <div className="space-y-4 max-w-lg">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-12 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {toast && <Toast {...toast} />}
      <p className="text-slate-400 text-sm mb-6">
        Configura tu integración con WhatsApp Cloud API para conectar el chatbot con tu número de negocio.
      </p>

      <div className="bg-[#131929] border border-violet-500/15 rounded-xl p-4 mb-3 max-w-lg space-y-4">
        {/* Explicación */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 mb-6">
          <p className="text-sm text-blue-300">
            Encuentra estos datos en <span className="font-semibold">Meta Developers → WhatsApp → Configuración de la API</span>. Necesitarás acceso como administrador de tu Business Account.
          </p>
        </div>

        {/* Phone Number ID */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1">WhatsApp Phone Number ID</label>
          <p className="text-xs text-white/40 mb-3">
            ID único de tu número de teléfono comercial en Meta.
          </p>
          <input
            type="text"
            value={form.whatsapp_phone_number_id}
            onChange={(e) => setForm({ ...form, whatsapp_phone_number_id: e.target.value })}
            placeholder="Ej: 1234567890123456"
            className="w-full bg-[#0d1420] border border-white/10 text-white rounded-xl px-3 py-3 text-sm placeholder-slate-500 focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/15 focus:outline-none transition-all"
          />
        </div>

        {/* Access Token */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1">Token de acceso</label>
          <p className="text-xs text-white/40 mb-3">
            Token de acceso de tu Business Account. Se encriptan y guardan de forma segura.
          </p>
          <input
            type="password"
            value={form.whatsapp_access_token}
            onChange={(e) => setForm({ ...form, whatsapp_access_token: e.target.value })}
            placeholder="Ej: EAABsZ..."
            className="w-full bg-[#0d1420] border border-white/10 text-white rounded-xl px-3 py-3 text-sm placeholder-slate-500 focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/15 focus:outline-none transition-all"
          />
        </div>

        <button
          onClick={() => saveMutation.mutate({
            whatsapp_phone_number_id: form.whatsapp_phone_number_id?.trim() || null,
            whatsapp_access_token:    form.whatsapp_access_token?.trim()    || null,
          })}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
        >
          <Check size={15} />
          {saveMutation.isPending ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  );
}

// ─── TOGGLE COMPONENT ─────────────────────────────────────────────────────────
const Toggle = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
      checked ? 'bg-violet-600' : 'bg-slate-600'
    }`}
  >
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
      checked ? 'translate-x-6' : 'translate-x-1'
    }`} />
  </button>
);

// ─── PESTAÑA MÓDULOS ──────────────────────────────────────────────────────────
function ModulesTab() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const { business, setBusiness } = useAuth();
  const [modules, setModules] = useState(null);
  const synced = useRef(false);

  const bType = (business?.business_type || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const modulosConfig = [
    { key: 'citas',      label: 'Citas',      visible: true },
    { key: 'empleados',  label: 'Empleados',  visible: true },
    { key: 'servicios',  label: 'Servicios',  visible: bType !== 'tienda' },
    { key: 'productos',  label: 'Productos',  visible: true },
    { key: 'pedidos',    label: 'Pedidos',    visible: bType === 'tienda' },
    { key: 'caja',       label: 'Caja',       visible: true },
    { key: 'analiticas', label: 'Analíticas', visible: true },
  ];

  useEffect(() => {
    if (business && !synced.current) {
      setModules(business.modules || {
        citas: true,
        clientes: true,
        empleados: true,
        servicios: true,
        productos: true,
        pedidos: true,
        caja: true,
        analiticas: true,
      });
      synced.current = true;
    }
  }, [business]);

  const saveMutation = useMutation({
    mutationFn: (newModules) => api.patch('/api/businesses/modules', { modules: newModules }),
    onSuccess: (res) => {
      setBusiness(res.data.data);
      qc.invalidateQueries({ queryKey: ['businesses-me'] });
      show('Módulos actualizados');
    },
    onError: (err) => show(err.response?.data?.error || 'Error al guardar.', 'error'),
  });


  function toggleModule(key) {
    const updated = { ...modules, [key]: !modules[key] };
    setModules(updated);
  }

  function handleSave() {
    saveMutation.mutate(modules);
  }

  if (!modules) return <div className="h-48 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />;

  return (
    <div>
      {toast && <Toast {...toast} />}
      <p className="text-slate-400 text-sm mb-6">Activa o desactiva los módulos que tu negocio necesita.</p>

      <div className="bg-[#131929] border border-violet-500/15 rounded-xl p-6 mb-4 max-w-lg space-y-4">
        {modulosConfig.filter((m) => m.visible).map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
            <span className="text-sm font-medium text-white">{label}</span>
            <Toggle checked={modules[key]} onChange={(val) => setModules({ ...modules, [key]: val })} />
          </div>
        ))}

        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition mt-6"
        >
          <Check size={15} />
          {saveMutation.isPending ? 'Guardando...' : 'Guardar módulos'}
        </button>
      </div>
    </div>
  );
}

// ─── PESTAÑA FIDELIZACIÓN ────────────────────────────────────────────────────
function LoyaltyConfigTab() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const [form, setForm] = useState(null);
  const synced = useRef(false);

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['loyalty-config'],
    queryFn: () => api.get('/api/loyalty/config').then((r) => r.data.data),
  });

  const { data: services = [], isLoading: servicesLoading } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get('/api/services').then((r) => r.data.data),
  });

  useEffect(() => {
    if (config && !synced.current) {
      setForm({
        visits_for_reward:  config.visits_for_reward  ?? 10,
        reward_service_id:  config.reward_service_id  || '',
      });
      synced.current = true;
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: (body) => api.put('/api/loyalty/config', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loyalty-config'] });
      show('Configuración de fidelización guardada');
    },
    onError: (err) => show(err.response?.data?.error || 'Error al guardar.', 'error'),
  });

  if (configLoading || servicesLoading || !form) {
    return (
      <div className="space-y-4 max-w-lg">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-12 bg-[#131929] border border-slate-800 rounded-xl shadow-lg shadow-black/30 animate-pulse" />
        ))}
      </div>
    );
  }

  const rewardService = services.find((s) => s.id === form.reward_service_id);

  return (
    <div>
      {toast && <Toast {...toast} />}
      <p className="text-slate-400 text-sm mb-6">
        Define cuántas visitas necesita un cliente para ganar su recompensa gratis.
      </p>

      <div className="bg-[#131929] border border-violet-500/15 rounded-xl p-4 mb-3 max-w-lg space-y-4">
        {/* Visitas para recompensa */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1">Visitas para recompensa</label>
          <p className="text-xs text-white/40 mb-3">
            Número de citas completadas que el cliente necesita para ganar su servicio gratis.
          </p>
          <input
            type="number"
            min={1}
            max={100}
            value={form.visits_for_reward}
            onChange={(e) => setForm({ ...form, visits_for_reward: Number(e.target.value) })}
            className="w-full bg-[#0d1420] border border-white/10 text-white rounded-xl px-3 py-3 text-sm focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/15 focus:outline-none transition-all max-w-[120px]"
          />
        </div>

        {/* Servicio de recompensa */}
        <div>
          <label className="block text-sm font-medium text-white/70 mb-1">Servicio de recompensa</label>
          <p className="text-xs text-white/40 mb-3">
            El servicio que el cliente recibe gratis al alcanzar las visitas requeridas.
          </p>
          <select
            value={form.reward_service_id}
            onChange={(e) => setForm({ ...form, reward_service_id: e.target.value })}
            className="w-full bg-[#0d1420] border border-white/10 text-white rounded-xl px-3 py-3 text-sm focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/15 focus:outline-none transition-all"
          >
            <option value="">Sin servicio de recompensa</option>
            {services.filter((s) => s.active).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Preview */}
        {form.visits_for_reward > 0 && (
          <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
            <p className="text-sm text-violet-300">
              Cada <span className="font-semibold">{form.visits_for_reward} visitas</span> el cliente gana{' '}
              {rewardService
                ? <span className="font-semibold">{rewardService.name}</span>
                : <span className="text-slate-500">un servicio gratis</span>
              } de forma automática.
            </p>
          </div>
        )}

        <button
          onClick={() => saveMutation.mutate({
            visits_for_reward: form.visits_for_reward,
            reward_service_id: form.reward_service_id || null,
          })}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
        >
          <Check size={15} />
          {saveMutation.isPending ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  );
}

// ─── PESTAÑA RECORDATORIO ────────────────────────────────────────────────────
function RecallTab() {
  const qc = useQueryClient();
  const { toast, show } = useToast();
  const { supabase } = useAuth();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({ message: '', imageUrl: '' });
  const [businessId, setBusinessId] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const DEFAULT_MESSAGE = 'Hola {nombre} 👋 Hace un tiempo no te vemos en {negocio}. ¡Te esperamos para tu próxima visita! Escríbenos para agendar fácilmente 😊';

  useEffect(() => {
    const loadRecallSettings = async () => {
      try {
        const res = await api.get('/api/businesses/me');
        const biz = res.data?.data;
        if (biz?.id) setBusinessId(biz.id);
        if (biz?.recall_message) {
          setForm((prev) => ({ ...prev, message: biz.recall_message }));
        } else {
          setForm((prev) => ({ ...prev, message: DEFAULT_MESSAGE }));
        }
        if (biz?.recall_image_url) {
          setForm((prev) => ({ ...prev, imageUrl: biz.recall_image_url }));
        }
      } catch (err) {
        console.error('Error cargando recall settings:', err);
      }
    };
    loadRecallSettings();
  }, []);

  const { data: business } = useQuery({
    queryKey: ['businesses-me'],
    queryFn: () => api.get('/api/businesses/me').then((r) => r.data.data),
    onSuccess: (data) => {
      setBusinessId(data.id);
      setForm({ message: data.recall_message || DEFAULT_MESSAGE, imageUrl: data.recall_image_url || '' });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (data) => api.patch('/api/businesses/recall-settings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['businesses-me'] });
      show('Recordatorio actualizado');
    },
    onError: (err) => show(err.response?.data?.error || 'Error al guardar.', 'error'),
  });

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('La imagen debe ser menor a 5MB');
      return;
    }

    try {
      setUploadingImage(true);

      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;

      const { data, error } = await supabaseClient.storage
        .from('recall.images')
        .upload(fileName, file, {
          upsert: true,
          contentType: file.type
        });

      if (error) throw error;

      const { data: urlData } = supabaseClient.storage
        .from('recall.images')
        .getPublicUrl(data.path);

      setForm((prev) => ({ ...prev, imageUrl: urlData.publicUrl }));

    } catch (err) {
      console.error('Upload error:', err);
      alert('Error al subir imagen: ' + err.message);
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  function insertVariable(variable) {
    setForm((prev) => ({ ...prev, message: prev.message + ` ${variable}` }));
  }

  function handleRemoveImage() {
    setForm((prev) => ({ ...prev, imageUrl: '' }));
  }

  function handleSave() {
    console.log('Guardando:', { mensaje: form.message, imageUrl: form.imageUrl });
    saveMutation.mutate({ recall_message: form.message, recall_image_url: form.imageUrl || null });
  }

  return (
    <div>
      {toast && <Toast {...toast} />}
      <p className="text-slate-400 text-sm mb-6">Personaliza el mensaje que se enviará a clientes en riesgo.</p>

      {/* Sección mensaje */}
      <div className="bg-[#131929] border border-violet-500/15 rounded-xl p-6 mb-4">
        <h3 className="text-white font-semibold mb-1">Mensaje de recordatorio</h3>
        <p className="text-xs text-white/40 mb-4">Este mensaje se enviará por WhatsApp cuando hagas click en Recordar desde Analíticas</p>

        <textarea
          value={form.message}
          onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
          rows={4}
          placeholder={DEFAULT_MESSAGE}
          className="w-full bg-[#0d1420] border border-white/10 rounded-xl p-3 text-white text-sm resize-none focus:border-violet-500/60 focus:outline-none transition-all"
        />

        <div className="flex gap-2 mt-3">
          <span
            onClick={() => insertVariable('{nombre}')}
            className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-1 rounded-md cursor-pointer hover:bg-violet-500/20 transition-colors"
          >
            {'{nombre}'}
          </span>
          <span
            onClick={() => insertVariable('{negocio}')}
            className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-1 rounded-md cursor-pointer hover:bg-violet-500/20 transition-colors"
          >
            {'{negocio}'}
          </span>
        </div>

        {/* Preview */}
        <div className="mt-4 bg-[#0a0f1e] border border-white/5 rounded-xl p-4">
          <p className="text-xs text-white/40 mb-2 uppercase tracking-wider">Vista previa</p>
          <div className="bg-[#1e293b] rounded-xl rounded-tl-sm p-3 max-w-[280px]">
            <p className="text-sm text-white/90">
              {form.message.replace('{nombre}', 'Juan').replace('{negocio}', business?.name || 'tu negocio')}
            </p>
          </div>
        </div>
      </div>

      {/* Sección imagen */}
      <div className="bg-[#131929] border border-violet-500/15 rounded-xl p-6 mb-6">
        <h3 className="text-white font-semibold mb-1">Imagen del recordatorio (opcional)</h3>
        <p className="text-slate-400 text-xs mb-4">Si agregas una imagen, se enviará antes del mensaje de texto (máx. 2MB, JPG/PNG/WebP)</p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleImageUpload}
          className="hidden"
        />

        {!form.imageUrl ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingImage}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600/20 border border-violet-500/30 text-violet-300 rounded-xl hover:bg-violet-600/30 transition-colors text-sm disabled:opacity-50"
          >
            <Upload size={16} />
            {uploadingImage ? 'Subiendo...' : 'Subir imagen'}
          </button>
        ) : (
          <div className="space-y-3">
            <img src={form.imageUrl} alt="Preview" className="w-full max-h-[200px] object-cover rounded-xl" />
            <button
              onClick={handleRemoveImage}
              className="flex items-center gap-2 px-4 py-2 bg-red-600/20 border border-red-500/30 text-red-300 rounded-xl hover:bg-red-600/30 transition-colors text-sm"
            >
              <X size={16} />
              Eliminar imagen
            </button>
          </div>
        )}
      </div>

      <button
        onClick={handleSave}
        disabled={saveMutation.isPending}
        className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition"
      >
        <Check size={15} />
        {saveMutation.isPending ? 'Guardando...' : 'Guardar configuración'}
      </button>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function Settings() {
  const [tab, setTab] = useState('hours');
  const { data: sub, isLoading: subLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.get('/api/subscription').then(r => r.data.data),
    staleTime: 5 * 60 * 1000
  });

  const plan = sub?.plan || 'estandar';

  const visibleTabs = TABS.filter(({ id }) => {
    if (plan === 'lite') {
      return ['hours', 'closed', 'profile', 'whatsapp'].includes(id);
    }
    return true;
  });

  if (subLoading) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-8 w-48 bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-32 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />
        <div className="h-64 bg-[#131929] border border-slate-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="border-b border-white/6 pb-3 mb-4">
        <h1 className="text-2xl font-bold text-white">
          Configuración
        </h1>
        <p className="text-sm text-white/40 mt-0.5">
          Personaliza ZITA para tu negocio
        </p>
      </div>

      {/* Tabs - Horizontal scroll en móvil */}
      <div className="mb-6 sm:mb-8">
        <div className="flex overflow-x-auto gap-1 mb-6 bg-[#0d1420] p-1 rounded-xl border border-white/5 scrollbar-hide">
          {visibleTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap text-sm transition-all ${
                tab === id
                  ? 'bg-violet-600 text-white font-medium shadow-lg shadow-violet-900/30'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido */}
      {tab === 'hours'     && <HoursTab />}
      {tab === 'closed'    && <ClosedDaysTab />}
      {tab === 'profile'   && <ProfileTab />}
      {tab === 'modules'   && <ModulesTab />}
      {tab === 'notif'     && <NotificationsTab />}
      {tab === 'whatsapp'  && <WhatsappTab />}
      {tab === 'loyalty'   && <LoyaltyConfigTab />}
      {tab === 'recall'    && <RecallTab />}
    </div>
  );
}
