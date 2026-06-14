import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, X, Zap, Clock, MessageSquare, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';

const steps = ['Bienvenida', 'Servicios', 'Horarios', 'Asistente IA', 'Listo'];

export default function Onboarding() {
  const navigate = useNavigate();
  const { business } = useAuth();
  const [step, setStep] = useState(0);
  const [services, setServices] = useState([]);
  const [serviceForm, setServiceForm] = useState({ name: '', price: '', duration_minutes: 30 });
  const [schedule, setSchedule] = useState({
    days: { lunes: true, martes: true, miercoles: true, jueves: true, viernes: true, sabado: false, domingo: false },
    open: '09:00',
    close: '18:00'
  });

  const skipMutation = useMutation({
    mutationFn: () => api.patch('/api/businesses/onboarding', { action: 'skip' }),
    onSuccess: () => navigate('/dashboard'),
  });

  const completeMutation = useMutation({
    mutationFn: () => api.patch('/api/businesses/onboarding', { action: 'complete' }),
    onSuccess: () => navigate('/dashboard'),
  });

  const handleSkip = () => skipMutation.mutate();
  const handleComplete = () => completeMutation.mutate();
  const nextStep = () => { if (step < steps.length - 1) setStep(step + 1); };
  const prevStep = () => { if (step > 0) setStep(step - 1); };

  const addService = () => {
    if (serviceForm.name.trim() && serviceForm.price) {
      setServices([...services, { ...serviceForm, id: Date.now() }]);
      setServiceForm({ name: '', price: '', duration_minutes: 30 });
    }
  };

  const removeService = (id) => {
    setServices(services.filter(s => s.id !== id));
  };

  const toggleDay = (day) => {
    setSchedule({
      ...schedule,
      days: { ...schedule.days, [day]: !schedule.days[day] }
    });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-hidden">
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-white/5 z-50">
        <div
          className="h-full bg-gradient-to-r from-violet-600 to-violet-500 transition-all duration-300"
          style={{ width: `${((step + 1) / steps.length) * 100}%` }}
        />
      </div>

      {/* Header con dots de progreso */}
      <div className="pt-12 px-4 pb-8 relative z-40">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Configurar negocio</h1>
            <p className="text-slate-400 text-sm mt-1">Paso {step + 1} de {steps.length}</p>
          </div>
          {step < steps.length - 1 && (
            <button
              onClick={handleSkip}
              disabled={skipMutation.isPending}
              className="text-slate-400 hover:text-white text-sm transition"
            >
              Omitir
            </button>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4 pb-20 min-h-[calc(100vh-120px)]">
        <div className="w-full max-w-2xl animate-fade-slide-up">
          {/* Step 1: Bienvenida */}
          {step === 0 && (
            <div className="text-center space-y-8">
              <div>
                <div className="w-20 h-20 bg-violet-600/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Zap size={40} className="text-violet-400" />
                </div>
                <h2 className="text-4xl font-bold mb-4">¡Hola {business?.name}!</h2>
                <p className="text-xl text-slate-400">Configuremos tu negocio en 5 minutos para que estés listo a usar ZITA</p>
              </div>
              <button
                onClick={nextStep}
                className="w-full py-3 bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 rounded-lg font-semibold transition"
              >
                Empezar
              </button>
            </div>
          )}

          {/* Step 2: Servicios */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Tus servicios</h2>
                <p className="text-slate-400">Agrega 1 o 2 servicios para empezar. Puedes agregar más después.</p>
              </div>

              <div className="bg-[#1e293b] rounded-xl p-4 space-y-4">
                <input
                  type="text"
                  placeholder="Nombre del servicio"
                  value={serviceForm.name}
                  onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
                  className="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                />
                <div className="grid grid-cols-2 gap-4">
                  <input
                    type="number"
                    placeholder="Precio"
                    value={serviceForm.price}
                    onChange={(e) => setServiceForm({ ...serviceForm, price: e.target.value })}
                    className="bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                  />
                  <input
                    type="number"
                    placeholder="Duración (min)"
                    value={serviceForm.duration_minutes}
                    onChange={(e) => setServiceForm({ ...serviceForm, duration_minutes: parseInt(e.target.value) })}
                    className="bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                  />
                </div>
                <button
                  onClick={addService}
                  disabled={!serviceForm.name.trim() || !serviceForm.price}
                  className="w-full py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg font-medium transition"
                >
                  Agregar servicio
                </button>
              </div>

              {services.length > 0 && (
                <div className="space-y-2">
                  {services.map(svc => (
                    <div key={svc.id} className="bg-[#1e293b] rounded-lg p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{svc.name}</p>
                        <p className="text-sm text-slate-400">${svc.price} • {svc.duration_minutes} min</p>
                      </div>
                      <button
                        onClick={() => removeService(svc.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={prevStep}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                >
                  <ChevronLeft size={18} /> Atrás
                </button>
                <button
                  onClick={nextStep}
                  className="flex-1 py-3 bg-violet-600 hover:bg-violet-700 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                >
                  Siguiente <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Horarios */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Horarios de atención</h2>
                <p className="text-slate-400">¿Qué días trabajas y a qué horas?</p>
              </div>

              <div className="bg-[#1e293b] rounded-xl p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {Object.keys(schedule.days).map(day => (
                    <button
                      key={day}
                      onClick={() => toggleDay(day)}
                      className={`px-4 py-2 rounded-lg font-medium transition capitalize ${
                        schedule.days[day]
                          ? 'bg-violet-600 text-white'
                          : 'bg-white/5 text-slate-400 hover:bg-white/10'
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>

                <div className="border-t border-white/10 pt-4 space-y-3">
                  <div>
                    <label className="text-sm text-slate-400 block mb-2">Abre a las</label>
                    <input
                      type="time"
                      value={schedule.open}
                      onChange={(e) => setSchedule({ ...schedule, open: e.target.value })}
                      className="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-slate-400 block mb-2">Cierra a las</label>
                    <input
                      type="time"
                      value={schedule.close}
                      onChange={(e) => setSchedule({ ...schedule, close: e.target.value })}
                      className="w-full bg-[#0f172a] border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={prevStep}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                >
                  <ChevronLeft size={18} /> Atrás
                </button>
                <button
                  onClick={nextStep}
                  className="flex-1 py-3 bg-violet-600 hover:bg-violet-700 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                >
                  Siguiente <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Asistente IA */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold mb-2">Tu Asistente IA</h2>
                <p className="text-slate-400 mb-6">Puede hacer esto y mucho más. Simplemente escríbele desde el panel</p>

                <div className="bg-[#1e293b] rounded-xl p-6 space-y-4 max-h-96 overflow-y-auto">
                  {/* Message 1 */}
                  <div className="flex gap-3 animate-fade-slide-up" style={{ animationDelay: '0ms' }}>
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex-shrink-0" />
                    <div className="bg-[#0f172a] rounded-lg p-3 max-w-xs">
                      <p className="text-sm">Agenda una cita para Juan mañana a las 3pm con corte clásico</p>
                    </div>
                  </div>

                  {/* Message 2 - Bot */}
                  <div className="flex gap-3 justify-end animate-fade-slide-up" style={{ animationDelay: '100ms' }}>
                    <div className="bg-violet-600/20 border border-violet-500/20 rounded-lg p-3 max-w-xs">
                      <p className="text-sm">✅ Listo, cita creada para Juan mañana 3:00pm - Corte clásico</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-violet-600 flex-shrink-0 flex items-center justify-center">
                      <Zap size={16} />
                    </div>
                  </div>

                  {/* Message 3 */}
                  <div className="flex gap-3 animate-fade-slide-up" style={{ animationDelay: '200ms' }}>
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex-shrink-0" />
                    <div className="bg-[#0f172a] rounded-lg p-3 max-w-xs">
                      <p className="text-sm">¿Cuánto vendí esta semana?</p>
                    </div>
                  </div>

                  {/* Message 4 - Bot */}
                  <div className="flex gap-3 justify-end animate-fade-slide-up" style={{ animationDelay: '300ms' }}>
                    <div className="bg-violet-600/20 border border-violet-500/20 rounded-lg p-3 max-w-xs">
                      <p className="text-sm">Esta semana llevas $450.000 en ingresos, 12 citas completadas</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-violet-600 flex-shrink-0 flex items-center justify-center">
                      <Zap size={16} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={prevStep}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                >
                  <ChevronLeft size={18} /> Atrás
                </button>
                <button
                  onClick={nextStep}
                  className="flex-1 py-3 bg-violet-600 hover:bg-violet-700 rounded-lg font-semibold transition flex items-center justify-center gap-2"
                >
                  Siguiente <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Listo */}
          {step === 4 && (
            <div className="text-center space-y-8">
              <div>
                <div className="w-20 h-20 bg-emerald-600/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 size={40} className="text-emerald-400" />
                </div>
                <h2 className="text-4xl font-bold mb-2">¡Todo listo!</h2>
                <p className="text-lg text-slate-400">Ya configuraste tu negocio. Ahora puedes empezar a usar ZITA al máximo</p>
              </div>
              <button
                onClick={handleComplete}
                disabled={completeMutation.isPending}
                className="w-full py-3 bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 disabled:opacity-50 rounded-lg font-semibold transition"
              >
                Ir al Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
