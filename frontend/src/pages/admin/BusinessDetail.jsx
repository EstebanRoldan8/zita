import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Users, Scissors, CalendarCheck, CheckCircle, XCircle, CreditCard } from 'lucide-react';
import api from '../../lib/api';

function formatCOP(v) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v ?? 0);
}

function formatTime(iso) {
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

const STATUS_COLOR = {
  pending:   'text-yellow-400',
  confirmed: 'text-blue-400',
  completed: 'text-emerald-400',
  cancelled: 'text-slate-500',
};
const STATUS_LABEL = { pending: 'Pendiente', confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada' };

const STATUS_CONFIG = {
  active:    { label: 'Activo',     color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  trial:     { label: 'Trial',      color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
  suspended: { label: 'Suspendido', color: 'text-red-400 bg-red-500/10 border-red-500/20' },
};

export default function BusinessDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-business', id],
    queryFn: () => api.get(`/api/admin/businesses/${id}`).then((r) => r.data.data),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (status) => api.patch(`/api/admin/businesses/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-business', id] });
      qc.invalidateQueries({ queryKey: ['admin-businesses'] });
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: (plan) => api.patch(`/api/admin/businesses/${id}/plan`, { plan }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-business', id] });
      qc.invalidateQueries({ queryKey: ['admin-businesses'] });
      setSelectedPlan(null);
    },
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 md:p-8 space-y-4">
        <div className="h-8 w-48 bg-slate-800 rounded-lg animate-pulse" />
        <div className="h-32 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
        <div className="h-64 bg-slate-900 border border-slate-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!data) return null;

  const { stats, recent_appointments: appointments, ...biz } = data;
  const statusCfg = STATUS_CONFIG[biz.status] || STATUS_CONFIG.trial;

  return (
    <div className="p-4 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6 sm:mb-8">
        <button onClick={() => navigate('/admin/negocios')}
          className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-white text-2xl font-bold">{biz.name}</h1>
            <span className={`text-xs font-medium border px-2.5 py-0.5 rounded-full ${statusCfg.color}`}>
              {statusCfg.label}
            </span>
          </div>
          <p className="text-slate-400 text-sm mt-0.5">{biz.owner_email}</p>
        </div>
        <button
          onClick={() => updateMutation.mutate(biz.status === 'suspended' ? 'active' : 'suspended')}
          disabled={updateMutation.isPending}
          className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition ${
            biz.status === 'suspended'
              ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-500/30'
              : 'bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/30'
          }`}
        >
          {biz.status === 'suspended' ? <CheckCircle size={15} /> : <XCircle size={15} />}
          {biz.status === 'suspended' ? 'Activar negocio' : 'Suspender negocio'}
        </button>
      </div>

      {/* Info + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Info */}
        <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <h2 className="text-white font-semibold text-sm mb-2">Información</h2>
          {[
            ['Tipo', biz.business_type],
            ['Teléfono', biz.phone || '—'],
            ['Dirección', biz.address || '—'],
            ['Registro', new Date(biz.created_at).toLocaleDateString('es-CO')],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-slate-500">{label}</span>
              <span className="text-slate-300">{value}</span>
            </div>
          ))}
        </div>

        {/* Stats */}
        {[
          { label: 'Clientes', value: stats?.clients, icon: Users, color: 'text-violet-400 bg-violet-500/10' },
          { label: 'Servicios activos', value: stats?.services, icon: Scissors, color: 'text-blue-400 bg-blue-500/10' },
          { label: 'Total citas', value: stats?.appointments, icon: CalendarCheck, color: 'text-emerald-400 bg-emerald-500/10' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center gap-4">
            <div className={`p-3 rounded-xl ${color}`}>
              <Icon size={22} className={color.split(' ')[0]} />
            </div>
            <div>
              <p className="text-white text-2xl font-bold">{value ?? 0}</p>
              <p className="text-slate-500 text-sm">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Plan y suscripción */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard size={18} className="text-violet-400" />
          <h2 className="text-white font-semibold">Plan y suscripción</h2>
        </div>
        <div className="flex items-center gap-4">
          <div>
            <p className="text-slate-500 text-sm mb-1">Plan actual</p>
            <p className="text-white font-semibold text-lg capitalize">{data?.plan || 'estandar'}</p>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <select
              value={selectedPlan ?? data?.plan ?? 'estandar'}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
            >
              <option value="lite">Lite</option>
              <option value="estandar">Estándar</option>
              <option value="pro">Pro</option>
            </select>
            <button
              onClick={() => selectedPlan && changePlanMutation.mutate(selectedPlan)}
              disabled={!selectedPlan || changePlanMutation.isPending || selectedPlan === data?.plan}
              className="bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              Cambiar plan
            </button>
          </div>
        </div>
      </div>

      {/* Recent appointments */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-white font-semibold">Citas recientes</h2>
        </div>
        {!appointments?.length ? (
          <p className="text-slate-500 text-sm p-5">Sin citas registradas</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {['Fecha', 'Cliente', 'Servicio', 'Precio', 'Estado'].map((h) => (
                  <th key={h} className="text-left text-slate-500 font-medium px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition">
                  <td className="px-4 py-3 text-slate-300">{formatTime(a.scheduled_at)}</td>
                  <td className="px-4 py-3 text-slate-300">{a.clients?.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{a.services?.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{formatCOP(a.price)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${STATUS_COLOR[a.status]}`}>
                      {STATUS_LABEL[a.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
