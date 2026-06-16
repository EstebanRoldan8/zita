import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Building2, Users, Scissors, Calendar,
  CreditCard, Link, CheckCircle2, XCircle, AlertTriangle,
  Clock, Phone, Mail, MapPin, ExternalLink, User
} from 'lucide-react';
import api from '../../lib/api';

const STATUS_CONFIG = {
  trial: { label: 'Período de prueba', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', icon: Clock },
  active: { label: 'Activo', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  suspended: { label: 'Suspendido', color: 'text-red-400 bg-red-500/10 border-red-500/20', icon: XCircle },
  expired: { label: 'Vencido', color: 'text-red-400 bg-red-500/10 border-red-500/20', icon: AlertTriangle },
};

const PLAN_LABELS = { lite: 'Lite', estandar: 'Estándar', pro: 'Pro' };
const PLAN_COLORS = {
  lite: 'text-slate-300',
  estandar: 'text-violet-400',
  pro: 'text-yellow-400'
};

function formatCOP(amount) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount);
}

export default function BusinessDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState('');
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentLink, setPaymentLink] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-business', id],
    queryFn: () => api.get(`/api/admin/businesses/${id}`).then(r => r.data.data),
    onSuccess: (d) => setSelectedPlan(d?.plan || 'estandar')
  });

  const statusMutation = useMutation({
    mutationFn: (status) => api.patch(`/api/admin/businesses/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries(['admin-business', id]),
  });

  const planMutation = useMutation({
    mutationFn: (plan) => api.patch(`/api/admin/businesses/${id}/plan`, { plan }),
    onSuccess: () => queryClient.invalidateQueries(['admin-business', id]),
  });

  const generateLink = async () => {
    try {
      const res = await api.post(`/api/admin/businesses/${id}/payment-link`, { plan: selectedPlan });
      setPaymentLink(res.data.data.checkoutUrl);
      setPaymentModal(true);
    } catch(e) {
      console.error(e);
    }
  };

  if (isLoading) return (
    <div className="p-6 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-32 bg-[#131929] rounded-2xl animate-pulse" />)}
    </div>
  );

  if (!data) return (
    <div className="p-6 text-center text-slate-400">Negocio no encontrado</div>
  );

  const StatusIcon = STATUS_CONFIG[data.status]?.icon || Clock;
  const isActive = data.status === 'active';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/admin/negocios')}
            className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition-all"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{data.name}</h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_CONFIG[data.status]?.color}`}>
                <StatusIcon size={11} />
                {STATUS_CONFIG[data.status]?.label}
              </span>
            </div>
            <p className="text-slate-500 text-sm mt-0.5">{data.owner_email}</p>
          </div>
        </div>
        <button
          onClick={() => statusMutation.mutate(isActive ? 'suspended' : 'active')}
          disabled={statusMutation.isPending}
          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
            isActive
              ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
          }`}
        >
          {isActive ? 'Suspender' : 'Activar'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Datos del negocio */}
          <div className="bg-[#131929] border border-white/10 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4">Información</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Dueño', value: data.owner_name || 'No especificado', icon: User, isOptional: !data.owner_name },
                { label: 'Tipo', value: data.business_type, icon: Building2 },
                { label: 'Teléfono', value: data.phone || '—', icon: Phone },
                { label: 'Email', value: data.owner_email, icon: Mail },
                { label: 'Dirección', value: data.address || '—', icon: MapPin },
              ].map(({ label, value, icon: Icon, isOptional }) => (
                <div key={label}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon size={13} className="text-slate-500" />
                    <span className="text-slate-500 text-xs">{label}</span>
                  </div>
                  <p className={`text-sm ${isOptional ? 'text-slate-500' : 'text-slate-200'}`}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Clientes', value: data.clients_count || 0, icon: Users, color: 'text-blue-400' },
              { label: 'Servicios', value: data.services_count || 0, icon: Scissors, color: 'text-violet-400' },
              { label: 'Total citas', value: data.appointments_count || 0, icon: Calendar, color: 'text-emerald-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-[#131929] border border-white/10 rounded-xl p-4 text-center">
                <Icon size={20} className={`${color} mx-auto mb-2`} />
                <p className="text-2xl font-bold text-white">{value}</p>
                <p className="text-slate-500 text-xs mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Citas recientes */}
          <div className="bg-[#131929] border border-white/10 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4">Citas recientes</h2>
            {!data.recent_appointments?.length ? (
              <p className="text-slate-500 text-sm text-center py-6">Sin citas recientes</p>
            ) : (
              <div className="space-y-2">
                {data.recent_appointments.map((a, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div>
                      <p className="text-slate-200 text-sm">{a.clients?.name || 'Cliente'}</p>
                      <p className="text-slate-500 text-xs">{a.services?.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-slate-300 text-sm">{formatCOP(a.price || 0)}</p>
                      <span className={`text-xs font-medium ${
                        a.status === 'completed' ? 'text-emerald-400' :
                        a.status === 'cancelled' ? 'text-red-400' : 'text-violet-400'
                      }`}>{a.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Plan */}
        <div className="space-y-4">
          <div className="bg-[#131929] border border-white/10 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-4">Plan y suscripción</h2>

            <div className="mb-4">
              <p className="text-slate-500 text-xs mb-1">Plan actual</p>
              <p className={`text-xl font-bold ${PLAN_COLORS[data.plan] || 'text-white'}`}>
                {PLAN_LABELS[data.plan] || data.plan}
              </p>
              {data.plan_expires_at && (
                <p className="text-slate-500 text-xs mt-1">
                  Vence: {new Date(data.plan_expires_at).toLocaleDateString('es-CO')}
                </p>
              )}
              {data.trial_ends_at && data.status === 'trial' && (
                <p className="text-yellow-400 text-xs mt-1">
                  Trial hasta: {new Date(data.trial_ends_at).toLocaleDateString('es-CO')}
                </p>
              )}
            </div>

            <div className="space-y-2 mb-4">
              <p className="text-slate-500 text-xs mb-2">Cambiar plan</p>
              {['lite', 'estandar', 'pro'].map(p => (
                <button
                  key={p}
                  onClick={() => setSelectedPlan(p)}
                  className={`w-full px-3 py-2 rounded-xl text-sm font-medium transition-all border text-left ${
                    selectedPlan === p
                      ? 'bg-violet-600/20 border-violet-500/50 text-violet-300'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20'
                  }`}
                >
                  {PLAN_LABELS[p]}
                  {p === data.plan && <span className="ml-2 text-xs opacity-60">(actual)</span>}
                </button>
              ))}
            </div>

            <button
              onClick={() => planMutation.mutate(selectedPlan)}
              disabled={planMutation.isPending || selectedPlan === data.plan}
              className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium transition-all mb-2"
            >
              Aplicar cambio
            </button>

            <button
              onClick={generateLink}
              className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-medium transition-all flex items-center justify-center gap-2"
            >
              <Link size={14} />
              Generar link de pago
            </button>
          </div>

          {/* Registro */}
          <div className="bg-[#131929] border border-white/10 rounded-2xl p-5">
            <h2 className="text-white font-semibold mb-3">Registro</h2>
            <p className="text-slate-400 text-sm">
              {new Date(data.created_at).toLocaleDateString('es-CO', {
                year: 'numeric', month: 'long', day: 'numeric'
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Modal link de pago */}
      {paymentModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#131929] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-white font-semibold mb-3">Link de pago generado</h3>
            <div className="bg-black/30 rounded-xl p-3 mb-4">
              <p className="text-slate-300 text-xs break-all">{paymentLink}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(paymentLink); }}
                className="flex-1 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all"
              >
                Copiar link
              </button>

              <a
                href={paymentLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm transition-all"
              >
                <ExternalLink size={14} />
                Abrir
              </a>
              <button
                onClick={() => setPaymentModal(false)}
                className="px-4 py-2 rounded-xl bg-white/5 text-slate-400 text-sm transition-all"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
